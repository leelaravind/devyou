import { Form, Link, useSearchParams } from "react-router";
import { Card } from "@devyou/ui";
import { ApiError } from "@devyou/core";
import { can } from "@devyou/auth";
import {
  deriveConfidenceBand,
  tallyEvidence,
  type EvidenceRow as DomainEvidenceRow,
  type EvidenceTally,
} from "@devyou/domain";
import type { EvidenceResult, EvidenceType } from "@devyou/core";
import type { Route } from "./+types/evidence";
import { beginAdminAction, requireAdmin, runAction } from "../lib/route.server";
import { performAdminAction, reasonFrom, requiredField } from "../lib/audit.server";
import {
  ActionForm,
  Detail,
  EmptyState,
  SelectField,
  StatusChip,
  SurfaceHeader,
  SurfaceLayout,
  TextField,
} from "../components/admin-forms";
import { formatInstant, shortId } from "../lib/format";

/**
 * The evidence inspector.
 *
 * **Suppressed records are shown, and that is the point of this page.** The proof that
 * justified suppressing a record *is* the record: without it, a suppression is an
 * assertion that a number moved for a reason nobody can check. `evidence_records` is
 * append-only at the database (migration 0001 §4), the only mutable columns are the
 * suppression pair, and there is no `evidence:delete` capability because there is no
 * operation to grant. This surface is where that decision becomes visible rather than
 * merely true.
 *
 * Suppressing changes a published confidence band, so this route **recomputes the band
 * in the same transaction as the suppression**. Deferring it to a scheduled job would
 * leave the public site showing a figure derived from evidence that no longer counts,
 * for however long the job takes to run — a window in which the "why this confidence?"
 * explanation contradicts the badge above it. The recomputation runs `tallyEvidence` and
 * `deriveConfidenceBand` from `@devyou/domain`, the same functions the job uses; nothing
 * here invents a band.
 */

export function meta() {
  return [{ title: "Evidence — DevYou admin" }];
}

const PAGE_SIZE = 60;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, actor } = await requireAdmin(context, "evidence:view_suppressed");
  const url = new URL(request.url);

  const state = url.searchParams.get("state") ?? "all";
  const revisionFilter = url.searchParams.get("revision")?.trim() ?? "";
  const actorFilter = url.searchParams.get("actor")?.trim() ?? "";

  /*
    A `WHERE` built from three optional filters, with placeholders throughout.

    Assembled as fragments rather than as string interpolation of values — the values are
    always bound. The fragments themselves come from this file and never from the request:
    `state` is compared against literals, not substituted.
  */
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (state === "suppressed") conditions.push("e.suppressed_at IS NOT NULL");
  if (state === "active") conditions.push("e.suppressed_at IS NULL");
  if (revisionFilter) {
    bindings.push(revisionFilter);
    conditions.push(`e.revision_id = ?${bindings.length}`);
  }
  if (actorFilter) {
    bindings.push(actorFilter);
    conditions.push(`(e.actor_id = ?${bindings.length} OR p.handle = ?${bindings.length})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await env.DB.prepare(
    `SELECT e.id, e.revision_id, e.evidence_type, e.result, e.created_at,
            e.suppressed_at, e.suppression_reason, e.actor_id, e.attachment_key,
            p.handle AS actor_handle,
            t.suspected_cluster,
            COALESCE(t.weight, 100) AS actor_weight,
            s.label AS environment_label,
            r.title AS revision_title, r.status AS revision_status,
            pb.slug AS playbook_slug
       FROM evidence_records e
       LEFT JOIN profiles p ON p.user_id = e.actor_id
       LEFT JOIN actor_trust t ON t.user_id = e.actor_id
       LEFT JOIN environment_snapshots s ON s.id = e.environment_snapshot_id
       JOIN playbook_revisions r ON r.id = e.revision_id
       JOIN playbooks pb ON pb.id = r.playbook_id
       ${where}
      ORDER BY e.created_at DESC
      LIMIT ${PAGE_SIZE}`,
  )
    .bind(...bindings)
    .all<EvidenceListRow>();

  return {
    rows: rows.results,
    state,
    revisionFilter,
    actorFilter,
    maySuppress: can(actor.role, "evidence:suppress"),
    mayUnsuppress: can(actor.role, "evidence:unsuppress"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  return runAction(async () => {
    const { env, actor, form, intent } = await beginAdminAction(request, context);
    const evidenceId = requiredField(form, "evidenceId");
    const reason = reasonFrom(form);

    const suppressing = intent === "suppress";
    if (!suppressing && intent !== "unsuppress") {
      throw new ApiError("BAD_REQUEST", { internalDetail: `unknown evidence intent ${intent}` });
    }

    const record = await env.DB.prepare(
      `SELECT e.id, e.revision_id, e.suppressed_at, r.created_by AS revision_author,
              r.deprecated_at, r.superseded_at, r.needs_reverification_at
         FROM evidence_records e
         JOIN playbook_revisions r ON r.id = e.revision_id
        WHERE e.id = ?1`,
    )
      .bind(evidenceId)
      .first<{
        id: string;
        revision_id: string;
        suppressed_at: number | null;
        revision_author: string | null;
        deprecated_at: number | null;
        superseded_at: number | null;
        needs_reverification_at: number | null;
      }>();

    if (!record) {
      throw new ApiError("NOT_FOUND", { internalDetail: "evidence record not found" });
    }

    /*
      Idempotent by refusal rather than by silence.

      Suppressing an already-suppressed record would write a second audit row asserting a
      change that did not happen, and the audit log is append-only — the spurious row
      could never be corrected. Refusing is the only outcome that leaves an honest record.
    */
    const alreadyInTargetState = suppressing
      ? record.suppressed_at !== null
      : record.suppressed_at === null;
    if (alreadyInTargetState) {
      throw new ApiError("CONFLICT", {
        publicMessage: suppressing
          ? "That record is already suppressed."
          : "That record is not suppressed.",
        internalDetail: "evidence suppression no-op refused",
      });
    }

    const recomputed = await recomputeBand(env.DB, record.revision_id, record.revision_author, {
      evidenceId,
      suppressed: suppressing,
      lifecycle: {
        deprecatedAt: record.deprecated_at,
        supersededAt: record.superseded_at,
        needsReverificationAt: record.needs_reverification_at,
      },
    });

    await performAdminAction(
      env.DB,
      {
        actor,
        capability: suppressing ? "evidence:suppress" : "evidence:unsuppress",
        subjectType: "evidence_record",
        subjectId: evidenceId,
        ...reason,
        change: {
          suppressed: [!suppressing, suppressing],
          band: [recomputed.previousBand, recomputed.band],
        },
      },
      [
        suppressing
          ? env.DB.prepare(
              `UPDATE evidence_records SET suppressed_at = unixepoch(), suppression_reason = ?1
                WHERE id = ?2 AND suppressed_at IS NULL`,
            ).bind(reason.reasonCode, evidenceId)
          : env.DB.prepare(
              `UPDATE evidence_records SET suppressed_at = NULL, suppression_reason = NULL
                WHERE id = ?1 AND suppressed_at IS NOT NULL`,
            ).bind(evidenceId),
        recomputed.statement,
      ],
    );

    return {
      ok: true as const,
      message: `${shortId(evidenceId)} ${suppressing ? "suppressed" : "restored"}. Band for ${shortId(record.revision_id)} is now ${recomputed.band}.`,
    };
  });
}

/**
 * Recompute a revision's cached confidence, with one row's suppression flipped.
 *
 * The pending change is applied **in memory** rather than by writing first and reading
 * back, because the write and this recomputation have to land in one transaction — a
 * read-after-write would need the write to have committed, which is precisely the window
 * being avoided.
 *
 * `revision_confidence` is strictly a cache: every field it holds can be regenerated from
 * the append-only tables, and a test in `@devyou/db` regenerates the whole table and
 * asserts it matches. Writing it here is therefore not a second source of truth, it is
 * keeping the cache honest at the moment the underlying facts changed.
 */
async function recomputeBand(
  db: D1Database,
  revisionId: string,
  revisionAuthor: string | null,
  pending: {
    evidenceId: string;
    suppressed: boolean;
    lifecycle: {
      deprecatedAt: number | null;
      supersededAt: number | null;
      needsReverificationAt: number | null;
    };
  },
): Promise<{ statement: D1PreparedStatement; band: string; previousBand: string }> {
  const [evidence, cached] = await Promise.all([
    db
      .prepare(
        `SELECT e.id, e.evidence_type, e.result, e.actor_id, e.created_at, e.suppressed_at,
                s.fingerprint AS environment_fingerprint,
                COALESCE(t.weight, 100) AS actor_weight
           FROM evidence_records e
           LEFT JOIN environment_snapshots s ON s.id = e.environment_snapshot_id
           LEFT JOIN actor_trust t ON t.user_id = e.actor_id
          WHERE e.revision_id = ?1`,
      )
      .bind(revisionId)
      .all<TallyRow>(),
    db
      .prepare(`SELECT band FROM revision_confidence WHERE revision_id = ?1`)
      .bind(revisionId)
      .first<{ band: string }>(),
  ]);

  const rows: DomainEvidenceRow[] = evidence.results.map((row) => ({
    evidenceType: row.evidence_type as EvidenceType,
    result: row.result as EvidenceResult,
    environmentFingerprint: row.environment_fingerprint,
    actorId: row.actor_id,
    createdAt: row.created_at,
    suppressedAt:
      row.id === pending.evidenceId
        ? pending.suppressed
          ? Math.floor(Date.now() / 1000)
          : null
        : row.suppressed_at,
    actorWeight: row.actor_weight,
  }));

  const tally: EvidenceTally = tallyEvidence(rows, revisionAuthor);
  const band = deriveConfidenceBand(tally, pending.lifecycle);

  return {
    band,
    previousBand: cached?.band ?? "unverified",
    statement: db
      .prepare(
        `INSERT INTO revision_confidence
           (revision_id, band, reproduced_passed, reproduced_partial, reproduced_failed,
            independent_confirmations, unique_environments, ci_executions,
            maintainer_attestations, official_references, last_success_at, last_failure_at,
            computed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, unixepoch())
         ON CONFLICT(revision_id) DO UPDATE SET
           band = excluded.band,
           reproduced_passed = excluded.reproduced_passed,
           reproduced_partial = excluded.reproduced_partial,
           reproduced_failed = excluded.reproduced_failed,
           independent_confirmations = excluded.independent_confirmations,
           unique_environments = excluded.unique_environments,
           ci_executions = excluded.ci_executions,
           maintainer_attestations = excluded.maintainer_attestations,
           official_references = excluded.official_references,
           last_success_at = excluded.last_success_at,
           last_failure_at = excluded.last_failure_at,
           computed_at = unixepoch()`,
      )
      .bind(
        revisionId,
        band,
        tally.reproducedPassed,
        tally.reproducedPartial,
        tally.reproducedFailed,
        tally.independentConfirmations,
        tally.uniqueEnvironments,
        tally.ciExecutions,
        tally.maintainerAttestations,
        tally.officialReferences,
        tally.lastSuccessAt,
        tally.lastFailureAt,
      ),
  };
}

export default function Evidence({ loaderData, actionData }: Route.ComponentProps) {
  const { rows, state, revisionFilter, actorFilter, maySuppress, mayUnsuppress } = loaderData;
  const [params] = useSearchParams();
  const focus = params.get("focus");

  return (
    <SurfaceLayout>
      <SurfaceHeader
        title="Evidence"
        description="Every evidence record, suppressed ones included. A suppressed record is never deleted: the proof that justified suppressing it is the record. Suppressing or restoring one recomputes the revision's confidence band in the same transaction."
      >
        <Form method="get" className="gap-gutter flex flex-wrap items-end">
          <SelectField
            label="State"
            name="state"
            defaultValue={state}
            options={[
              ["all", "all"],
              ["suppressed", "suppressed only"],
              ["active", "counting only"],
            ]}
          />
          <TextField
            label="Revision id"
            name="revision"
            defaultValue={revisionFilter}
            placeholder="rev_…"
          />
          <TextField
            label="Actor id or handle"
            name="actor"
            defaultValue={actorFilter}
            placeholder="usr_… or handle"
          />
          <button
            type="submit"
            className="bg-primary text-label-caps text-on-primary rounded px-4 py-2 font-mono uppercase"
          >
            Filter
          </button>
        </Form>
      </SurfaceHeader>

      {actionData?.ok && (
        <p className="border-status-confirmed/40 bg-surface-container text-body-sm text-status-confirmed mb-6 rounded border p-3">
          {actionData.message}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState>No evidence records match this filter.</EmptyState>
      ) : (
        <ol className="gap-gutter flex list-none flex-col">
          {rows.map((row) => (
            <li key={row.id}>
              <Card as="article">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusChip value={row.evidence_type} />
                  <StatusChip value={row.result} alarming={row.result === "failed"} />
                  {row.suppressed_at !== null && <StatusChip value="suppressed" alarming />}
                  {row.suspected_cluster && (
                    <StatusChip value={`cluster ${row.suspected_cluster}`} alarming />
                  )}
                  {row.actor_weight === 0 && <StatusChip value="weight 0" alarming />}
                </div>

                <h2 className="font-headline text-body-md text-on-surface mb-1">
                  {row.revision_title}
                </h2>
                <p className="text-env-tag text-on-surface-variant mb-2 font-mono">
                  /p/{row.playbook_slug} · {shortId(row.revision_id)} · {row.revision_status}
                </p>

                <Detail label="Record">{row.id}</Detail>
                <Detail label="Actor">{row.actor_handle ?? row.actor_id ?? "anonymous"}</Detail>
                <Detail label="Environment">{row.environment_label ?? "—"}</Detail>
                <Detail label="Filed">{formatInstant(row.created_at)}</Detail>
                {row.suppressed_at !== null && (
                  <>
                    <Detail label="Suppressed">{formatInstant(row.suppressed_at)}</Detail>
                    <Detail label="Suppression reason">{row.suppression_reason ?? "—"}</Detail>
                  </>
                )}
                {row.attachment_key && (
                  /*
                    The R2 key is shown, not the object.

                    An attachment is a log or a screenshot filed by a stranger. Rendering
                    it inline in the admin console would put untrusted bytes on the one
                    origin where every viewer holds a privileged role — invariant 10
                    applies most strongly exactly here. Fetching it is a deliberate,
                    separate act.
                  */
                  <Detail label="Attachment (R2 key)">{row.attachment_key}</Detail>
                )}

                {focus === row.id ? (
                  <div className="border-outline-variant mt-4 border-t pt-4">
                    {row.suppressed_at === null
                      ? maySuppress && (
                          <>
                            <p className="text-body-sm text-on-surface-variant mb-3">
                              Suppressing removes this record from confidence derivation. It stays
                              here, permanently, with the reason attached. The revision band is
                              recomputed in the same transaction.
                            </p>
                            <ActionForm
                              intent="suppress"
                              capability="evidence:suppress"
                              label="Suppress record"
                              variant="danger"
                              fields={{ evidenceId: row.id }}
                            />
                          </>
                        )
                      : mayUnsuppress && (
                          <ActionForm
                            intent="unsuppress"
                            capability="evidence:unsuppress"
                            label="Restore to counts"
                            fields={{ evidenceId: row.id }}
                          />
                        )}
                    {!maySuppress && !mayUnsuppress && (
                      <p className="text-body-sm text-on-surface-variant">
                        Suppression is a dev_admin action. It changes a published confidence figure,
                        which is the product&apos;s central claim.
                      </p>
                    )}
                  </div>
                ) : (
                  <Link
                    to={`?${new URLSearchParams({ state, revision: revisionFilter, actor: actorFilter, focus: row.id })}`}
                    className="text-body-sm text-evidence-blue mt-2 inline-block underline"
                  >
                    Act on this record
                  </Link>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </SurfaceLayout>
  );
}

interface EvidenceListRow {
  id: string;
  revision_id: string;
  evidence_type: string;
  result: string;
  created_at: number;
  suppressed_at: number | null;
  suppression_reason: string | null;
  actor_id: string | null;
  attachment_key: string | null;
  actor_handle: string | null;
  suspected_cluster: string | null;
  actor_weight: number;
  environment_label: string | null;
  revision_title: string;
  revision_status: string;
  playbook_slug: string;
}

interface TallyRow {
  id: string;
  evidence_type: string;
  result: string;
  actor_id: string | null;
  created_at: number;
  suppressed_at: number | null;
  environment_fingerprint: string | null;
  actor_weight: number;
}

import { Form, Link, useSearchParams } from "react-router";
import { Card } from "@devyou/ui";
import { ApiError } from "@devyou/core";
import { can } from "@devyou/auth";
import type { Route } from "./+types/playbooks";
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
 * Playbook lifecycle: quarantine, deprecation, reverification and relationships.
 *
 * Four operations that look adjacent and are not, which is why the capability matrix
 * splits them and this surface keeps them apart:
 *
 * - **Quarantine** is a safety action. Something is dangerous and must stop being visible
 *   now. A reviewer holds it without an admin, because a destructive command staying up
 *   overnight costs more than an over-cautious quarantine reversed in the morning.
 * - **Deprecate** is a knowledge judgement: this no longer works. The revision stays
 *   readable at its stable URL — plan §9 — because a 404 destroys the evidence trail that
 *   justified the deprecation.
 * - **Flag for reverification** asserts nothing about correctness. It says the world moved
 *   and nobody has checked since.
 * - **Relate / merge** never removes a playbook. R-42 and the adoption research both name
 *   duplicate-closing as the specific behaviour that made the incumbent hostile, and the
 *   loss is real: the "duplicate" usually covers a different environment. A duplicate here
 *   is *linked*, both stay readable, and the link is a human decision — an AI-suggested
 *   relation is invisible to readers until somebody confirms it.
 *
 * Nothing on this page edits content. Published revisions are immutable and the database
 * enforces it; the only columns any statement below touches are lifecycle ones, which the
 * triggers deliberately leave free to move.
 */

export function meta() {
  return [{ title: "Playbooks — DevYou admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, actor } = await requireAdmin(context, "playbooks:view_unpublished");
  const url = new URL(request.url);
  const filter = url.searchParams.get("status") ?? "attention";
  const search = url.searchParams.get("q")?.trim() ?? "";

  /*
    The default view is "attention", not "everything".

    A directory of every playbook is the public site's job and it does it better. What
    only this surface can show is the set a moderator has to decide about: quarantined,
    deprecated, flagged, or never published at all.
  */
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (filter === "attention") {
    conditions.push(
      `(pb.status IN ('quarantined', 'deprecated') OR pb.current_revision_id IS NULL OR r.status = 'needs_reverification')`,
    );
  } else if (filter !== "all") {
    bindings.push(filter);
    conditions.push(`pb.status = ?${bindings.length}`);
  }

  if (search) {
    bindings.push(`%${search}%`);
    conditions.push(`(pb.slug LIKE ?${bindings.length} OR r.title LIKE ?${bindings.length})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [playbooks, relations] = await Promise.all([
    env.DB.prepare(
      `SELECT pb.id, pb.slug, pb.status, pb.visibility, pb.current_revision_id, pb.created_at,
              r.id AS revision_id, r.title, r.status AS revision_status, r.published_at,
              r.deprecated_at, r.deprecation_reason, r.needs_reverification_at,
              r.needs_reverification_reason,
              c.band
         FROM playbooks pb
         LEFT JOIN playbook_revisions r ON r.id = pb.current_revision_id
         LEFT JOIN revision_confidence c ON c.revision_id = r.id
         ${where}
        ORDER BY pb.created_at DESC
        LIMIT 80`,
    )
      .bind(...bindings)
      .all<PlaybookRow>(),

    /*
      Only unconfirmed relations are listed, and only AI-suggested ones are actionable.

      A confirmed relation is already visible to readers and needs no decision. Listing it
      here would bury the four that do.
    */
    env.DB.prepare(
      `SELECT rel.id, rel.relation_type, rel.confirmation_state, rel.created_at,
              a.slug AS from_slug, b.slug AS to_slug
         FROM playbook_relations rel
         JOIN playbooks a ON a.id = rel.from_playbook_id
         JOIN playbooks b ON b.id = rel.to_playbook_id
        WHERE rel.confirmation_state = 'ai_suggested'
        ORDER BY rel.created_at ASC
        LIMIT 40`,
    ).all<RelationRow>(),
  ]);

  return {
    playbooks: playbooks.results,
    relations: relations.results,
    filter,
    search,
    permissions: {
      quarantine: can(actor.role, "playbooks:quarantine"),
      unquarantine: can(actor.role, "playbooks:unquarantine"),
      deprecate: can(actor.role, "playbooks:deprecate"),
      relate: can(actor.role, "playbooks:relate"),
      /* `playbooks:merge` gates confirming a `duplicate_of` suggestion, which is why it
         appears here rather than as its own control — see the action. */
      merge: can(actor.role, "playbooks:merge"),
      flagReverification: can(actor.role, "revisions:flag_reverification"),
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  return runAction(async () => {
    const { env, actor, form, intent } = await beginAdminAction(request, context);
    const reason = reasonFrom(form);

    switch (intent) {
      case "quarantine":
      case "unquarantine": {
        const playbookId = requiredField(form, "playbookId");
        const quarantining = intent === "quarantine";

        await performAdminAction(
          env.DB,
          {
            actor,
            capability: quarantining ? "playbooks:quarantine" : "playbooks:unquarantine",
            subjectType: "playbook",
            subjectId: playbookId,
            ...reason,
            change: {
              status: quarantining ? ["published", "quarantined"] : ["quarantined", "published"],
            },
          },
          [
            /*
              Only `playbooks.status` moves. The revision is untouched.

              Quarantine hides a playbook from readers; it does not assert that the
              revision's content is wrong, and it must not disturb the evidence attached to
              it. Unquarantining restores `published`, which is why the guard clause names
              the expected current status — an unquarantine that ran against a deprecated
              playbook would silently un-deprecate it.
            */
            quarantining
              ? env.DB.prepare(
                  `UPDATE playbooks SET status = 'quarantined' WHERE id = ?1 AND status <> 'quarantined'`,
                ).bind(playbookId)
              : env.DB.prepare(
                  `UPDATE playbooks SET status = 'published' WHERE id = ?1 AND status = 'quarantined'`,
                ).bind(playbookId),
          ],
        );
        return { ok: true as const, message: `Playbook ${shortId(playbookId)} ${intent}d.` };
      }

      case "deprecate": {
        const playbookId = requiredField(form, "playbookId");
        const revisionId = requiredField(form, "revisionId");

        await performAdminAction(
          env.DB,
          {
            actor,
            capability: "playbooks:deprecate",
            subjectType: "playbook",
            subjectId: playbookId,
            ...reason,
            change: { status: ["published", "deprecated"] },
          },
          [
            /*
              `deprecated_at`, `deprecation_reason` and `status` are absent from the
              `UPDATE OF` list on `trg_revision_content_immutable`, deliberately: a
              revision that could never be marked deprecated would be worse than a mutable
              one. Everything content-bearing stays frozen, and this statement names only
              lifecycle columns.
            */
            env.DB.prepare(
              `UPDATE playbook_revisions
                  SET status = 'deprecated', deprecated_at = unixepoch(), deprecation_reason = ?1
                WHERE id = ?2`,
            ).bind(reason.reasonCode, revisionId),
            env.DB.prepare(`UPDATE playbooks SET status = 'deprecated' WHERE id = ?1`).bind(
              playbookId,
            ),
          ],
        );
        return { ok: true as const, message: `Playbook ${shortId(playbookId)} deprecated.` };
      }

      case "flag_reverification": {
        const revisionId = requiredField(form, "revisionId");

        await performAdminAction(
          env.DB,
          {
            actor,
            capability: "revisions:flag_reverification",
            subjectType: "revision",
            subjectId: revisionId,
            ...reason,
            change: { status: ["published", "needs_reverification"] },
          },
          [
            env.DB.prepare(
              `UPDATE playbook_revisions
                  SET status = 'needs_reverification',
                      needs_reverification_at = unixepoch(),
                      needs_reverification_reason = ?1
                WHERE id = ?2 AND status = 'published'`,
            ).bind(reason.reasonCode, revisionId),
          ],
        );
        return { ok: true as const, message: `Revision ${shortId(revisionId)} flagged.` };
      }

      case "confirm_relation":
      case "decline_relation": {
        const relationId = requiredField(form, "relationId");
        const confirming = intent === "confirm_relation";

        const relation = await env.DB.prepare(
          `SELECT relation_type FROM playbook_relations WHERE id = ?1 AND confirmation_state = 'ai_suggested'`,
        )
          .bind(relationId)
          .first<{ relation_type: string }>();

        if (!relation) {
          throw new ApiError("NOT_FOUND", {
            publicMessage: "That suggestion has already been decided.",
            internalDetail: "relation absent or already confirmed",
          });
        }

        /*
          The capability depends on what kind of link this is, and the split is the
          capability matrix's own.

          `playbooks:relate` covers "these two are connected" — related work, a
          prerequisite. `playbooks:merge` covers `duplicate_of`, which is a much heavier
          claim: it tells a reader that one of two pages is the canonical one. R-42 names
          duplicate-closing as the behaviour that made the incumbent hostile, so the
          heavier claim requires the heavier capability, and a reviewer who may link
          related playbooks cannot declare one a duplicate of another.

          Note that even confirmed, nothing is removed: both playbooks keep their slug,
          their revisions and their evidence. The "duplicate" routinely covers a different
          environment, which is exactly the knowledge this product exists to preserve.
        */
        const capability =
          relation.relation_type === "duplicate_of" ? "playbooks:merge" : "playbooks:relate";

        await performAdminAction(
          env.DB,
          {
            actor,
            capability,
            subjectType: "playbook_relation",
            subjectId: relationId,
            ...reason,
            change: {
              confirmationState: ["ai_suggested", confirming ? "human_confirmed" : "declined"],
            },
          },
          [
            confirming
              ? env.DB.prepare(
                  `UPDATE playbook_relations SET confirmation_state = 'human_confirmed', created_by = ?1
                    WHERE id = ?2 AND confirmation_state = 'ai_suggested'`,
                ).bind(actor.userId, relationId)
              : /*
                  A declined suggestion is deleted rather than kept as a tombstone, and this
                  is the one delete in the whole admin surface.

                  `playbook_relations` is not evidence and carries no invariant: an
                  AI-suggested link that a human rejected is a wrong guess, not a finding.
                  Retaining it would mean the same suggestion reappears in this queue
                  forever, or that a second state has to be invented to hide it. The audit
                  row records that the decision was made and by whom, which is the part
                  worth keeping.
                */
                env.DB.prepare(
                  `DELETE FROM playbook_relations WHERE id = ?1 AND confirmation_state = 'ai_suggested'`,
                ).bind(relationId),
          ],
        );
        return {
          ok: true as const,
          message: `Relation ${confirming ? "confirmed" : "declined"}.`,
        };
      }

      default:
        throw new ApiError("BAD_REQUEST", { internalDetail: `unknown playbook intent ${intent}` });
    }
  });
}

export default function Playbooks({ loaderData, actionData }: Route.ComponentProps) {
  const { playbooks, relations, filter, search, permissions } = loaderData;
  const [params] = useSearchParams();
  const focus = params.get("focus");

  return (
    <SurfaceLayout>
      <SurfaceHeader
        title="Playbooks"
        description="Lifecycle only. Nothing here edits content — published revisions are immutable and the database enforces it, so every action below touches lifecycle columns and leaves the text and its evidence exactly where they are."
      >
        <Form method="get" className="gap-gutter flex flex-wrap items-end">
          <SelectField
            label="Show"
            name="status"
            defaultValue={filter}
            options={[
              ["attention", "needs attention"],
              "published",
              "quarantined",
              "deprecated",
              "draft",
              "all",
            ]}
          />
          <TextField
            label="Slug or title"
            name="q"
            defaultValue={search}
            placeholder="postgres-…"
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

      {relations.length > 0 && permissions.relate && (
        <section className="mb-10">
          <h2 className="font-headline text-headline-md text-on-surface mb-1">
            Suggested relationships
          </h2>
          <p className="text-body-sm text-on-surface-variant mb-3 max-w-3xl">
            Proposed by the duplicate-candidate task. Invisible to readers until a human confirms —
            AI may propose a relationship and may never assert one.
          </p>
          <ul className="gap-gutter flex list-none flex-col">
            {relations.map((relation) => (
              <li key={relation.id}>
                <Card as="article">
                  <p className="text-body-sm text-on-surface mb-3 font-mono">
                    /p/{relation.from_slug} <span className="text-on-surface-variant">→</span>{" "}
                    {relation.relation_type} <span className="text-on-surface-variant">→</span> /p/
                    {relation.to_slug}
                  </p>
                  <div className="gap-gutter grid lg:grid-cols-2">
                    <ActionForm
                      intent="confirm_relation"
                      capability="playbooks:relate"
                      label="Confirm"
                      fields={{ relationId: relation.id }}
                    />
                    <ActionForm
                      intent="decline_relation"
                      capability="playbooks:relate"
                      label="Decline"
                      variant="ghost"
                      fields={{ relationId: relation.id }}
                    />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {playbooks.length === 0 ? (
        <EmptyState>No playbook matches this filter.</EmptyState>
      ) : (
        <ol className="gap-gutter flex list-none flex-col">
          {playbooks.map((row) => (
            <li key={row.id}>
              <Card as="article">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusChip
                    value={row.status}
                    alarming={row.status === "quarantined" || row.status === "deprecated"}
                  />
                  {row.revision_status && (
                    <StatusChip
                      value={row.revision_status}
                      alarming={row.revision_status === "needs_reverification"}
                    />
                  )}
                  {row.band && <StatusChip value={row.band} />}
                  {!row.current_revision_id && <StatusChip value="never published" alarming />}
                </div>

                <h2 className="font-headline text-body-md text-on-surface mb-1">
                  {row.title ?? "(no published revision)"}
                </h2>
                <p className="text-env-tag text-on-surface-variant mb-2 font-mono">
                  /p/{row.slug} · {shortId(row.id)}
                </p>

                <Detail label="Created">{formatInstant(row.created_at)}</Detail>
                <Detail label="Published">{formatInstant(row.published_at)}</Detail>
                {row.deprecated_at && (
                  <Detail label="Deprecated">
                    {formatInstant(row.deprecated_at)} · {row.deprecation_reason ?? "—"}
                  </Detail>
                )}
                {row.needs_reverification_at && (
                  <Detail label="Flagged">
                    {formatInstant(row.needs_reverification_at)} ·{" "}
                    {row.needs_reverification_reason ?? "—"}
                  </Detail>
                )}

                {focus === row.id ? (
                  <PlaybookActions row={row} permissions={permissions} />
                ) : (
                  <Link
                    to={`?${new URLSearchParams({ status: filter, q: search, focus: row.id })}`}
                    className="text-body-sm text-evidence-blue mt-2 inline-block underline"
                  >
                    Act on this playbook
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

function PlaybookActions({
  row,
  permissions,
}: {
  row: PlaybookRow;
  permissions: Record<string, boolean>;
}) {
  return (
    <div className="gap-gutter border-outline-variant mt-4 grid border-t pt-4 lg:grid-cols-2">
      {row.status !== "quarantined" && permissions.quarantine && (
        <div>
          <h3 className="text-label-caps text-on-surface-variant mb-1 font-mono uppercase">
            Quarantine
          </h3>
          <p className="text-body-sm text-on-surface-variant mb-2">
            Hides it from readers now. Reversible, and it asserts nothing about whether the content
            is correct.
          </p>
          <ActionForm
            intent="quarantine"
            capability="playbooks:quarantine"
            label="Quarantine"
            variant="danger"
            fields={{ playbookId: row.id }}
          />
        </div>
      )}

      {row.status === "quarantined" && permissions.unquarantine && (
        <div>
          <h3 className="text-label-caps text-on-surface-variant mb-1 font-mono uppercase">
            Release
          </h3>
          <ActionForm
            intent="unquarantine"
            capability="playbooks:unquarantine"
            label="Release from quarantine"
            fields={{ playbookId: row.id }}
          />
        </div>
      )}

      {row.revision_id && permissions.deprecate && row.status !== "deprecated" && (
        <div>
          <h3 className="text-label-caps text-on-surface-variant mb-1 font-mono uppercase">
            Deprecate
          </h3>
          <p className="text-body-sm text-on-surface-variant mb-2">
            States that the procedure no longer works. The revision stays readable at its stable
            URL, with its evidence — plan §9.
          </p>
          <ActionForm
            intent="deprecate"
            capability="playbooks:deprecate"
            label="Deprecate"
            variant="danger"
            fields={{ playbookId: row.id, revisionId: row.revision_id }}
          />
        </div>
      )}

      {row.revision_id && row.revision_status === "published" && permissions.flagReverification && (
        <div>
          <h3 className="text-label-caps text-on-surface-variant mb-1 font-mono uppercase">
            Flag for reverification
          </h3>
          <p className="text-body-sm text-on-surface-variant mb-2">
            Says the world moved and nobody has checked since. It is not a claim that the playbook
            is wrong.
          </p>
          <ActionForm
            intent="flag_reverification"
            capability="revisions:flag_reverification"
            label="Flag"
            fields={{ revisionId: row.revision_id }}
          />
        </div>
      )}
    </div>
  );
}

interface PlaybookRow {
  id: string;
  slug: string;
  status: string;
  visibility: string;
  current_revision_id: string | null;
  created_at: number;
  revision_id: string | null;
  title: string | null;
  revision_status: string | null;
  published_at: number | null;
  deprecated_at: number | null;
  deprecation_reason: string | null;
  needs_reverification_at: number | null;
  needs_reverification_reason: string | null;
  band: string | null;
}

interface RelationRow {
  id: string;
  relation_type: string;
  confirmation_state: string;
  created_at: number;
  from_slug: string;
  to_slug: string;
}

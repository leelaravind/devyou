import { Link, useSearchParams } from "react-router";
import { Card } from "@devyou/ui";
import { ApiError } from "@devyou/core";
import { can, isReasonCode } from "@devyou/auth";
import type { Route } from "./+types/moderation";
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
} from "../components/admin-forms";
import { formatAge, formatInstant, shortId } from "../lib/format";

/**
 * The moderation queue.
 *
 * A case is a *request for a decision*, and closing one always records who decided and
 * why. `moderation_cases.origin` distinguishes a human report from an automated rule
 * from an AI suggestion, and that distinction is load-bearing: AI may open a case and may
 * never close one. Invariant 5 forbids AI changing verification state, publishing,
 * deleting or suspending, and a case an AI could resolve itself would be all four by a
 * different route. There is consequently no path in this file that writes a resolution on
 * anybody's behalf — every resolution carries `actor.userId`.
 *
 * Ordering is by severity, then oldest first. A queue sorted newest-first is a queue
 * whose bottom is never reached, and the case that has waited eleven days is exactly the
 * one worth surfacing.
 */

const OPEN_STATUSES = ["open", "investigating"] as const;

export function meta() {
  return [{ title: "Moderation — DevYou admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, actor } = await requireAdmin(context, "moderation:view");
  const url = new URL(request.url);
  const showClosed = url.searchParams.get("closed") === "1";
  const focus = url.searchParams.get("focus");

  const cases = await env.DB.prepare(
    showClosed
      ? `SELECT c.id, c.subject_type, c.subject_id, c.reason, c.origin, c.severity, c.status,
                c.detail, c.created_at, c.resolution_reason, c.resolved_at, p.handle AS reporter_handle
           FROM moderation_cases c
           LEFT JOIN profiles p ON p.user_id = c.reporter_id
          ORDER BY c.created_at DESC
          LIMIT 100`
      : `SELECT c.id, c.subject_type, c.subject_id, c.reason, c.origin, c.severity, c.status,
                c.detail, c.created_at, c.resolution_reason, c.resolved_at, p.handle AS reporter_handle
           FROM moderation_cases c
           LEFT JOIN profiles p ON p.user_id = c.reporter_id
          WHERE c.status IN (?1, ?2)
          ORDER BY CASE c.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
                   c.created_at ASC
          LIMIT 100`,
  )
    .bind(...(showClosed ? [] : OPEN_STATUSES))
    .all<CaseRow>();

  /*
    Linked evidence is fetched only for the focused case.

    `moderation_case_evidence` lets a case point at the exact records it concerns without
    duplicating them. Joining it into the list query would multiply rows and force a
    de-duplication pass for information nobody reads until they open a case.
  */
  const linked = focus
    ? await env.DB.prepare(
        `SELECT evidence_record_id, reproduction_report_id, playbook_id, revision_id
           FROM moderation_case_evidence WHERE case_id = ?1`,
      )
        .bind(focus)
        .all<LinkedRow>()
    : { results: [] as LinkedRow[] };

  return {
    cases: cases.results,
    linked: linked.results,
    showClosed,
    mayResolve: can(actor.role, "moderation:resolve"),
    mayEscalate: can(actor.role, "moderation:escalate"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  return runAction(async () => {
    const { env, actor, form, intent } = await beginAdminAction(request, context);
    const caseId = requiredField(form, "caseId");
    const reason = reasonFrom(form);

    if (intent === "escalate") {
      /* Escalation is not a decision, so it writes no `resolution_reason`: the case stays
         open and stays in the queue. Raising severity is a statement about urgency, and
         conflating it with an outcome would let "this is serious" close a case. */
      await performAdminAction(
        env.DB,
        {
          actor,
          capability: "moderation:escalate",
          subjectType: "moderation_case",
          subjectId: caseId,
          ...reason,
          change: { severity: ["normal", "critical"], status: ["open", "investigating"] },
        },
        [
          env.DB.prepare(
            `UPDATE moderation_cases SET severity = 'critical', status = 'investigating'
              WHERE id = ?1 AND status IN ('open', 'investigating')`,
          ).bind(caseId),
        ],
      );
      return { ok: true as const, message: `Case ${shortId(caseId)} escalated.` };
    }

    if (intent === "resolve") {
      const outcome = requiredField(form, "outcome");
      if (outcome !== "actioned" && outcome !== "dismissed") {
        throw new ApiError("BAD_REQUEST", { internalDetail: `bad moderation outcome ${outcome}` });
      }

      /*
        `resolution_reason` is required here even though `moderation:resolve` is absent
        from `REQUIRES_REASON` in `@devyou/auth`.

        The two are different fields answering different questions. The audit row records
        why the *administrator acted*; this column records why the *case is closed*, which
        is what a reporter is owed and what somebody triaging a repeat report needs.
        `moderation_cases.resolutionReason` documents it as required, so it is enforced
        rather than assumed.

        Requiring more than the matrix demands is safe. Requiring less would not be — and
        the matrix is never consulted here for anything but `can()` and `requiresReason()`.
      */
      if (!reason.reasonCode || !isReasonCode(reason.reasonCode)) {
        throw new ApiError("UNPROCESSABLE", {
          publicMessage: "Closing a case needs a reason code — it is what the reporter is owed.",
          fieldErrors: { reasonCode: "Choose a reason code." },
          internalDetail: "moderation resolve without reason code",
        });
      }

      await performAdminAction(
        env.DB,
        {
          actor,
          capability: "moderation:resolve",
          subjectType: "moderation_case",
          subjectId: caseId,
          ...reason,
          change: { status: ["open", outcome] },
        },
        [
          env.DB.prepare(
            `UPDATE moderation_cases
                SET status = ?1, resolution_reason = ?2, resolved_by = ?3, resolved_at = unixepoch()
              WHERE id = ?4 AND status IN ('open', 'investigating')`,
          ).bind(outcome, reason.reasonCode, actor.userId, caseId),
        ],
      );
      return { ok: true as const, message: `Case ${shortId(caseId)} ${outcome}.` };
    }

    throw new ApiError("BAD_REQUEST", { internalDetail: `unknown moderation intent ${intent}` });
  });
}

export default function Moderation({ loaderData, actionData }: Route.ComponentProps) {
  const { cases, linked, showClosed, mayResolve, mayEscalate } = loaderData;
  const [params] = useSearchParams();
  const focus = params.get("focus");

  return (
    <SurfaceLayout>
      <SurfaceHeader
        title="Moderation"
        description="Reports and automated findings awaiting a human decision. AI may open a case here and may never close one — closing always records which administrator decided, and why."
      >
        <Link
          to={showClosed ? "/moderation" : "/moderation?closed=1"}
          className="text-body-sm text-evidence-blue underline"
        >
          {showClosed ? "Show only open cases" : "Include closed cases"}
        </Link>
      </SurfaceHeader>

      {actionData?.ok && (
        <p className="border-status-confirmed/40 bg-surface-container text-body-sm text-status-confirmed mb-6 rounded border p-3">
          {actionData.message}
        </p>
      )}

      {cases.length === 0 ? (
        <EmptyState>
          `moderation_cases` returned no rows for this filter. If reports are being filed on the
          public site and nothing appears here, the reporting path is the thing to check, not this
          page.
        </EmptyState>
      ) : (
        <ol className="gap-gutter flex list-none flex-col">
          {cases.map((entry) => (
            <li key={entry.id}>
              <Card as="article" interactive={entry.id !== focus}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusChip value={entry.status} alarming={entry.severity === "critical"} />
                  <StatusChip value={entry.severity} alarming={entry.severity === "critical"} />
                  <StatusChip value={entry.origin} />
                  <span className="text-env-tag text-on-surface-variant font-mono">
                    {formatAge(entry.created_at)} old
                  </span>
                </div>

                <h2 className="font-headline text-body-md text-on-surface mb-1">
                  {entry.reason} · {entry.subject_type}
                </h2>
                <p className="text-env-tag text-on-surface-variant mb-2 font-mono">
                  {shortId(entry.subject_id)}
                </p>
                {entry.detail && (
                  <p className="text-body-sm text-on-surface-variant mb-3">{entry.detail}</p>
                )}

                {entry.id === focus ? (
                  <FocusedCase
                    entry={entry}
                    linked={linked}
                    mayResolve={mayResolve}
                    mayEscalate={mayEscalate}
                  />
                ) : (
                  <Link
                    to={`/moderation?focus=${encodeURIComponent(entry.id)}${showClosed ? "&closed=1" : ""}`}
                    className="text-body-sm text-evidence-blue underline"
                  >
                    Open
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

function FocusedCase({
  entry,
  linked,
  mayResolve,
  mayEscalate,
}: {
  entry: CaseRow;
  linked: LinkedRow[];
  mayResolve: boolean;
  mayEscalate: boolean;
}) {
  const closed = entry.status === "actioned" || entry.status === "dismissed";

  return (
    <div className="border-outline-variant mt-3 border-t pt-3">
      <Detail label="Case id">{entry.id}</Detail>
      <Detail label="Reported by">{entry.reporter_handle ?? "anonymous or deleted"}</Detail>
      <Detail label="Opened">{formatInstant(entry.created_at)}</Detail>
      {closed && (
        <>
          <Detail label="Closed">{formatInstant(entry.resolved_at)}</Detail>
          <Detail label="Resolution">{entry.resolution_reason ?? "—"}</Detail>
        </>
      )}

      {linked.length > 0 && (
        <Detail label="Linked records">
          <span className="text-env-tag font-mono">
            {linked
              .map(
                (row) =>
                  row.evidence_record_id ??
                  row.reproduction_report_id ??
                  row.revision_id ??
                  row.playbook_id ??
                  "?",
              )
              .join(", ")}
          </span>
        </Detail>
      )}

      {closed ? (
        /*
          A closed case shows no controls, and there is no reopen.

          Reopening would rewrite a resolution somebody is relying on. A repeat report
          opens a new case, which is the honest record: the same subject was reported
          twice, and both decisions stay visible.
        */
        <p className="text-body-sm text-on-surface-variant mt-3">
          This case is closed. A further report on the same subject opens a new case rather than
          reopening this one, so both decisions stay on the record.
        </p>
      ) : (
        <div className="gap-gutter mt-4 grid lg:grid-cols-2">
          {mayResolve && (
            <div>
              <h3 className="text-label-caps text-on-surface-variant mb-2 font-mono uppercase">
                Close this case
              </h3>
              <ActionForm
                intent="resolve"
                capability="moderation:resolve"
                label="Close case"
                variant="danger"
                fields={{ caseId: entry.id }}
              >
                <SelectField
                  label="Outcome"
                  description="Actioned means something changed as a result."
                  name="outcome"
                  required
                  defaultValue="actioned"
                  options={["actioned", "dismissed"]}
                />
              </ActionForm>
            </div>
          )}

          {mayEscalate && (
            <div>
              <h3 className="text-label-caps text-on-surface-variant mb-2 font-mono uppercase">
                Escalate
              </h3>
              <p className="text-body-sm text-on-surface-variant mb-2">
                Raises severity to critical and marks the case as being worked. It stays open and
                stays in the queue.
              </p>
              <ActionForm
                intent="escalate"
                capability="moderation:escalate"
                label="Escalate"
                fields={{ caseId: entry.id }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CaseRow {
  id: string;
  subject_type: string;
  subject_id: string;
  reason: string;
  origin: string;
  severity: string;
  status: string;
  detail: string | null;
  created_at: number;
  resolution_reason: string | null;
  resolved_at: number | null;
  reporter_handle: string | null;
}

interface LinkedRow {
  evidence_record_id: string | null;
  reproduction_report_id: string | null;
  playbook_id: string | null;
  revision_id: string | null;
}

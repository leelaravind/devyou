import { Form } from "react-router";
import { Card } from "@devyou/ui";
import { STATEMENTS, can } from "@devyou/auth";
import type { Route } from "./+types/audit";
import { requireAdmin } from "../lib/route.server";
import {
  Detail,
  EmptyState,
  ReasonFields,
  SelectField,
  StatusChip,
  SurfaceHeader,
  SurfaceLayout,
  TextField,
} from "../components/admin-forms";
import { formatInstant, shortId } from "../lib/format";

/**
 * The audit log.
 *
 * Append-only at the database — `admin_audit_events` has triggers rejecting every UPDATE
 * and every DELETE (migration 0001 §5) — so there is no edit control on this page and
 * there could not be one. Nothing this Worker can send would be accepted.
 *
 * Read-only, with one exception that is itself audited: exporting. `audit:export` is in
 * `REQUIRES_REASON`, and the export writes its own row before producing a file. "Who took
 * a copy of the entire governance history, when, and why" is exactly the kind of question
 * an audit log exists to answer, and an export that left no trace would be the one action
 * on this surface that escaped it.
 *
 * The capability filter is built from `STATEMENTS` rather than from the distinct values
 * present in the table. A capability that has never been exercised still appears in the
 * dropdown, which is how somebody notices that nothing has ever been quarantined — a
 * filter built from observed data can only ever show you what already happened.
 */

export function meta() {
  return [{ title: "Audit log — DevYou admin" }];
}

const PAGE_SIZE = 100;

const ALL_CAPABILITIES = Object.entries(STATEMENTS).flatMap(([resource, actions]) =>
  actions.map((action) => `${resource}:${action}`),
);

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, actor } = await requireAdmin(context, "audit:view");
  const url = new URL(request.url);

  const capability = url.searchParams.get("capability")?.trim() ?? "";
  const subject = url.searchParams.get("subject")?.trim() ?? "";
  const actorQuery = url.searchParams.get("actor")?.trim() ?? "";

  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (capability) {
    bindings.push(capability);
    conditions.push(`e.capability = ?${bindings.length}`);
  }
  if (subject) {
    bindings.push(subject);
    conditions.push(`e.subject_id = ?${bindings.length}`);
  }
  if (actorQuery) {
    bindings.push(actorQuery);
    conditions.push(`(e.actor_id = ?${bindings.length} OR p.handle = ?${bindings.length})`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const events = await env.DB.prepare(
    `SELECT e.id, e.actor_id, e.capability, e.subject_type, e.subject_id,
            e.reason_code, e.reason_detail, e.change_json, e.step_up_verified, e.created_at,
            p.handle AS actor_handle
       FROM admin_audit_events e
       LEFT JOIN profiles p ON p.user_id = e.actor_id
       ${where}
      ORDER BY e.created_at DESC
      LIMIT ${PAGE_SIZE}`,
  )
    .bind(...bindings)
    .all<AuditRow>();

  return {
    events: events.results,
    capability,
    subject,
    actorQuery,
    capabilities: ALL_CAPABILITIES,
    mayExport: can(actor.role, "audit:export"),
  };
}

export default function Audit({ loaderData }: Route.ComponentProps) {
  const { events, capability, subject, actorQuery, capabilities, mayExport } = loaderData;

  return (
    <SurfaceLayout>
      <SurfaceHeader
        title="Audit log"
        description="Every privileged action taken in this console. Append-only at the database, so there is no edit control here and there could not be one — nothing this Worker could send would be accepted."
      >
        <Form method="get" className="gap-gutter flex flex-wrap items-end">
          <SelectField
            label="Capability"
            name="capability"
            defaultValue={capability}
            options={[["", "any"] as const, ...capabilities]}
          />
          <TextField
            label="Subject id"
            name="subject"
            defaultValue={subject}
            placeholder="pbk_… / usr_…"
          />
          <TextField label="Actor id or handle" name="actor" defaultValue={actorQuery} />
          <button
            type="submit"
            className="bg-primary text-label-caps text-on-primary rounded px-4 py-2 font-mono uppercase"
          >
            Filter
          </button>
        </Form>
      </SurfaceHeader>

      {mayExport && (
        <Card as="section" className="mb-8">
          <h2 className="font-headline text-body-md text-on-surface mb-1">Export</h2>
          <p className="text-body-sm text-on-surface-variant mb-3 max-w-3xl">
            Produces a CSV of the current filter, up to 5000 rows, and writes an audit row recording
            that it happened. A POST rather than a link, so a prefetching browser cannot record an
            export nobody performed.
          </p>
          {/*
            The filter fields are repeated as hidden inputs rather than read from the URL by
            the export route.

            The export must produce exactly what the operator was looking at. Re-deriving
            the filter from a referrer or from the query string of a POST is one redirect
            away from exporting something else, and the audit row would name the filter that
            was asked for rather than the one that ran.
          */}
          <Form method="post" action="/audit/export" className="gap-density-high flex flex-col">
            <input type="hidden" name="capability" value={capability} />
            <input type="hidden" name="subject" value={subject} />
            <input type="hidden" name="actor" value={actorQuery} />
            <ReasonFields capability="audit:export" />
            <button
              type="submit"
              className="bg-surface-container-high text-label-caps text-on-surface w-fit rounded px-4 py-2 font-mono uppercase"
            >
              Export CSV
            </button>
          </Form>
        </Card>
      )}

      {events.length === 0 ? (
        <EmptyState>No audited action matches this filter.</EmptyState>
      ) : (
        <ol className="flex list-none flex-col gap-2">
          {events.map((event) => (
            <li key={event.id}>
              <Card as="article">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusChip value={event.capability} />
                  <StatusChip value={event.reason_code} />
                  <span className="text-env-tag text-on-surface-variant font-mono">
                    {formatInstant(event.created_at)}
                  </span>
                </div>
                <Detail label="Actor">
                  {event.actor_handle ? `@${event.actor_handle}` : (event.actor_id ?? "deleted")}
                </Detail>
                <Detail label="Subject">
                  {event.subject_type} · {shortId(event.subject_id)}
                </Detail>
                {event.reason_detail && <Detail label="Detail">{event.reason_detail}</Detail>}
                {event.change_json && (
                  <Detail label="Change">
                    <span className="font-mono break-all">{event.change_json}</span>
                  </Detail>
                )}
                {/*
                  `step_up_verified` is shown even though it is always false today.

                  Hiding a column because it currently has one value is how a control
                  disappears from view and then from memory. It reads as "no second factor
                  was required", which is the truth — see the closing note in
                  perimeter.server.ts.
                */}
                <Detail label="Step-up">
                  {event.step_up_verified === 1 ? "verified" : "not required"}
                </Detail>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </SurfaceLayout>
  );
}

interface AuditRow {
  id: string;
  actor_id: string | null;
  capability: string;
  subject_type: string;
  subject_id: string;
  reason_code: string;
  reason_detail: string | null;
  change_json: string | null;
  step_up_verified: number;
  created_at: number;
  actor_handle: string | null;
}

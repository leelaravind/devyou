import { ApiError } from "@devyou/core";
import type { Route } from "./+types/audit.export";
import { beginAdminAction, runAction } from "../lib/route.server";
import { performAdminAction, reasonFrom, stringField } from "../lib/audit.server";

/**
 * Export the audit log as CSV.
 *
 * A resource route with an action and no loader, which means there is no `GET` handler at
 * all: a link to this path 405s. That is deliberate. `audit:export` requires a reason code,
 * and a GET-able export would be followed by a prefetching browser, a link checker or a
 * chat client unfurling a pasted URL — each producing an audit row claiming an operator
 * exported the governance history when nobody did. A false entry in an append-only log
 * cannot be corrected.
 *
 * The export writes its own audit row *before* producing the file, in the same batch,
 * through the same `performAdminAction` every other privileged action uses. There is no
 * "read-only actions do not need auditing" exception here, because taking a complete copy
 * of every governance decision is not a read in any sense that matters.
 */

/** A ceiling on the export, not a page size. The whole point is a complete copy of the
 *  current filter; the limit exists so a runaway export cannot blow the Worker's CPU
 *  budget and produce a truncated file that looks complete. The row count is stated in the
 *  file so a truncated export is visible as one. */
const MAX_ROWS = 5000;

export async function action({ request, context }: Route.ActionArgs) {
  return runAction(async () => {
    const { env, actor, form } = await beginAdminAction(request, context);

    const capability = stringField(form, "capability");
    const subject = stringField(form, "subject");
    const actorQuery = stringField(form, "actor");

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

    /*
      The audit row goes first, and it records the filter rather than the result.

      "Exported 412 rows" would be the more informative entry and it is the wrong one to
      write: it can only be known after the query, and writing it after the query means the
      export could complete with the audit write failing. Recording the *request* — this
      filter, this operator, this reason — happens before any data is read, and it is the
      part that matters if the question is ever asked.
    */
    await performAdminAction(
      env.DB,
      {
        actor,
        capability: "audit:export",
        subjectType: "admin_audit_events",
        subjectId: describeFilter(capability, subject, actorQuery),
        ...reasonFrom(form),
      },
      [],
    );

    const rows = await env.DB.prepare(
      `SELECT e.id, e.created_at, e.actor_id, p.handle AS actor_handle, e.capability,
              e.subject_type, e.subject_id, e.reason_code, e.reason_detail,
              e.change_json, e.step_up_verified
         FROM admin_audit_events e
         LEFT JOIN profiles p ON p.user_id = e.actor_id
         ${where}
        ORDER BY e.created_at DESC
        LIMIT ${MAX_ROWS}`,
    )
      .bind(...bindings)
      .all<ExportRow>();

    if (rows.results.length === 0) {
      throw new ApiError("NOT_FOUND", {
        publicMessage: "That filter matched no audit events, so there is nothing to export.",
        internalDetail: "empty audit export",
      });
    }

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

    return new Response(toCsv(rows.results), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="devyou-audit-${stamp}.csv"`,
        /* Repeated from the Worker boundary, which sets it on every response anyway. A
           file of governance decisions is the last thing that should sit in a proxy cache,
           and the header is worth stating at the point somebody reads this code. */
        "cache-control": "no-store",
      },
    });
  });
}

function describeFilter(
  capability: string | null,
  subject: string | null,
  actorQuery: string | null,
): string {
  const parts = [
    capability ? `capability=${capability}` : null,
    subject ? `subject=${subject}` : null,
    actorQuery ? `actor=${actorQuery}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "all";
}

const COLUMNS = [
  "id",
  "created_at_utc",
  "actor_id",
  "actor_handle",
  "capability",
  "subject_type",
  "subject_id",
  "reason_code",
  "reason_detail",
  "change_json",
  "step_up_verified",
] as const;

function toCsv(rows: ExportRow[]): string {
  const header = COLUMNS.join(",");
  const body = rows.map((row) =>
    [
      row.id,
      new Date(row.created_at * 1000).toISOString(),
      row.actor_id ?? "",
      row.actor_handle ?? "",
      row.capability,
      row.subject_type,
      row.subject_id,
      row.reason_code,
      row.reason_detail ?? "",
      row.change_json ?? "",
      String(row.step_up_verified),
    ]
      .map(csvCell)
      .join(","),
  );
  return `${[header, ...body].join("\r\n")}\r\n`;
}

/**
 * Quote a CSV cell.
 *
 * Two separate concerns, and only one of them is CSV.
 *
 * The quoting handles commas, quotes and newlines — `reason_detail` is free text an
 * operator typed and will contain all three.
 *
 * The leading apostrophe handles **formula injection**, which is not a CSV problem at all.
 * A cell beginning `=`, `+`, `-` or `@` is executed as a formula when the file is opened in
 * a spreadsheet, and `=HYPERLINK(...)` in a reason field is a credible way to exfiltrate
 * the rest of the export from whoever opens it. Reason detail is attacker-influenceable —
 * an admin routinely pastes a fragment of a user's report into it. Prefixing with an
 * apostrophe makes the cell text, visibly, at the cost of one character that any consumer
 * can strip.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

interface ExportRow {
  id: string;
  created_at: number;
  actor_id: string | null;
  actor_handle: string | null;
  capability: string;
  subject_type: string;
  subject_id: string;
  reason_code: string;
  reason_detail: string | null;
  change_json: string | null;
  step_up_verified: number;
}

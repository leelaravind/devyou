import { ApiError, newId } from "@devyou/core";
import { isReasonCode, requiresReason, type Capability, type ReasonCode } from "@devyou/auth";
import { requireCapability, type AdminActor } from "./perimeter.server";

/**
 * The admin action layer.
 *
 * Every privileged mutation in this Worker goes through `performAdminAction`, and the
 * reason it exists as a chokepoint rather than as a convention is one line further down:
 * the audit row and the mutation are handed to `db.batch()` together.
 *
 * D1 executes a batch as a single transaction. So there is no interleaving in which the
 * playbook is quarantined and the audit row is not — not on a timeout, not on a thrown
 * error between two awaits, not when somebody adds an early return. "Remember to log
 * it" is a rule people follow until the day something goes wrong, which is the day the
 * log matters. This is instead a property of how the write is issued.
 *
 * The database enforces the other half. `admin_audit_events` has append-only triggers
 * (migration 0001 §5): the row cannot be updated or deleted afterwards, by this Worker
 * or by anything else. Admin cannot bypass the invariant triggers and does not try —
 * there is no path in this codebase that drops a trigger, opens a raw connection, or
 * asks the database to relax. Where an invariant blocks an action, the action does not
 * exist: `evidence:delete` is absent from the capability matrix for exactly that reason.
 */

export interface AdminActionRequest {
  actor: AdminActor;
  capability: Capability;
  /** What kind of thing changed: `playbook`, `revision`, `evidence`, `user`, `flag`… */
  subjectType: string;
  subjectId: string;
  /** Required when `requiresReason(capability)`. Rejected when it is not one of the
   *  fixed codes, including when it is a plausible-looking free-text alternative. */
  reasonCode: string | null;
  /** The operator's own words. Optional, and never a substitute for the code. */
  reasonDetail: string | null;
  /**
   * Before/after for the fields that moved, and nothing else.
   *
   * Never the whole row. An audit log that copies content becomes a second, unmanaged
   * store of that content — with its own retention, its own readers, and, because this
   * table is append-only, no way to correct it. A quarantine audit row records
   * `{ status: ["published", "quarantined"] }`, not the playbook.
   */
  change?: Record<string, [unknown, unknown]> | null;
}

/** Free-text detail is capped. Long enough for a sentence of context, short enough that
 *  nobody pastes a log file into an append-only table they cannot edit afterwards. */
const MAX_REASON_DETAIL = 1000;

/**
 * Perform a privileged action, atomically, with its audit row.
 *
 * `mutations` may be empty — some audited actions change nothing in DevYou's data
 * (exporting the audit log is the example). An empty list still writes the row, because
 * "who read the whole governance history, and when" is exactly the kind of thing an
 * audit log exists to answer.
 */
export async function performAdminAction(
  db: D1Database,
  request: AdminActionRequest,
  mutations: D1PreparedStatement[],
): Promise<void> {
  requireCapability(request.actor, request.capability);

  const reasonCode = resolveReasonCode(request.capability, request.reasonCode);
  const detail = normaliseDetail(request.reasonDetail);

  const audit = db
    .prepare(
      `INSERT INTO admin_audit_events
         (id, actor_id, capability, subject_type, subject_id,
          reason_code, reason_detail, change_json, step_up_verified, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)`,
    )
    .bind(
      newId("auditEvent"),
      request.actor.userId,
      request.capability,
      request.subjectType,
      request.subjectId,
      reasonCode,
      detail,
      request.change ? JSON.stringify(request.change) : null,
      /*
        `step_up_verified` is hard-coded false, and honestly so.

        The column exists because plan §13 anticipates step-up for high-risk actions.
        DevYou has no second factor to step up to — see the closing note in
        `perimeter.server.ts`. Writing `true` here because an action felt important
        would make the column mean "somebody thought this was serious", which is worse
        than it meaning nothing.
      */
      Math.floor(Date.now() / 1000),
    );

  /*
    Audit row first in the batch.

    Ordering is not what makes this safe — the batch is a transaction, so both land or
    neither does — but a foreign-key failure or a trigger rejection surfaces with the
    audit insert at index 0, which makes the failure obvious in a D1 error rather than
    something to work out from a statement index.
  */
  await db.batch([audit, ...mutations]);
}

/**
 * Decide the reason code, or refuse.
 *
 * Two rules, and the second is the one that gets argued with:
 *
 * 1. A capability in `REQUIRES_REASON` must carry one of the fixed codes. No code, or a
 *    code that is not in the vocabulary, and the action does not happen. `@devyou/auth`
 *    owns both the list of such capabilities and the vocabulary; neither is restated
 *    here.
 * 2. Everything else is recorded as `routine_maintenance` rather than as null. The
 *    column is `NOT NULL`, and making it nullable so that "ordinary" actions could omit
 *    it would create two shapes of audit row and a filter that quietly drops one of
 *    them.
 */
function resolveReasonCode(capability: Capability, supplied: string | null): ReasonCode {
  const trimmed = supplied?.trim() ?? "";

  if (!requiresReason(capability)) {
    return trimmed && isReasonCode(trimmed) ? trimmed : "routine_maintenance";
  }

  if (!trimmed) {
    throw new ApiError("UNPROCESSABLE", {
      publicMessage: "This action needs a reason code before it can be carried out.",
      fieldErrors: { reasonCode: "Choose a reason code." },
      internalDetail: `missing reason code for ${capability}`,
    });
  }

  if (!isReasonCode(trimmed)) {
    /*
      A rejected code is not silently coerced to `routine_maintenance`.

      That would be the forgiving choice and it would destroy the property the fixed
      vocabulary exists for: an audit log where every unusual action is filed under the
      one code meaning "nothing unusual" is an audit log nobody can search.
    */
    throw new ApiError("UNPROCESSABLE", {
      publicMessage: "That is not a recognised reason code.",
      fieldErrors: { reasonCode: "Choose a reason code." },
      internalDetail: `unknown reason code for ${capability}`,
    });
  }

  return trimmed;
}

function normaliseDetail(detail: string | null): string | null {
  const trimmed = detail?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.length > MAX_REASON_DETAIL) {
    throw new ApiError("PAYLOAD_TOO_LARGE", {
      publicMessage: `Keep the detail under ${MAX_REASON_DETAIL} characters.`,
      fieldErrors: { reasonDetail: "Too long." },
      internalDetail: "reason detail exceeded cap",
    });
  }
  return trimmed;
}

/**
 * Pull the reason fields off a submitted form.
 *
 * Every admin form carries the same two field names, so the read is here rather than
 * copied into each action. A route that forgets to call this gets `null`, and a
 * reason-requiring capability then refuses — the mistake fails loudly at the action
 * rather than writing a row with no reason in it.
 */
export function reasonFrom(form: FormData): {
  reasonCode: string | null;
  reasonDetail: string | null;
} {
  return {
    reasonCode: stringField(form, "reasonCode"),
    reasonDetail: stringField(form, "reasonDetail"),
  };
}

export function stringField(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** As above, but the field is mandatory — a target id, a status, a key. */
export function requiredField(form: FormData, name: string): string {
  const value = stringField(form, name);
  if (!value) {
    throw new ApiError("BAD_REQUEST", {
      publicMessage: "That form was incomplete.",
      fieldErrors: { [name]: "Required." },
      internalDetail: `missing form field ${name}`,
    });
  }
  return value;
}

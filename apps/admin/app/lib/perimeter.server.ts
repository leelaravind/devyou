import { ApiError } from "@devyou/core";
import { assertSameOrigin, can, isAdminRole, type Capability } from "@devyou/auth";
import type { AccessIdentity } from "./access.server";

/**
 * The perimeter, in order.
 *
 * ```
 * Cloudflare Access JWT   → who this is           (workers/app.ts, before any route)
 * same-origin assertion   → CSRF, on writes only
 * DevYou user row         → whether they exist here at all
 * account status          → and are still allowed to
 * role → capability       → and may do this particular thing
 * reason code             → and have said why, where it is visible to somebody
 * ```
 *
 * The ordering mirrors ATSYou's admin perimeter deliberately (Phase 0 audit §3): it is
 * the network's reviewed posture, and re-deriving it would be a regression dressed as
 * independence. Two layers of theirs are absent and their absence is stated rather than
 * silent — see "Not yet implemented" at the foot of this file.
 *
 * The load-bearing idea is that **Access proves who, and `users.role` decides what**,
 * and that neither is sufficient. Access is configured in the Cloudflare dashboard by
 * whoever administers Zero Trust for the whole network; if that were the only gate, then
 * adding an employee to a directory group would silently grant them the ability to
 * suppress evidence and change confidence figures on a public product. So an Access
 * identity with no matching active DevYou user row gets nothing at all — not a
 * read-only view, not an empty page, nothing.
 */

export interface AdminActor {
  userId: string;
  role: string;
  /** The Access subject, kept for the audit trail. The DevYou row is authoritative for
   *  authorisation; this records which Access identity was presented at the door. */
  accessSubject: string;
  displayName: string;
  handle: string | null;
}

/**
 * Resolve the DevYou actor behind a verified Access identity.
 *
 * The join is on `users.email`, which is the only field both systems know about. That
 * makes an operator's admin access follow their email address, and it is worth being
 * explicit about the consequence: changing a DevYou user's email changes who can act as
 * them. `users_email_unique` prevents two rows from claiming one address, and the
 * `status = 'active'` predicate means suspending an account revokes admin access by the
 * same action that revokes everything else, rather than by a second thing to remember.
 */
export async function resolveActor(
  db: D1Database,
  identity: AccessIdentity,
): Promise<AdminActor | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.role, u.status, p.handle, p.display_name
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
        WHERE u.email = ?1 AND u.status = 'active'`,
    )
    .bind(identity.subject)
    .first<{
      id: string;
      role: string;
      status: string;
      handle: string | null;
      display_name: string | null;
    }>();

  if (!row) return null;

  /*
    A role that is not an admin role is refused here rather than left to fail on the
    first capability check.

    `contributor` grants no capability, so every surface would refuse them anyway — but
    it would refuse them one page at a time, which reads as "this page is broken" rather
    than "you are not an administrator". Failing once, at the door, with a clear message
    is both kinder and easier to support.
  */
  if (!isAdminRole(row.role)) return null;

  return {
    userId: row.id,
    role: row.role,
    accessSubject: identity.subject,
    displayName: row.display_name ?? identity.subject,
    handle: row.handle,
  };
}

/**
 * Resolve the actor or refuse the request.
 *
 * The refusal is deliberately identical whether the Access identity has no user row, has
 * a suspended one, or has a non-admin role. Distinguishing them would turn this surface
 * into an oracle for "which of my colleagues holds a DevYou admin role", answerable by
 * anybody who already passed Access — which on a shared team domain is a larger set of
 * people than the set who should be here.
 */
export async function requireActor(db: D1Database, identity: AccessIdentity): Promise<AdminActor> {
  const actor = await resolveActor(db, identity);
  if (!actor) {
    throw new ApiError("FORBIDDEN", {
      publicMessage:
        "You passed Cloudflare Access but hold no active DevYou administrator account. Ask a dev_admin to provision one.",
      internalDetail: `no active admin user for access subject (kind=${identity.kind})`,
    });
  }
  return actor;
}

/**
 * Assert a capability.
 *
 * `can()` from `@devyou/auth` and nothing else. The matrix is not re-stated, not
 * wrapped in a local helper with a friendlier name, and not summarised in a constant
 * here — a second copy of an authorisation rule is a second thing to keep in step, and
 * the copy is always the one that is out of date.
 *
 * 403 rather than 404, which inverts the public API's convention on purpose. On a public
 * object endpoint a 403 confirms the object exists and turns the endpoint into an
 * enumeration oracle. Every caller here has already passed Access *and* holds an admin
 * role, so there is nothing left to enumerate, and an honest 403 makes a permissions
 * problem diagnosable instead of looking like missing data. `notFoundOrForbidden` in
 * `@devyou/core` encodes exactly this distinction.
 */
export function requireCapability(actor: AdminActor, capability: Capability): void {
  if (!can(actor.role, capability)) {
    throw new ApiError("FORBIDDEN", {
      publicMessage: `Your role (${actor.role}) does not include ${capability}.`,
      internalDetail: `capability refused: ${actor.role} lacks ${capability}`,
    });
  }
}

/**
 * Refuse a cross-origin state change.
 *
 * Every admin mutation is a same-origin `<form method="post">`. There is no cross-origin
 * caller to accommodate, so the check has no false positives, and it fails closed when
 * the `Origin` header is absent on a method that should always send one.
 *
 * Access issues its own `CF_Authorization` cookie, and a cookie is a cookie: a POST from
 * an attacker's page to this hostname would carry it and would arrive here already past
 * the outer gate. Access authenticates the browser, not the intent. This is the layer
 * that distinguishes them.
 */
export function requireSameOrigin(request: Request, env: Env): void {
  assertSameOrigin(request, env.ADMIN_APP_URL);
}

/* ---------------------------------------------------------------------------
   Not yet implemented, and recorded rather than quietly dropped
   ---------------------------------------------------------------------------

   ATSYou's perimeter has two layers after the role check that DevYou does not:

   - **2FA enrolment.** Theirs is enforced against a better-auth account that carries
     enrolment state. DevYou's only identity provider is GitHub OAuth (ADR-0009), which
     tells us nothing about the operator's second factor, and DevYou stores no
     enrolment state to check. The honest place for this requirement is the Access
     policy — a Zero Trust policy can require a hardware key or an MFA-asserting IdP,
     which is stronger than an application-level flag because it is enforced before the
     request exists. It is therefore part of owner action A0-1 rather than code here.

   - **Per-action step-up.** `admin_audit_events.step_up_verified` exists in the schema
     for this and is written as `false` by every action below, honestly. Implementing it
     needs a second factor to step up *to*, which is the same missing piece.

   Plan §13 says high-risk actions "should support step-up authentication **if the
   shared console already provides it**". There is no shared console (ADR-0001), so the
   condition is not met, and inventing a DevYou-specific second factor would be
   inventing a requirement to resolve an ambiguity. It is recorded here instead. */

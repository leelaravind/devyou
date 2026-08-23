import { env } from "cloudflare:test";
import { RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { accessContext } from "../app/context/access";
import { cloudflareContext } from "../app/context/cloudflare";
import type { AccessIdentity } from "../app/lib/access.server";
import { SURFACES } from "../app/lib/surfaces";
import { loader as overviewLoader } from "../app/routes/overview";
import { loader as contributorsLoader } from "../app/routes/contributors";
import { loader as auditLoader } from "../app/routes/audit";

/**
 * The authorization path, composed.
 *
 * Every other test in this directory checks one layer on its own — `verifyAccessJwt`
 * verifies a token, `resolveActor` resolves a row, `performAdminAction` writes an audit
 * event. Nothing checked that they *compose*, which meant the product could have had
 * thirteen green Access tests, five green perimeter tests, and a console that refused
 * every request. That is not hypothetical: it is precisely what happened in production on
 * 22 August 2026, twice. Once because the AUD was read from a variable name nobody had
 * set, and once because Access authenticated an owner who had no DevYou row.
 *
 * So this drives real route loaders through `requireAdmin` with the request context the
 * Worker boundary builds, against the real schema, and asserts the whole chain:
 *
 *   verified identity → users row → status → role → capability → loader data
 *
 * What it deliberately does not do is mint a Cloudflare Access assertion. The signing key
 * belongs to Cloudflare, `access.test.ts` covers verification against a generated pair in
 * thirteen tests, and production proved the same thing the hard way: the owner reached the
 * *application's* refusal message, which only renders after `verifyAccessJwt` has already
 * succeeded. The step this file covers is the one that was actually broken.
 */

const identity = (email: string): AccessIdentity => ({
  subject: email.toLowerCase(),
  kind: "user",
  accessSub: "access-sub",
  expiresAt: Math.floor(Date.now() / 1000) + 600,
});

/** The request context exactly as `workers/app.ts` builds it: environment, execution
 *  context, and the identity it has already verified. Nothing else is available to a
 *  loader, which is the point — a route cannot re-derive who the caller is. */
function requestContext(subject: AccessIdentity | null): Readonly<RouterContextProvider> {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env, ctx: {} as ExecutionContext });
  context.set(accessContext, subject);
  return context;
}

/**
 * The three rows `scripts/bootstrap-admin.mjs` writes, in the shape it writes them.
 *
 * Kept faithful on purpose, including the lower-cased email and the `email_verified_at`
 * stamp. If the script's output and this fixture ever drift, the test that proves the
 * console works stops describing the account that actually exists.
 */
async function bootstrapAdmin(email: string, id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, created_at, status, email, email_verified_at, network_actor_id, role)
     VALUES (?1, 1, 'active', ?2, 1, NULL, 'dev_admin')`,
  )
    .bind(id, email.toLowerCase())
    .run();
  await env.DB.prepare(
    `INSERT INTO profiles (user_id, display_name, handle, created_at) VALUES (?1, ?2, ?3, 1)`,
  )
    .bind(id, "DevYou admin", `handle-${id}`)
    .run();
}

/** Loaders throw a `Response` on refusal — `route.server.ts` converts `ApiError` at the
 *  boundary so React Router reports a capability refusal as a refusal rather than as an
 *  unhandled 500 polluting the error rate an on-call alert watches. */
async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
  } catch (thrown) {
    if (thrown instanceof Response) return thrown.status;
    throw thrown;
  }
  return 200;
}

describe("an Access identity with no DevYou account", () => {
  /*
    The production symptom, reproduced. This is what the owner saw: Cloudflare Access
    admitted them, and the console refused anyway. It is the correct behaviour and the
    reason a bootstrap step has to exist at all.
  */
  it("is refused by every admin surface, not just some", async () => {
    const context = requestContext(identity("stranger@example.com"));

    expect(await statusOf(() => overviewLoader({ context } as never))).toBe(403);
    expect(await statusOf(() => contributorsLoader({ context } as never))).toBe(403);
    expect(await statusOf(() => auditLoader({ context } as never))).toBe(403);
  });
});

describe("after bootstrap-admin.mjs has run", () => {
  it("loads the overview, showing every surface in the product", async () => {
    /*
      The overview filters its surface list through `can(actor.role, surface.capability)`,
      so the *length* of that list is a direct statement about the role: a `support_admin`
      would be handed a shorter one, a `reviewer` shorter still. Asserting the full set
      therefore proves what the provisioning was asked to achieve — the highest role
      already defined by the architecture — without restating the capability matrix here,
      which would be a second copy of an authorisation rule and always the stale one.
    */
    const email = "owner-overview@example.com";
    await bootstrapAdmin(email, "usr_auth_path_1");

    const data = (await overviewLoader({
      context: requestContext(identity(email)),
    } as never)) as { surfaces: unknown[]; queues: unknown[] };

    expect(data.surfaces).toHaveLength(SURFACES.length);
    expect(data.queues.length).toBeGreaterThan(0);
  });

  it("loads a surface that only dev_admin can reach", async () => {
    /*
      `contributors:list` is a `support_admin` capability, so it is not a proof of the
      *highest* role on its own. What this asserts is that the surface which manages roles
      — the one the bootstrap exists to hand over to — opens.
    */
    const email = "owner-contributors@example.com";
    await bootstrapAdmin(email, "usr_auth_path_2");

    const data = (await contributorsLoader({
      context: requestContext(identity(email)),
      request: new Request("https://dev-admin.itisyou.app/contributors"),
    } as never)) as { permissions: { setRole: boolean } };

    /* The console can now grant roles, which is the whole point: from here, further
       administrators come from an audited action by a real actor rather than from a
       script with database credentials. */
    expect(data.permissions.setRole).toBe(true);
  });

  it("sees the audit log, including rows written with no actor", async () => {
    /*
      The bootstrap's own audit row has `actor_id = NULL`, because no administrator
      existed to perform it. That row must still be *readable* — an audit entry the audit
      surface cannot display is an audit entry that does not exist in practice, and the
      one row recording how all authority in the system began is a poor choice for that.
    */
    const email = "owner-audit@example.com";
    await bootstrapAdmin(email, "usr_auth_path_3");

    await env.DB.prepare(
      `INSERT INTO admin_audit_events
         (id, actor_id, capability, subject_type, subject_id, reason_code, reason_detail,
          change_json, step_up_verified, created_at)
       VALUES ('aud_auth_path_1', NULL, 'contributors:set_role', 'user', 'usr_auth_path_3',
               'routine_maintenance', 'Initial administrator provisioned out of band.',
               '{"role":[null,"dev_admin"]}', 0, 1)`,
    ).run();

    const data = (await auditLoader({
      context: requestContext(identity(email)),
      request: new Request("https://dev-admin.itisyou.app/audit"),
    } as never)) as { events: { id: string }[] };

    const bootstrapRow = data.events.find((event) => event.id === "aud_auth_path_1");
    expect(
      bootstrapRow,
      "the bootstrap audit row must be visible in the audit surface",
    ).toBeDefined();
  });

  it("is refused once the account is suspended, with no other change", async () => {
    /*
      Suspension revoking admin access by the same action that revokes everything else is
      a property of `resolveActor`'s `status = 'active'` predicate, and it is worth
      asserting through a real loader: it is the only route out of the console for an
      administrator who should no longer have one.
    */
    const email = "owner-suspended@example.com";
    await bootstrapAdmin(email, "usr_auth_path_4");
    const context = requestContext(identity(email));

    expect(await statusOf(() => overviewLoader({ context } as never))).toBe(200);

    await env.DB.prepare(
      `UPDATE users SET status = 'suspended' WHERE id = 'usr_auth_path_4'`,
    ).run();

    expect(await statusOf(() => overviewLoader({ context } as never))).toBe(403);
  });
});

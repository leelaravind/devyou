import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ApiError } from "@devyou/core";
import { requireActor, requireCapability, resolveActor } from "../app/lib/perimeter.server";
import type { AccessIdentity } from "../app/lib/access.server";

/**
 * The second half of the perimeter: Access proves *who*, `users.role` decides *what*.
 *
 * The tests that matter here are the negative ones. Passing Cloudflare Access is a
 * prerequisite and not a permission, and on a team domain shared with live products the set
 * of people who can pass Access is considerably larger than the set who should be able to
 * suspend a DevYou account. Each case below is somebody who got through the front door.
 */

const identity = (email: string): AccessIdentity => ({
  subject: email,
  kind: "user",
  accessSub: "access-sub",
  expiresAt: Math.floor(Date.now() / 1000) + 600,
});

/**
 * A fresh account per call, with an id and an email nothing else in this file uses.
 *
 * The counter is monotonic and is never reset. Storage is shared across the tests in a
 * file here, so a fixture numbered from zero in a `beforeEach` collides with the previous
 * test's row on the primary key — and the alternative, tearing fixtures down between
 * tests, would mean deleting rows from tables whose whole point is that they resist
 * deletion.
 */
let seq = 0;

function nextAccount(): { id: string; email: string } {
  const n = (seq += 1);
  return { id: `usr_test_${n}`, email: `person-${n}@example.com` };
}

async function makeUser(options: { role: string; status?: string }): Promise<{
  id: string;
  email: string;
}> {
  const account = nextAccount();
  await env.DB.prepare(
    `INSERT INTO users (id, created_at, status, email, role) VALUES (?1, 1, ?2, ?3, ?4)`,
  )
    .bind(account.id, options.status ?? "active", account.email, options.role)
    .run();
  await env.DB.prepare(
    `INSERT INTO profiles (user_id, display_name, handle, created_at) VALUES (?1, ?2, ?3, 1)`,
  )
    .bind(account.id, `User ${account.id}`, `handle-${account.id}`)
    .run();
  return account;
}

describe("resolving a DevYou actor from an Access identity", () => {
  it("resolves an active admin account", async () => {
    const account = await makeUser({ role: "dev_admin" });
    const actor = await resolveActor(env.DB, identity(account.email));

    expect(actor?.userId).toBe(account.id);
    expect(actor?.role).toBe("dev_admin");
  });

  /*
    Email casing, which is where provisioning goes wrong silently.

    `claimsToIdentity` lower-cases the `email` claim before it becomes `identity.subject`,
    and the lookup below matches `users.email` exactly. So a row stored with a capital
    letter resolves for nobody, ever — and the symptom is "Cloudflare Access works but the
    console says I am not an administrator", which is indistinguishable from having never
    created the row at all. `scripts/bootstrap-admin.mjs` lower-cases for this reason; these
    two tests are what keep that requirement true rather than remembered.
  */
  it("resolves a lower-cased row from a mixed-case Access claim", async () => {
    const account = await makeUser({ role: "dev_admin" });
    const actor = await resolveActor(env.DB, identity(account.email.toUpperCase().toLowerCase()));
    expect(actor?.userId).toBe(account.id);
  });

  it("gives nothing when the stored email is not lower-cased", async () => {
    const id = `usr_test_mixed_case`;
    await env.DB.prepare(
      `INSERT INTO users (id, created_at, status, email, role) VALUES (?1, 1, 'active', ?2, 'dev_admin')`,
    )
      .bind(id, "Mixed.Case@Example.Com")
      .run();

    /* The identity always arrives lower-cased, so this account is unreachable. Asserted so
       that anybody tempted to "fix" it with a COLLATE NOCASE index sees the intent first:
       the lookup is exact, and provisioning is what must normalise. */
    expect(await resolveActor(env.DB, identity("mixed.case@example.com"))).toBeNull();
  });

  it("gives nothing to an Access identity with no DevYou account", async () => {
    /*
      The headline requirement. Somebody in the Zero Trust directory, admitted by the
      Access policy, who has never had anything to do with DevYou. They get nothing — not a
      read-only view, not an empty console.
    */
    expect(await resolveActor(env.DB, identity("stranger@example.com"))).toBeNull();
  });

  it("gives nothing to a suspended account", async () => {
    const account = await makeUser({ role: "dev_admin", status: "suspended" });
    expect(await resolveActor(env.DB, identity(account.email))).toBeNull();
  });

  it("gives nothing to an account whose role is not an admin role", async () => {
    /* A contributor holds no capability, so every surface would refuse them anyway — but
       one page at a time, which reads as "this console is broken". Failing once at the door
       is both kinder and easier to support. */
    const account = await makeUser({ role: "contributor" });
    expect(await resolveActor(env.DB, identity(account.email))).toBeNull();
  });

  it("refuses identically whether the account is missing, suspended or not an admin", async () => {
    /*
      Distinguishing them would turn this surface into an oracle for "which of my colleagues
      holds a DevYou admin role", answerable by anybody who already passed Access.
    */
    const suspended = await makeUser({ role: "dev_admin", status: "suspended" });
    const contributor = await makeUser({ role: "contributor" });

    const messages = await Promise.all(
      ["nobody@example.com", suspended.email, contributor.email].map(async (email) => {
        try {
          await requireActor(env.DB, identity(email));
        } catch (error) {
          return ApiError.is(error) ? `${error.code}:${error.publicMessage}` : "wrong error";
        }
        return "accepted";
      }),
    );

    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toContain("FORBIDDEN");
  });
});

describe("capability enforcement", () => {
  const actor = {
    userId: "usr_x",
    accessSubject: "x@example.com",
    displayName: "X",
    handle: null,
  };

  it("allows a reviewer to quarantine a dangerous playbook", () => {
    /* The positive control. A guard that refuses everything is not a guard, it is an
       outage — and a reviewer holding quarantine without an admin is a deliberate decision
       in the matrix, not an oversight. */
    expect(() =>
      requireCapability({ ...actor, role: "reviewer" }, "playbooks:quarantine"),
    ).not.toThrow();
  });

  it("refuses a reviewer the account actions", () => {
    expect(() =>
      requireCapability({ ...actor, role: "reviewer" }, "contributors:suspend"),
    ).toThrow();
  });

  it("refuses a support_admin the ability to suppress evidence", () => {
    /* Suppressing evidence changes a published confidence figure, which is the product's
       central claim. It is a dev_admin action, not a support remedy. */
    expect(() =>
      requireCapability({ ...actor, role: "support_admin" }, "evidence:suppress"),
    ).toThrow();
  });

  it("allows a dev_admin everything in the matrix", () => {
    expect(() =>
      requireCapability({ ...actor, role: "dev_admin" }, "evidence:suppress"),
    ).not.toThrow();
    expect(() =>
      requireCapability({ ...actor, role: "dev_admin" }, "contributors:set_role"),
    ).not.toThrow();
  });

  it("refuses with 403 rather than 404", () => {
    /* Inverting the public API's convention on purpose: every caller here has already
       passed Access and holds an admin role, so there is nothing left to enumerate, and an
       honest 403 makes a permissions problem diagnosable instead of looking like missing
       data. */
    try {
      requireCapability({ ...actor, role: "reviewer" }, "audit:export");
    } catch (error) {
      expect(ApiError.is(error) && error.status).toBe(403);
    }
  });
});

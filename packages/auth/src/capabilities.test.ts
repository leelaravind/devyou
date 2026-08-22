import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLES,
  REASON_CODES,
  REQUIRES_REASON,
  ROLES,
  STATEMENTS,
  can,
  capabilityMatrix,
  isAdminRole,
  isReasonCode,
  requiresReason,
  type Capability,
  type Role,
} from "./capabilities.js";

/**
 * The capability matrix, asserted in full.
 *
 * This file deliberately does not spot-check "a reviewer can quarantine". It
 * enumerates **every** role/capability pair and pins the whole grid, because the
 * failure mode a permission test exists to catch is not "the capability I thought
 * about is wrong" — it is "a capability was added and silently granted to a role
 * nobody considered". A test that checks only what its author remembered cannot
 * catch that; a snapshot of the entire matrix can.
 *
 * The consequence is that adding a capability makes this file fail. That is the
 * point: the failure is a prompt to state, explicitly and in a diff, who gets it.
 */

const ALL_CAPABILITIES: Capability[] = Object.entries(STATEMENTS).flatMap(([resource, actions]) =>
  actions.map((action) => `${resource}:${action}` as Capability),
);

describe("the shape of the matrix", () => {
  it("grants nothing to user or contributor", () => {
    /*
      The single most important assertion in this file.

      `contributor` is what a GitHub sign-in produces. If a privileged capability
      ever lands here, every account that signs in gets it — and because a
      contributor account is free to create, that is the whole authorisation model
      gone. Asserting emptiness rather than "does not include X" means a future
      capability cannot slip in unnoticed.
    */
    for (const capability of ALL_CAPABILITIES) {
      expect(can("user", capability), `user should not hold ${capability}`).toBe(false);
      expect(can("contributor", capability), `contributor should not hold ${capability}`).toBe(
        false,
      );
    }
  });

  it("gives dev_admin every capability and no more", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(can("dev_admin", capability), `dev_admin should hold ${capability}`).toBe(true);
    }
  });

  it("makes support_admin a strict superset of reviewer", () => {
    /*
      Escalation must be monotonic. A support_admin who *lost* a capability by being
      promoted from reviewer is the kind of surprise that gets worked around with a
      second account, which then defeats the audit trail.
    */
    for (const capability of ALL_CAPABILITIES) {
      if (can("reviewer", capability)) {
        expect(can("support_admin", capability), `support_admin lost ${capability}`).toBe(true);
      }
    }
  });

  it("does not let support_admin suppress evidence", () => {
    /*
      Named explicitly because it is the one place the superset rule above stops.
      Suppressing evidence changes a published confidence figure — the product's
      central claim — so it is a dev_admin action, not a support remedy.
    */
    expect(can("support_admin", "evidence:suppress")).toBe(false);
    expect(can("dev_admin", "evidence:suppress")).toBe(true);
  });

  it("does not let a reviewer change who may act", () => {
    for (const capability of [
      "contributors:suspend",
      "contributors:set_role",
      "contributors:revoke_sessions",
      "identity_claims:grant",
    ] as const) {
      expect(can("reviewer", capability), `reviewer should not hold ${capability}`).toBe(false);
    }
  });

  it("lets a reviewer quarantine without waiting for an admin", () => {
    // A dangerous command staying visible overnight costs more than an
    // over-cautious quarantine reversed in the morning.
    expect(can("reviewer", "playbooks:quarantine")).toBe(true);
  });

  it("has no capability for deleting evidence", () => {
    /*
      Not "nobody is granted it" — the string does not exist. Evidence is
      append-only at the database (see the triggers in
      0001_invariant_enforcement.sql), so a capability to delete it would be a
      capability to attempt something the storage layer refuses. Its absence here is
      what keeps the two layers telling the same story.
    */
    expect(ALL_CAPABILITIES).not.toContain("evidence:delete");
    expect(ALL_CAPABILITIES).not.toContain("reproductions:delete");
    expect(STATEMENTS.evidence).not.toContain("delete");
  });

  it("has no capability that grants standing rather than an action", () => {
    // Every capability names something done to a resource. A "verified" or
    // "trusted" capability would be a rank, which this product does not have.
    for (const capability of ALL_CAPABILITIES) {
      expect(capability).not.toMatch(/(verified|trusted|reputation|rank|score)/i);
    }
  });

  it("treats maintainer_verified as a claim, not a role", () => {
    expect(ROLES as readonly string[]).not.toContain("maintainer_verified");
    expect(ROLES as readonly string[]).not.toContain("maintainer");
  });
});

describe("reason codes", () => {
  it("requires a reason for every capability visible outside the admin surface", () => {
    /*
      The list of what needs a reason is itself pinned, rather than derived from a
      naming convention. A convention ("anything containing 'suspend'") would
      silently stop covering a capability the moment somebody named one differently.
    */
    for (const capability of REQUIRES_REASON) {
      expect(ALL_CAPABILITIES, `${capability} is not a real capability`).toContain(capability);
      expect(requiresReason(capability)).toBe(true);
    }
  });

  it("requires a reason for every destructive or externally visible action", () => {
    const mustRequireReason: Capability[] = [
      "playbooks:quarantine",
      "playbooks:deprecate",
      "playbooks:merge",
      "evidence:suppress",
      "contributors:suspend",
      "contributors:set_role",
      "proposals:decline",
      "audit:export",
    ];
    for (const capability of mustRequireReason) {
      expect(requiresReason(capability), `${capability} should require a reason`).toBe(true);
    }
  });

  it("does not require a reason to look at something", () => {
    // Reading is not destructive, and a reason prompt on every view is how reason
    // codes become noise that people click through without reading.
    for (const capability of ALL_CAPABILITIES) {
      if (capability.endsWith(":view") || capability.endsWith(":list")) {
        expect(requiresReason(capability), `${capability} should not require a reason`).toBe(false);
      }
    }
  });

  it("recognises exactly the fixed reason codes", () => {
    for (const code of REASON_CODES) expect(isReasonCode(code)).toBe(true);
    expect(isReasonCode("fixing")).toBe(false);
    expect(isReasonCode("")).toBe(false);
    expect(isReasonCode("dangerous")).toBe(false);
  });
});

describe("role predicates", () => {
  it("treats only the two admin roles as admin", () => {
    expect(ADMIN_ROLES).toEqual(["support_admin", "dev_admin"]);
    expect(isAdminRole("support_admin")).toBe(true);
    expect(isAdminRole("dev_admin")).toBe(true);
    expect(isAdminRole("reviewer")).toBe(false);
    expect(isAdminRole("contributor")).toBe(false);
  });

  it("denies every capability to a role it has never heard of", () => {
    /*
      Fails closed. A role string arrives from a database column, and a value that
      predates a rename — or that somebody typed by hand — must grant nothing rather
      than fall through to a default.
    */
    for (const capability of ALL_CAPABILITIES) {
      expect(can("", capability)).toBe(false);
      expect(can("admin", capability)).toBe(false);
      expect(can("superuser", capability)).toBe(false);
      expect(can("Dev_Admin", capability)).toBe(false);
    }
  });

  it("rejects a capability string that is not in the matrix", () => {
    expect(can("dev_admin", "playbooks:delete_everything" as Capability)).toBe(false);
    expect(can("dev_admin", "" as Capability)).toBe(false);
  });
});

describe("the published matrix", () => {
  it("lists every capability exactly once", () => {
    const rows = capabilityMatrix();
    expect(rows).toHaveLength(ALL_CAPABILITIES.length);

    const keys = rows.map((row) => `${row.resource}:${row.action}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual([...ALL_CAPABILITIES].sort());
  });

  it("agrees with can() on every pair", () => {
    for (const row of capabilityMatrix()) {
      const capability = `${row.resource}:${row.action}` as Capability;
      for (const role of ROLES) {
        expect(
          can(role, capability),
          `matrix and can() disagree on ${role} / ${capability}`,
        ).toBe(row.grantedTo.includes(role));
      }
    }
  });

  it("grants every capability to at least one role", () => {
    /*
      A capability nobody holds is dead code that reads as a working control. If one
      is genuinely meant to be unreachable for now, it should not be in STATEMENTS
      yet.
    */
    for (const row of capabilityMatrix()) {
      expect(
        row.grantedTo.length,
        `${row.resource}:${row.action} is granted to nobody`,
      ).toBeGreaterThan(0);
    }
  });
});

/**
 * The whole grid, pinned.
 *
 * Written out as data rather than generated, so that a diff to this file *is* the
 * record of a permission change — reviewable by somebody who does not want to run
 * the code in their head.
 */
describe("the full grant list", () => {
  const EXPECTED: Record<Role, readonly string[]> = {
    user: [],
    contributor: [],
    reviewer: [
      "evidence:view_suppressed",
      "health:view",
      "moderation:resolve",
      "moderation:view",
      "playbooks:deprecate",
      "playbooks:quarantine",
      "playbooks:relate",
      "playbooks:view_unpublished",
      "proposals:accept",
      "proposals:decline",
      "proposals:view",
      "revisions:flag_reverification",
      "search_quality:view",
      "taxonomy:view",
    ],
    support_admin: [
      "ai_operations:view",
      "audit:view",
      "contributors:list",
      "contributors:revoke_sessions",
      "contributors:suspend",
      "contributors:unsuspend",
      "contributors:view",
      "evidence:view_suppressed",
      "flags:view",
      "health:view",
      "identity_claims:view",
      "moderation:escalate",
      "moderation:resolve",
      "moderation:view",
      "playbooks:deprecate",
      "playbooks:quarantine",
      "playbooks:relate",
      "playbooks:view_unpublished",
      "proposals:accept",
      "proposals:decline",
      "proposals:view",
      "reproductions:flag_review",
      "reproductions:view_actor",
      "revisions:flag_reverification",
      "search_quality:view",
      "taxonomy:view",
    ],
    dev_admin: [...ALL_CAPABILITIES].sort(),
  };

  for (const role of ROLES) {
    it(`grants ${role} exactly the expected capabilities`, () => {
      const held = ALL_CAPABILITIES.filter((capability) => can(role, capability)).sort();
      expect(held).toEqual([...EXPECTED[role]].sort());
    });
  }
});

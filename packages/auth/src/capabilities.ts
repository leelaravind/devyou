/**
 * Capabilities.
 *
 * Modelled on the network's established pattern — a statement map that is the
 * single source of truth for what a role may do, read by route handlers, by the
 * admin action layer and by the test matrix alike, so a capability cannot be
 * granted in one place and forgotten in another.
 *
 * One thing is deliberately different from a conventional permission system, and it
 * is the important one: **a role here grants a capability and confers no standing.**
 * The adoption research is unambiguous that a reputation ladder is what drove
 * contributors off the incumbent, so there is no rank, no score, no badge derived
 * from a role, and nothing a contributor can do to climb one. `contributor` is not
 * "above" `user`; it is a different set of buttons.
 *
 * `maintainer_verified` is deliberately **not** a role. It is a claim recorded in
 * `official_identity_claims`, and it grants exactly one thing: the ability to file
 * `maintainer_attestation` evidence, which is one signal among several and never
 * outranks reproduction. Making it a role would let authority accumulate power,
 * which is what the research warns turns "official" into pay-to-play.
 */

export const ROLES = ["user", "contributor", "reviewer", "support_admin", "dev_admin"] as const;
export type Role = (typeof ROLES)[number];

export const ADMIN_ROLES: readonly Role[] = ["support_admin", "dev_admin"] as const;

export function isAdminRole(role: string): role is "support_admin" | "dev_admin" {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

/**
 * Every privileged capability in DevYou.
 *
 * Note what is split rather than combined:
 *
 * - `evidence:suppress` and `evidence:delete` — the second does not exist, and its
 *   absence is the point. Evidence is append-only at the database; there is no
 *   capability for deleting it because there is no operation to grant.
 * - `playbooks:quarantine` and `playbooks:deprecate` are distinct. Deprecation is a
 *   knowledge judgement ("this no longer works"); quarantine is a safety action
 *   ("this is dangerous and must stop being visible now"). Different urgency,
 *   different blast radius, different people.
 * - `revisions:publish` is separate from `proposals:accept`. Accepting a proposal
 *   says a change is good; publishing puts it in front of readers.
 */
export const STATEMENTS = {
  playbooks: ["view_unpublished", "quarantine", "unquarantine", "deprecate", "merge", "relate"],
  revisions: ["publish", "supersede", "flag_reverification"],
  proposals: ["view", "accept", "decline"],
  evidence: ["view_suppressed", "suppress", "unsuppress"],
  reproductions: ["view_actor", "flag_review"],
  moderation: ["view", "resolve", "escalate"],
  taxonomy: ["view", "create", "update", "merge"],
  contributors: ["list", "view", "suspend", "unsuspend", "set_role", "revoke_sessions"],
  identity_claims: ["view", "grant", "refuse", "revoke"],
  search_quality: ["view"],
  ai_operations: ["view", "retry", "set_budget"],
  flags: ["view", "edit"],
  audit: ["view", "export"],
  health: ["view"],
} as const;

export type Resource = keyof typeof STATEMENTS;
export type Capability = `${Resource}:${string}`;

/**
 * `reviewer` — everything needed to keep the corpus honest, and nothing that
 * changes who may act.
 *
 * A reviewer can quarantine a dangerous playbook without waiting for an admin,
 * because the cost of a destructive command staying visible overnight is higher than
 * the cost of an over-cautious quarantine that gets reversed in the morning. They
 * cannot suspend an account, set a role, or grant a maintainer claim.
 */
const REVIEWER: readonly Capability[] = [
  "playbooks:view_unpublished",
  "playbooks:quarantine",
  "playbooks:deprecate",
  "playbooks:relate",
  "revisions:flag_reverification",
  "proposals:view",
  "proposals:accept",
  "proposals:decline",
  "evidence:view_suppressed",
  "moderation:view",
  "moderation:resolve",
  "taxonomy:view",
  "search_quality:view",
  "health:view",
];

/**
 * `support_admin` — a reviewer, plus the account actions a support request needs.
 *
 * Deliberately excludes `evidence:suppress`. Suppressing evidence changes a
 * published confidence figure, which is the product's central claim; that is a
 * `dev_admin` action with an audit row, not a support remedy.
 */
const SUPPORT_ADMIN: readonly Capability[] = [
  ...REVIEWER,
  "contributors:list",
  "contributors:view",
  "contributors:suspend",
  "contributors:unsuspend",
  "contributors:revoke_sessions",
  "reproductions:view_actor",
  "reproductions:flag_review",
  "identity_claims:view",
  "moderation:escalate",
  "audit:view",
  "ai_operations:view",
  "flags:view",
];

const DEV_ADMIN: readonly Capability[] = Object.entries(STATEMENTS).flatMap(
  ([resource, actions]) => actions.map((action) => `${resource}:${action}` as Capability),
);

const GRANTS: Record<Role, readonly Capability[]> = {
  user: [],
  contributor: [],
  reviewer: REVIEWER,
  support_admin: SUPPORT_ADMIN,
  dev_admin: DEV_ADMIN,
};

export function can(role: string, capability: Capability): boolean {
  const grants = GRANTS[role as Role];
  return grants !== undefined && grants.includes(capability);
}

/**
 * Capabilities that require a reason code, always.
 *
 * Every one of them is visible to somebody outside the admin surface — a
 * contributor whose account changed, a reader whose playbook vanished, a
 * confidence figure that moved. Plan §13: all destructive actions require reason
 * codes and audit events, and the action layer refuses to perform one without both.
 */
export const REQUIRES_REASON: readonly Capability[] = [
  "playbooks:quarantine",
  "playbooks:unquarantine",
  "playbooks:deprecate",
  "playbooks:merge",
  "revisions:supersede",
  "revisions:flag_reverification",
  "proposals:decline",
  "evidence:suppress",
  "evidence:unsuppress",
  "contributors:suspend",
  "contributors:unsuspend",
  "contributors:set_role",
  "contributors:revoke_sessions",
  "identity_claims:grant",
  "identity_claims:refuse",
  "identity_claims:revoke",
  "taxonomy:merge",
  "flags:edit",
  "ai_operations:set_budget",
  "audit:export",
];

export function requiresReason(capability: Capability): boolean {
  return REQUIRES_REASON.includes(capability);
}

/**
 * The fixed reason codes.
 *
 * A free-text reason nobody constrains becomes "fixing" on every row within a
 * month, which makes the audit log unsearchable and the pattern of moderation
 * invisible. Free text is still captured alongside, as detail.
 */
export const REASON_CODES = [
  "dangerous_content",
  "credential_exposure",
  "malicious_package",
  "factually_wrong",
  "out_of_date",
  "duplicate",
  "spam",
  "abuse",
  "gaming_suspected",
  "author_request",
  "legal_request",
  "correcting_error",
  "routine_maintenance",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export function isReasonCode(value: string): value is ReasonCode {
  return (REASON_CODES as readonly string[]).includes(value);
}

/**
 * A plain, inspectable view of the whole matrix.
 *
 * Used by the capability test, which asserts every role/capability pair rather than
 * spot-checking a few. A capability added to `STATEMENTS` and granted to nobody
 * shows up there as an explicit deny rather than as an oversight.
 */
export function capabilityMatrix(): Array<{
  resource: Resource;
  action: string;
  grantedTo: Role[];
  needsReason: boolean;
}> {
  const rows: Array<{ resource: Resource; action: string; grantedTo: Role[]; needsReason: boolean }> =
    [];

  for (const [resource, actions] of Object.entries(STATEMENTS)) {
    for (const action of actions) {
      const capability = `${resource}:${action}` as Capability;
      rows.push({
        resource: resource as Resource,
        action,
        grantedTo: ROLES.filter((role) => can(role, capability)),
        needsReason: requiresReason(capability),
      });
    }
  }
  return rows;
}

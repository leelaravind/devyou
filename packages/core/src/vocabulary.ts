/**
 * The shared vocabulary.
 *
 * Every enumerated value the product reasons about lives here, once. The database,
 * the domain rules, the API schemas and the UI all import from this file, so a
 * value cannot exist in one layer and be unknown to another.
 *
 * This file contains no logic on purpose. Derivation rules live in `@devyou/domain`;
 * putting them here would make `@devyou/ui` depend on the rules engine just to
 * render a label.
 */

/* ---------------------------------------------------------------------------
   Evidence
   --------------------------------------------------------------------------- */

/**
 * The kinds of evidence a playbook revision can accumulate.
 *
 * These are **not** ranks. They are different claims about different things, and
 * collapsing them into an ordering is exactly the failure ADR-0006 exists to
 * prevent. A single `ci_execution` does not outrank three `independent_confirmation`
 * records from three real environments; it answers a different question.
 *
 * Two distinctions here are load-bearing and easy to lose:
 *
 * - `contributor_documentation` is the author's own claim. It is evidence *that a
 *   procedure was written down*, never evidence that it works. On its own it can
 *   only produce the `unverified` band.
 * - `reproduction` and `independent_confirmation` follow the ACM artifact-badge
 *   distinction (R-7): reproduced means an independent party ran the author's
 *   procedure; confirmed means an independent party reached the same outcome. They
 *   are recorded separately because merging them would overstate what is known.
 */
export const EVIDENCE_TYPES = [
  "contributor_documentation",
  "independent_confirmation",
  "reproduction",
  "ci_execution",
  "matrix_execution",
  "maintainer_attestation",
  "official_reference",
  "failure_observation",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/**
 * The outcome recorded on an evidence record.
 *
 * `failed` is a first-class value, not an absence. Plan §0.3 and R-6: failed
 * reproductions are retained and surfaced by environment. Nothing in this codebase
 * may filter them out to make a number look better.
 */
export const EVIDENCE_RESULTS = ["passed", "partial", "failed", "inconclusive"] as const;
export type EvidenceResult = (typeof EVIDENCE_RESULTS)[number];

/**
 * What a developer reports after trying a fix.
 *
 * Deliberately three values and no more. R-31 puts the whole flow at 10-30 seconds;
 * a fourth option is another decision to make and measurably costs completions.
 */
export const REPRODUCTION_OUTCOMES = ["worked", "partial", "failed"] as const;
export type ReproductionOutcome = (typeof REPRODUCTION_OUTCOMES)[number];

/* ---------------------------------------------------------------------------
   Confidence
   --------------------------------------------------------------------------- */

/**
 * The user-facing confidence bands.
 *
 * Coarse on purpose. R-4: a discrete band, never a bare percentage, and raw counts
 * are always shown alongside. Percentages are suppressed entirely below n < 5,
 * because "100% success" over two reports is a lie told with arithmetic.
 *
 * Every band must be explainable — the UI that renders one is required to link to
 * the evidence that produced it (plan §6, "Why this confidence?").
 */
export const CONFIDENCE_BANDS = [
  "unverified",
  "limited_evidence",
  "moderate_evidence",
  "strong_evidence",
  "needs_reverification",
  "deprecated",
] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

/** The minimum sample size below which a percentage may not be displayed. R-4. */
export const MIN_SAMPLE_FOR_PERCENTAGE = 5;

export const CONFIDENCE_BAND_LABELS: Record<ConfidenceBand, string> = {
  unverified: "Unverified",
  limited_evidence: "Limited evidence",
  moderate_evidence: "Moderate evidence",
  strong_evidence: "Strong evidence",
  needs_reverification: "Needs reverification",
  deprecated: "Deprecated",
};

/* ---------------------------------------------------------------------------
   Diagnostic graph
   --------------------------------------------------------------------------- */

export const NODE_TYPES = [
  "start",
  "test",
  "observation",
  "root_cause",
  "fix",
  "verification",
  "terminal",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/**
 * The result labels a developer may record at a test node.
 *
 * `unknown` and `skip` are required, not conveniences. R-27: a developer who cannot
 * tell whether a test passed must have somewhere to go other than a dead end, or
 * they abandon the session and the knowledge of *why* is lost with them.
 */
export const BRANCH_CONDITIONS = [
  "passed",
  "failed",
  "different_output",
  "unknown",
  "skip",
] as const;
export type BranchCondition = (typeof BRANCH_CONDITIONS)[number];

export const BRANCH_CONDITION_LABELS: Record<BranchCondition, string> = {
  passed: "Passed",
  failed: "Failed",
  different_output: "Different output",
  unknown: "Unknown",
  skip: "Skip",
};

/* ---------------------------------------------------------------------------
   Command safety
   --------------------------------------------------------------------------- */

/**
 * How dangerous a command in a playbook is.
 *
 * Plan §14 requires the UI to reflect the class **before** the copy action, not
 * after. A developer who has already pasted `rm -rf` into a production shell is not
 * helped by a warning underneath the button.
 *
 * `credential_sensitive` is separate from `destructive` because the harm is
 * different in kind: a destructive command loses data you can restore from backup,
 * a credential-sensitive one leaks a secret you cannot un-leak.
 */
export const SAFETY_LEVELS = [
  "informational",
  "state_changing",
  "destructive",
  "credential_sensitive",
] as const;
export type SafetyLevel = (typeof SAFETY_LEVELS)[number];

export const SAFETY_LEVEL_LABELS: Record<SafetyLevel, string> = {
  informational: "Read-only",
  state_changing: "Changes state",
  destructive: "Destructive",
  credential_sensitive: "Handles credentials",
};

/** Whether copying this command requires an explicit acknowledgement first. */
export function requiresAcknowledgement(level: SafetyLevel): boolean {
  return level === "destructive" || level === "credential_sensitive";
}

/* ---------------------------------------------------------------------------
   Lifecycle
   --------------------------------------------------------------------------- */

export const PLAYBOOK_STATUSES = [
  "draft",
  "under_review",
  "published",
  "needs_reverification",
  "superseded",
  "deprecated",
  "quarantined",
] as const;
export type PlaybookStatus = (typeof PLAYBOOK_STATUSES)[number];

export const PROBLEM_STATUSES = ["active", "merged", "resolved_upstream", "archived"] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

/** Statuses whose content is publicly readable. Superseded and deprecated revisions
 *  stay readable at their stable URL — plan §9 requires historical URLs to survive,
 *  and a 404 on a deprecated playbook destroys the evidence trail that justified
 *  deprecating it. */
export const PUBLICLY_READABLE_STATUSES: readonly PlaybookStatus[] = [
  "published",
  "needs_reverification",
  "superseded",
  "deprecated",
] as const;

export function isPubliclyReadable(status: PlaybookStatus): boolean {
  return PUBLICLY_READABLE_STATUSES.includes(status);
}

/* ---------------------------------------------------------------------------
   Technology taxonomy
   --------------------------------------------------------------------------- */

export const TECHNOLOGY_TYPES = [
  "language",
  "runtime",
  "framework",
  "database",
  "cloud",
  "os",
  "tool",
  "library",
  "service",
] as const;
export type TechnologyType = (typeof TECHNOLOGY_TYPES)[number];

/* ---------------------------------------------------------------------------
   Provenance
   --------------------------------------------------------------------------- */

/**
 * Where a field's value came from.
 *
 * Plan §10 step C: AI cannot silently invent required facts. Anything marked
 * `ai_inferred_requires_confirmation` must be explicitly confirmed by a human
 * before the draft can be published — the publish gate reads this field, so
 * removing it would not merely lose an audit trail, it would open the gate.
 */
export const PROVENANCE = [
  "user_supplied",
  "ai_extracted",
  "ai_inferred_requires_confirmation",
] as const;
export type Provenance = (typeof PROVENANCE)[number];

export function requiresHumanConfirmation(provenance: Provenance): boolean {
  return provenance === "ai_inferred_requires_confirmation";
}

/* ---------------------------------------------------------------------------
   Source references
   --------------------------------------------------------------------------- */

export const SOURCE_TYPES = [
  "official_docs",
  "issue",
  "pull_request",
  "changelog",
  "advisory",
  "blog",
  "specification",
  "other",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

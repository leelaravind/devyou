import type { PlaybookStatus } from "@devyou/core";
import { ApiError } from "@devyou/core";

/**
 * Revision lifecycle.
 *
 * The rules that make "editing published knowledge creates a new revision" true in
 * practice rather than in principle. The database triggers stop a published revision
 * being mutated; this decides what the alternatives are and when each applies.
 */

export interface RevisionState {
  id: string;
  playbookId: string;
  revisionNumber: number;
  status: PlaybookStatus;
  publishedAt: number | null;
  supersededAt: number | null;
  deprecatedAt: number | null;
  needsReverificationAt: number | null;
}

export function isPublished(revision: RevisionState): boolean {
  return revision.publishedAt !== null;
}

/**
 * Whether this revision is the one a reader should be shown by default.
 *
 * Superseded and deprecated revisions stay readable at their own URLs — plan §9
 * requires historical URLs to keep working, and a 404 on a deprecated playbook
 * destroys the evidence trail that justified deprecating it. They are simply not
 * what `/p/:slug` resolves to.
 */
export function isCurrent(revision: RevisionState): boolean {
  return (
    revision.publishedAt !== null && revision.supersededAt === null && revision.deprecatedAt === null
  );
}

export interface PublishInput {
  revision: RevisionState;
  /** From `validateGraph`. */
  graphValid: boolean;
  /** Draft fields marked `ai_inferred_requires_confirmation` and not yet confirmed. */
  unconfirmedInferredFields: readonly string[];
  /** Nodes carrying a command with no safety classification or no stated effect. */
  unclassifiedCommandNodes: readonly string[];
  /** Blocking findings from the security sweep. */
  blockingSafetyFindings: readonly string[];
  /** At least one environment applicability constraint must be declared. */
  hasEnvironmentConstraints: boolean;
}

export interface PublishDecision {
  allowed: boolean;
  blockers: Array<{ code: string; message: string }>;
}

/**
 * The publication gate.
 *
 * Every blocker here maps to something a reader would otherwise be shown without
 * warning. Two are worth calling out.
 *
 * `unconfirmed_ai_fields` is the mechanism behind "AI cannot silently invent
 * required facts" (plan §10, R-10). Without this check that rule is a sentence in a
 * document; with it, a draft whose author never looked at an inferred field cannot
 * become public knowledge.
 *
 * `no_environment_constraints` blocks a playbook that does not say where it
 * applies. That is not pedantry — an unscoped playbook cannot be matched against a
 * reader's environment, cannot be segmented by version, and cannot ever be marked
 * stale, so it silently opts out of three of the product's four guarantees.
 */
export function canPublish(input: PublishInput): PublishDecision {
  const blockers: Array<{ code: string; message: string }> = [];

  if (input.revision.publishedAt !== null) {
    blockers.push({
      code: "already_published",
      message: "This revision is already published. Create a new revision to change it.",
    });
  }

  if (!input.graphValid) {
    blockers.push({
      code: "graph_invalid",
      message: "The diagnostic path has errors that would strand a reader.",
    });
  }

  if (input.unconfirmedInferredFields.length > 0) {
    blockers.push({
      code: "unconfirmed_ai_fields",
      message:
        `${input.unconfirmedInferredFields.length} field(s) were inferred by AI and not confirmed. ` +
        "Confirm or correct each one — AI cannot assert a fact on your behalf.",
    });
  }

  if (input.unclassifiedCommandNodes.length > 0) {
    blockers.push({
      code: "unclassified_commands",
      message:
        `${input.unclassifiedCommandNodes.length} command(s) have no safety classification. ` +
        "A reader is shown a copy button either way.",
    });
  }

  if (input.blockingSafetyFindings.length > 0) {
    blockers.push({
      code: "safety_findings",
      message: input.blockingSafetyFindings.join(" "),
    });
  }

  if (!input.hasEnvironmentConstraints) {
    blockers.push({
      code: "no_environment_constraints",
      message:
        "Say which technologies and versions this applies to. Without that it cannot be matched " +
        "to a reader's environment or marked stale when things move on.",
    });
  }

  return { allowed: blockers.length === 0, blockers };
}

/**
 * What a newly published revision's confidence starts at.
 *
 * Always `unverified`, with no exception. Plan §10 step F allows stronger evidence
 * to carry a new revision higher "if it already exists and passes review", and this
 * function deliberately does not implement that: evidence belongs to the revision
 * that was tested, and a reviewer deciding that old evidence still applies is a
 * human judgement that must be recorded as new evidence against the new revision,
 * not inherited by a function.
 *
 * The distinction is the whole of R-1. Making it automatic here would defeat the
 * triggers, the schema and the tests in one line.
 */
export const INITIAL_BAND = "unverified" as const;

export interface SupersedeInput {
  previous: RevisionState;
  next: RevisionState;
  now: number;
}

export function supersede(input: SupersedeInput): {
  previous: RevisionState;
  next: RevisionState;
} {
  if (input.previous.publishedAt === null) {
    throw new ApiError("CONFLICT", {
      publicMessage: "An unpublished revision cannot be superseded.",
      internalDetail: `revision ${input.previous.id} was never published`,
    });
  }
  if (input.next.publishedAt === null) {
    throw new ApiError("CONFLICT", {
      publicMessage: "Publish the new revision before superseding the old one.",
      internalDetail: `revision ${input.next.id} is not published`,
    });
  }
  if (input.previous.playbookId !== input.next.playbookId) {
    throw new ApiError("CONFLICT", {
      publicMessage: "Revisions of different playbooks cannot supersede one another.",
      internalDetail: `${input.previous.playbookId} vs ${input.next.playbookId}`,
    });
  }

  return {
    previous: { ...input.previous, supersededAt: input.now, status: "superseded" },
    next: input.next,
  };
}

/* ---------------------------------------------------------------------------
   Staleness
   --------------------------------------------------------------------------- */

export type StalenessTrigger =
  | "time_since_last_success"
  | "new_major_or_minor_release"
  | "failure_cluster"
  | "maintainer_report"
  | "security_advisory"
  | "dependency_applicability_changed";

export interface StalenessInput {
  lastSuccessAt: number | null;
  publishedAt: number;
  now: number;
  /** Releases of a constrained technology since publication that fall outside the
   *  declared range. */
  newReleasesOutsideRange: number;
  recentFailures: number;
  recentReports: number;
  maintainerReported: boolean;
  linkedAdvisory: boolean;
}

/**
 * How long a revision may go without a successful verification.
 *
 * Twelve months. Long enough that a stable playbook about a stable technology is
 * not nagged every quarter; short enough that "last verified" never reads as a date
 * nobody would trust.
 *
 * R-8 is the reasoning: reproducibility decays through dependency drift, so a
 * historical success is evidence about a dated environment rather than a standing
 * guarantee. The number is a judgement and is meant to be revisited once there is
 * real data on how fast these particular playbooks rot.
 */
export const STALE_AFTER_MS = 365 * 24 * 60 * 60 * 1000;

/** Failures in the recent window, as a share of recent reports, that constitute a
 *  cluster worth a maintainer's attention. */
export const FAILURE_CLUSTER_RATIO = 0.4;
export const FAILURE_CLUSTER_MIN_REPORTS = 3;

/**
 * Which staleness triggers currently fire.
 *
 * Every trigger here is deterministic — computed from stored version metadata,
 * report counts and timestamps. R-11: AI may flag staleness as a signal, and
 * nothing in this function consults it. An AI suggestion becomes a
 * `moderation_case`, which a human resolves.
 */
export function stalenessTriggers(input: StalenessInput): StalenessTrigger[] {
  const triggers: StalenessTrigger[] = [];

  const lastKnownGood = input.lastSuccessAt ?? input.publishedAt;
  if (input.now - lastKnownGood > STALE_AFTER_MS) triggers.push("time_since_last_success");

  if (input.newReleasesOutsideRange > 0) triggers.push("new_major_or_minor_release");

  if (
    input.recentReports >= FAILURE_CLUSTER_MIN_REPORTS &&
    input.recentFailures / input.recentReports >= FAILURE_CLUSTER_RATIO
  ) {
    triggers.push("failure_cluster");
  }

  if (input.maintainerReported) triggers.push("maintainer_report");
  if (input.linkedAdvisory) triggers.push("security_advisory");

  return triggers;
}

export function describeStaleness(triggers: readonly StalenessTrigger[]): string {
  const text: Record<StalenessTrigger, string> = {
    time_since_last_success: "no successful reproduction in over a year",
    new_major_or_minor_release: "a new release falls outside the declared version range",
    failure_cluster: "several recent reports of it failing",
    maintainer_report: "a maintainer reported a problem",
    security_advisory: "a linked security advisory",
    dependency_applicability_changed: "a dependency's applicability changed",
  };
  return triggers.map((trigger) => text[trigger]).join("; ");
}

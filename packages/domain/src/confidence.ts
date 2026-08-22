import type { ConfidenceBand, EvidenceResult, EvidenceType } from "@devyou/core";
import { MIN_SAMPLE_FOR_PERCENTAGE } from "@devyou/core";

/**
 * Deriving a confidence band from evidence.
 *
 * This is the function the product's central claim rests on, so it is written to be
 * read rather than to be clever. Every threshold is named, and every one of them is
 * a judgement that can be argued with — which is exactly why none of them is buried
 * in a scoring formula.
 *
 * What this deliberately is not:
 *
 * - **Not a score.** There is no weighted sum. A weighted sum lets three weak
 *   signals outvote one strong contradiction, and R-6 requires contradictions to be
 *   preserved and segmented rather than averaged away.
 * - **Not a ranking of evidence types.** `EVIDENCE_TYPES` is not ordered. A CI run
 *   and an independent reproduction answer different questions; the bands below use
 *   each for what it actually shows.
 * - **Not monotonic in volume.** More reproductions do not keep raising the band.
 *   Beyond `strong_evidence` there is nowhere to go, because there is no honest
 *   claim stronger than "several independent people reproduced this on several
 *   environments and nothing has failed recently".
 */

export interface EvidenceTally {
  /** Independent successful reproductions, excluding the author's own. */
  reproducedPassed: number;
  reproducedPartial: number;
  reproducedFailed: number;
  /** Distinct environment fingerprints across all reproductions. */
  uniqueEnvironments: number;
  independentConfirmations: number;
  ciExecutions: number;
  maintainerAttestations: number;
  officialReferences: number;
  /** Author's own documentation. Present on every published revision by definition. */
  authorDocumented: boolean;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

export interface LifecycleState {
  deprecatedAt: number | null;
  supersededAt: number | null;
  needsReverificationAt: number | null;
}

export const EMPTY_TALLY: EvidenceTally = {
  reproducedPassed: 0,
  reproducedPartial: 0,
  reproducedFailed: 0,
  uniqueEnvironments: 0,
  independentConfirmations: 0,
  ciExecutions: 0,
  maintainerAttestations: 0,
  officialReferences: 0,
  authorDocumented: false,
  lastSuccessAt: null,
  lastFailureAt: null,
};

/**
 * The thresholds, in one place so they can be argued with.
 *
 * `MODERATE_UNIQUE_ENVIRONMENTS` is 2 rather than 3 for a reason worth stating: the
 * claim the band makes is "this has worked somewhere other than where it was
 * written", and two environments is the smallest number that can support it. Three
 * would be a better claim and, on a corpus of thirty seed playbooks, would mean
 * almost nothing ever left `limited_evidence` — a scale that is honest and useless
 * teaches readers to ignore the band.
 */
export const THRESHOLDS = {
  LIMITED_PASSES: 1,
  MODERATE_PASSES: 3,
  MODERATE_UNIQUE_ENVIRONMENTS: 2,
  STRONG_PASSES: 6,
  STRONG_UNIQUE_ENVIRONMENTS: 3,
  /**
   * The failure ratio at which recent failures pull a revision back regardless of
   * how many successes it has.
   *
   * A third. Not because a third is special, but because a fix that fails for one
   * reader in three is not "strong evidence" of anything except that the
   * environment constraints are wrong — and the correct response is to show the
   * segmentation, which `needs_reverification` prompts a maintainer to look at.
   */
  FAILURE_RATIO_FORCES_REVIEW: 1 / 3,
  /** Below this many total reports, the ratio rule is not applied: one failure out
   *  of two is not a trend, and treating it as one would flag every new playbook. */
  FAILURE_RATIO_MIN_SAMPLE: 4,
} as const;

/**
 * Derive the band.
 *
 * Order matters and is deliberate: lifecycle state overrides evidence entirely. A
 * deprecated playbook with fifty successful reproductions is still deprecated —
 * the reproductions are why anybody would trust it, which is exactly why the
 * deprecation has to win.
 */
export function deriveConfidenceBand(
  tally: EvidenceTally,
  lifecycle: LifecycleState = { deprecatedAt: null, supersededAt: null, needsReverificationAt: null },
): ConfidenceBand {
  if (lifecycle.deprecatedAt !== null) return "deprecated";
  if (lifecycle.supersededAt !== null) return "deprecated";
  if (lifecycle.needsReverificationAt !== null) return "needs_reverification";

  const totalReports = tally.reproducedPassed + tally.reproducedPartial + tally.reproducedFailed;

  /*
    Recent failures outrank accumulated successes.

    Not a penalty — a statement about what is currently known. Reproducibility
    decays (R-8): a dependency moves, a default changes, and a procedure that
    genuinely worked in March genuinely does not in August. The successes are still
    true about the environments they came from, which is why they stay visible in
    the segment view rather than being deleted.
  */
  if (
    totalReports >= THRESHOLDS.FAILURE_RATIO_MIN_SAMPLE &&
    tally.reproducedFailed / totalReports >= THRESHOLDS.FAILURE_RATIO_FORCES_REVIEW
  ) {
    return "needs_reverification";
  }

  const independentPasses = tally.reproducedPassed + tally.independentConfirmations;

  if (
    independentPasses >= THRESHOLDS.STRONG_PASSES &&
    tally.uniqueEnvironments >= THRESHOLDS.STRONG_UNIQUE_ENVIRONMENTS
  ) {
    return "strong_evidence";
  }

  /*
    Maintainer attestation plus an official source can reach `moderate`, but never
    `strong`, without independent reproduction.

    A maintainer saying "yes, that is the fix" is genuinely strong evidence about
    the cause. It is not evidence that the written procedure works on somebody
    else's machine, which is the specific thing this product measures. Letting
    authority alone reach the top band would reintroduce the badge.
  */
  if (
    independentPasses >= THRESHOLDS.MODERATE_PASSES &&
    tally.uniqueEnvironments >= THRESHOLDS.MODERATE_UNIQUE_ENVIRONMENTS
  ) {
    return "moderate_evidence";
  }

  if (
    tally.maintainerAttestations > 0 &&
    tally.officialReferences > 0 &&
    independentPasses >= THRESHOLDS.LIMITED_PASSES
  ) {
    return "moderate_evidence";
  }

  if (independentPasses >= THRESHOLDS.LIMITED_PASSES || tally.ciExecutions > 0) {
    return "limited_evidence";
  }

  /*
    Everything else is unverified — including a revision with an official reference
    and a maintainer attestation but no reproduction at all.

    R-3 sets the floor: author-tested plus at least one independent reproduction is
    the minimum for any positive signal. Authority is not reproduction.
  */
  return "unverified";
}

/**
 * Whether a success rate may be shown as a percentage.
 *
 * R-4. Called by anything that would render one, so the rule is enforced in a single
 * place rather than remembered in several.
 */
export function mayShowPercentage(totalReports: number): boolean {
  return totalReports >= MIN_SAMPLE_FOR_PERCENTAGE;
}

/**
 * A structured explanation of a band, for "Why this confidence?".
 *
 * Plan §6 requires every band to be explainable. Returning the reasons as data
 * rather than a formatted string means the page can link each one to the evidence
 * that produced it, and the test suite can assert on them.
 */
export interface ConfidenceExplanation {
  band: ConfidenceBand;
  reasons: string[];
  /** What would move it up. Empty when it is already at the top, deprecated, or
   *  under review — in those cases there is no honest "next step". */
  whatWouldStrengthenIt: string[];
}

export function explainConfidence(
  tally: EvidenceTally,
  lifecycle: LifecycleState = { deprecatedAt: null, supersededAt: null, needsReverificationAt: null },
): ConfidenceExplanation {
  const band = deriveConfidenceBand(tally, lifecycle);
  const reasons: string[] = [];
  const next: string[] = [];

  if (lifecycle.deprecatedAt !== null) {
    reasons.push("This revision has been deprecated. Its evidence is kept as history.");
    return { band, reasons, whatWouldStrengthenIt: [] };
  }
  if (lifecycle.supersededAt !== null) {
    reasons.push("A newer revision supersedes this one. Evidence here describes this text only.");
    return { band, reasons, whatWouldStrengthenIt: [] };
  }

  const totalReports = tally.reproducedPassed + tally.reproducedPartial + tally.reproducedFailed;
  const independentPasses = tally.reproducedPassed + tally.independentConfirmations;

  if (tally.authorDocumented) reasons.push("The author documented and tested this themselves.");

  if (independentPasses === 0) {
    reasons.push("Nobody else has reported reproducing it yet.");
  } else {
    reasons.push(
      `${independentPasses} independent ${independentPasses === 1 ? "report" : "reports"} of it working, ` +
        `across ${tally.uniqueEnvironments} ${tally.uniqueEnvironments === 1 ? "environment" : "environments"}.`,
    );
  }

  if (tally.reproducedFailed > 0) {
    reasons.push(
      `${tally.reproducedFailed} ${tally.reproducedFailed === 1 ? "report" : "reports"} of it failing. ` +
        "Failures are kept and shown by environment, not averaged away.",
    );
  }
  if (tally.reproducedPartial > 0) {
    reasons.push(`${tally.reproducedPartial} reported it partly working.`);
  }
  if (tally.ciExecutions > 0) reasons.push(`${tally.ciExecutions} automated executions recorded.`);
  if (tally.maintainerAttestations > 0) {
    reasons.push(
      "A verified maintainer has attested to this. That supports the cause, not the procedure.",
    );
  }
  if (tally.officialReferences > 0) reasons.push("Supported by a cited official source.");

  if (!mayShowPercentage(totalReports) && totalReports > 0) {
    reasons.push(
      `Too few reports (${totalReports}) to state a success rate — counts are shown instead.`,
    );
  }

  if (lifecycle.needsReverificationAt !== null) {
    reasons.push("Flagged for re-verification. Someone should confirm it still works.");
    return { band, reasons, whatWouldStrengthenIt: ["A fresh reproduction on a current version."] };
  }

  if (band !== "strong_evidence") {
    if (independentPasses < THRESHOLDS.STRONG_PASSES) {
      next.push(
        `${THRESHOLDS.STRONG_PASSES - independentPasses} more independent reproductions.`,
      );
    }
    if (tally.uniqueEnvironments < THRESHOLDS.STRONG_UNIQUE_ENVIRONMENTS) {
      next.push(
        `Reproductions from ${THRESHOLDS.STRONG_UNIQUE_ENVIRONMENTS - tally.uniqueEnvironments} more distinct environments.`,
      );
    }
  }

  return { band, reasons, whatWouldStrengthenIt: next };
}

/**
 * Fold a set of evidence rows into a tally.
 *
 * Suppressed rows are excluded from the tally and are **not** deleted anywhere —
 * they remain in `evidence_records` and remain visible to admin. Suppression
 * changes what a number says, never what happened.
 */
export interface EvidenceRow {
  evidenceType: EvidenceType;
  result: EvidenceResult;
  environmentFingerprint: string | null;
  actorId: string | null;
  createdAt: number;
  suppressedAt: number | null;
  /** Independence weight, 0-100, from `actor_trust`. A weight of 0 counts the row
   *  as present but contributes nothing — the report still shows in the list, which
   *  is what makes a suppressed cluster auditable. */
  actorWeight: number;
}

export function tallyEvidence(rows: readonly EvidenceRow[], authorId: string | null): EvidenceTally {
  const tally: EvidenceTally = { ...EMPTY_TALLY };
  const environments = new Set<string>();

  for (const row of rows) {
    if (row.suppressedAt !== null) continue;

    if (row.evidenceType === "contributor_documentation") {
      tally.authorDocumented = true;
      continue;
    }

    /*
      The author's own reproduction is not independent.

      Excluded rather than down-weighted. An author who runs their own playbook and
      reports "worked" has confirmed nothing a reader did not already assume, and
      counting it would let any contributor reach `limited_evidence` alone.
    */
    const isAuthor = authorId !== null && row.actorId === authorId;
    const counts = !isAuthor && row.actorWeight > 0;

    if (row.environmentFingerprint && counts && row.result === "passed") {
      environments.add(row.environmentFingerprint);
    }

    switch (row.evidenceType) {
      case "reproduction":
        if (!counts) break;
        if (row.result === "passed") tally.reproducedPassed += 1;
        else if (row.result === "partial") tally.reproducedPartial += 1;
        else if (row.result === "failed") tally.reproducedFailed += 1;
        break;
      case "independent_confirmation":
        if (counts && row.result === "passed") tally.independentConfirmations += 1;
        break;
      case "ci_execution":
      case "matrix_execution":
        if (row.result === "passed") tally.ciExecutions += 1;
        break;
      case "maintainer_attestation":
        if (row.result === "passed") tally.maintainerAttestations += 1;
        break;
      case "official_reference":
        tally.officialReferences += 1;
        break;
      case "failure_observation":
        /*
          A failure observation counts toward failures even when it comes from the
          author, and even from a zero-weight actor.

          Deliberately asymmetric with successes. A suspected sockpuppet reporting
          "it worked" is worthless; the same account reporting "it failed" is at
          minimum a signal worth a maintainer's attention, and suppressing it is the
          direction of error this product must not make.
        */
        tally.reproducedFailed += 1;
        break;
    }

    if (row.result === "passed") {
      tally.lastSuccessAt = Math.max(tally.lastSuccessAt ?? 0, row.createdAt);
    } else if (row.result === "failed") {
      tally.lastFailureAt = Math.max(tally.lastFailureAt ?? 0, row.createdAt);
    }
  }

  tally.uniqueEnvironments = environments.size;
  return tally;
}

import { describe, expect, it } from "vitest";
import {
  EMPTY_TALLY,
  THRESHOLDS,
  deriveConfidenceBand,
  explainConfidence,
  mayShowPercentage,
  tallyEvidence,
  type EvidenceRow,
  type EvidenceTally,
} from "./confidence.js";

const NO_LIFECYCLE = { deprecatedAt: null, supersededAt: null, needsReverificationAt: null };

function tally(overrides: Partial<EvidenceTally> = {}): EvidenceTally {
  return { ...EMPTY_TALLY, authorDocumented: true, ...overrides };
}

function row(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    evidenceType: "reproduction",
    result: "passed",
    environmentFingerprint: "env-a",
    actorId: "usr_reader",
    createdAt: 1_000,
    suppressedAt: null,
    actorWeight: 100,
    ...overrides,
  };
}

describe("deriveConfidenceBand", () => {
  it("starts unverified no matter how well documented", () => {
    expect(deriveConfidenceBand(tally(), NO_LIFECYCLE)).toBe("unverified");
  });

  it("stays unverified on authority alone", () => {
    /*
      The floor from R-3. A maintainer saying "yes that is the fix", plus an official
      source, plus nobody having reproduced it, is still unverified. Authority is not
      reproduction, and this is the assertion that stops the badge coming back.
    */
    const band = deriveConfidenceBand(
      tally({ maintainerAttestations: 1, officialReferences: 2 }),
      NO_LIFECYCLE,
    );
    expect(band).toBe("unverified");
  });

  it("reaches limited evidence on one independent reproduction", () => {
    expect(deriveConfidenceBand(tally({ reproducedPassed: 1, uniqueEnvironments: 1 }))).toBe(
      "limited_evidence",
    );
  });

  it("needs more than one environment to reach moderate", () => {
    const sameEnvironment = tally({ reproducedPassed: 5, uniqueEnvironments: 1 });
    expect(deriveConfidenceBand(sameEnvironment)).toBe("limited_evidence");
  });

  it("reaches moderate with enough passes across enough environments", () => {
    const t = tally({
      reproducedPassed: THRESHOLDS.MODERATE_PASSES,
      uniqueEnvironments: THRESHOLDS.MODERATE_UNIQUE_ENVIRONMENTS,
    });
    expect(deriveConfidenceBand(t)).toBe("moderate_evidence");
  });

  it("reaches strong only with breadth as well as volume", () => {
    const volumeOnly = tally({ reproducedPassed: 20, uniqueEnvironments: 2 });
    expect(deriveConfidenceBand(volumeOnly)).toBe("moderate_evidence");

    const both = tally({
      reproducedPassed: THRESHOLDS.STRONG_PASSES,
      uniqueEnvironments: THRESHOLDS.STRONG_UNIQUE_ENVIRONMENTS,
    });
    expect(deriveConfidenceBand(both)).toBe("strong_evidence");
  });

  it("pulls back to needs_reverification when failures cluster", () => {
    /*
      Nine successes and five failures is a playbook whose environment constraints
      are wrong, not a strong one. The successes are not deleted — they stay in the
      segment view — but the headline must not claim confidence the reports do not
      support.
    */
    const t = tally({ reproducedPassed: 9, reproducedFailed: 5, uniqueEnvironments: 4 });
    expect(deriveConfidenceBand(t)).toBe("needs_reverification");
  });

  it("does not treat one failure out of two as a trend", () => {
    const t = tally({ reproducedPassed: 1, reproducedFailed: 1, uniqueEnvironments: 1 });
    expect(deriveConfidenceBand(t)).toBe("limited_evidence");
  });

  it("lets lifecycle state override evidence entirely", () => {
    const strong = tally({ reproducedPassed: 50, uniqueEnvironments: 10 });
    expect(deriveConfidenceBand(strong, { ...NO_LIFECYCLE, deprecatedAt: 1 })).toBe("deprecated");
    expect(deriveConfidenceBand(strong, { ...NO_LIFECYCLE, supersededAt: 1 })).toBe("superseded");
    expect(deriveConfidenceBand(strong, { ...NO_LIFECYCLE, needsReverificationAt: 1 })).toBe(
      "needs_reverification",
    );
  });

  /*
    Superseded and deprecated say opposite things, and this used to return
    "deprecated" for both — which told every reader on a historical revision that its
    procedure was known-bad, when it had only been reworded. Found by publishing a
    real second revision on staging and reading the page.
  */
  it("does not tell a reader that a superseded revision is deprecated", () => {
    const strong = tally({ reproducedPassed: 50, uniqueEnvironments: 10 });
    expect(deriveConfidenceBand(strong, { ...NO_LIFECYCLE, supersededAt: 1 })).not.toBe(
      "deprecated",
    );
  });

  it("prefers deprecated when a revision is both superseded and deprecated", () => {
    // Deprecation is the stronger claim — "this no longer works" outranks "there is
    // newer wording" — so a revision carrying both must not be softened to the
    // milder one.
    const strong = tally({ reproducedPassed: 50, uniqueEnvironments: 10 });
    expect(
      deriveConfidenceBand(strong, { ...NO_LIFECYCLE, supersededAt: 1, deprecatedAt: 2 }),
    ).toBe("deprecated");
  });
});

describe("percentage suppression", () => {
  it("refuses a rate below the minimum sample", () => {
    expect(mayShowPercentage(4)).toBe(false);
    expect(mayShowPercentage(5)).toBe(true);
  });
});

describe("tallyEvidence", () => {
  it("does not count the author's own reproduction", () => {
    const rows = [
      row({ evidenceType: "contributor_documentation", actorId: "usr_author" }),
      row({ actorId: "usr_author" }),
    ];
    const result = tallyEvidence(rows, "usr_author");
    expect(result.reproducedPassed).toBe(0);
    expect(result.authorDocumented).toBe(true);
    expect(deriveConfidenceBand(result)).toBe("unverified");
  });

  it("excludes suppressed rows from the tally", () => {
    const rows = [row(), row({ actorId: "usr_b", suppressedAt: 500 })];
    expect(tallyEvidence(rows, "usr_author").reproducedPassed).toBe(1);
  });

  it("gives a zero-weight actor no positive credit", () => {
    const rows = [row({ actorId: "usr_sock", actorWeight: 0 })];
    expect(tallyEvidence(rows, "usr_author").reproducedPassed).toBe(0);
  });

  it("still counts a failure observation from a zero-weight actor", () => {
    /*
      The deliberate asymmetry. A suspected sockpuppet claiming success is worthless;
      the same account reporting a failure is at minimum worth a maintainer looking,
      and suppressing it is the direction of error this product must not make.
    */
    const rows = [row({ evidenceType: "failure_observation", result: "failed", actorWeight: 0 })];
    expect(tallyEvidence(rows, "usr_author").reproducedFailed).toBe(1);
  });

  it("counts unique environments only from passing reproductions", () => {
    const rows = [
      row({ actorId: "a", environmentFingerprint: "env-1" }),
      row({ actorId: "b", environmentFingerprint: "env-2" }),
      row({ actorId: "c", environmentFingerprint: "env-2" }),
    ];
    expect(tallyEvidence(rows, "usr_author").uniqueEnvironments).toBe(2);
  });

  it("records the most recent success and failure", () => {
    const rows = [
      row({ actorId: "a", createdAt: 100 }),
      row({ actorId: "b", createdAt: 900 }),
      row({ actorId: "c", result: "failed", createdAt: 400 }),
    ];
    const result = tallyEvidence(rows, "usr_author");
    expect(result.lastSuccessAt).toBe(900);
    expect(result.lastFailureAt).toBe(400);
  });
});

describe("explainConfidence", () => {
  it("always produces at least one reason", () => {
    const explanation = explainConfidence(tally(), NO_LIFECYCLE);
    expect(explanation.reasons.length).toBeGreaterThan(0);
  });

  it("names failures explicitly rather than hiding them", () => {
    const explanation = explainConfidence(
      tally({ reproducedPassed: 2, reproducedFailed: 1, uniqueEnvironments: 2 }),
      NO_LIFECYCLE,
    );
    expect(explanation.reasons.join(" ")).toMatch(/failing/);
  });

  it("says why no rate is shown when the sample is small", () => {
    const explanation = explainConfidence(
      tally({ reproducedPassed: 2, uniqueEnvironments: 2 }),
      NO_LIFECYCLE,
    );
    expect(explanation.reasons.join(" ")).toMatch(/Too few reports/);
  });

  it("offers nothing to strengthen a deprecated revision", () => {
    const explanation = explainConfidence(tally({ reproducedPassed: 3 }), {
      ...NO_LIFECYCLE,
      deprecatedAt: 1,
    });
    expect(explanation.whatWouldStrengthenIt).toHaveLength(0);
  });
});

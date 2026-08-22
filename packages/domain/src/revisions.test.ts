import { describe, expect, it } from "vitest";
import { ApiError } from "@devyou/core";
import {
  FAILURE_CLUSTER_MIN_REPORTS,
  FAILURE_CLUSTER_RATIO,
  INITIAL_BAND,
  STALE_AFTER_MS,
  canPublish,
  isCurrent,
  stalenessTriggers,
  supersede,
  type PublishInput,
  type RevisionState,
  type StalenessInput,
} from "./revisions.js";

function revision(overrides: Partial<RevisionState> = {}): RevisionState {
  return {
    id: "rev_1",
    playbookId: "pb_1",
    revisionNumber: 1,
    status: "draft",
    publishedAt: null,
    supersededAt: null,
    deprecatedAt: null,
    needsReverificationAt: null,
    ...overrides,
  };
}

function publishInput(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    revision: revision(),
    graphValid: true,
    unconfirmedInferredFields: [],
    unclassifiedCommandNodes: [],
    blockingSafetyFindings: [],
    hasEnvironmentConstraints: true,
    ...overrides,
  };
}

function stalenessInput(overrides: Partial<StalenessInput> = {}): StalenessInput {
  return {
    lastSuccessAt: 1_000,
    publishedAt: 0,
    now: 1_000,
    newReleasesOutsideRange: 0,
    recentFailures: 0,
    recentReports: 0,
    maintainerReported: false,
    linkedAdvisory: false,
    ...overrides,
  };
}

describe("canPublish", () => {
  it("allows a clean draft", () => {
    const decision = canPublish(publishInput());
    expect(decision.allowed).toBe(true);
    expect(decision.blockers).toHaveLength(0);
  });

  it("blocks with already_published when the revision is already published", () => {
    const decision = canPublish(publishInput({ revision: revision({ publishedAt: 500 }) }));
    expect(decision.allowed).toBe(false);
    expect(decision.blockers.map((b) => b.code)).toContain("already_published");
  });

  it("blocks with graph_invalid when the diagnostic graph has errors", () => {
    const decision = canPublish(publishInput({ graphValid: false }));
    expect(decision.allowed).toBe(false);
    expect(decision.blockers.map((b) => b.code)).toContain("graph_invalid");
  });

  it("blocks with unconfirmed_ai_fields when an AI-inferred field was never confirmed", () => {
    const decision = canPublish(publishInput({ unconfirmedInferredFields: ["technologies.0.range"] }));
    expect(decision.allowed).toBe(false);
    expect(decision.blockers.map((b) => b.code)).toContain("unconfirmed_ai_fields");
  });

  it("blocks with unclassified_commands when a command has no safety classification", () => {
    const decision = canPublish(publishInput({ unclassifiedCommandNodes: ["node_1"] }));
    expect(decision.allowed).toBe(false);
    expect(decision.blockers.map((b) => b.code)).toContain("unclassified_commands");
  });

  it("blocks with safety_findings when the security sweep raised a blocking finding", () => {
    const decision = canPublish(publishInput({ blockingSafetyFindings: ["leaks a credential"] }));
    expect(decision.allowed).toBe(false);
    expect(decision.blockers.map((b) => b.code)).toContain("safety_findings");
  });

  it("blocks with no_environment_constraints when no environment scope was declared", () => {
    const decision = canPublish(publishInput({ hasEnvironmentConstraints: false }));
    expect(decision.allowed).toBe(false);
    expect(decision.blockers.map((b) => b.code)).toContain("no_environment_constraints");
  });

  it("accumulates every blocker rather than stopping at the first one", () => {
    const decision = canPublish(
      publishInput({
        revision: revision({ publishedAt: 500 }),
        graphValid: false,
        unconfirmedInferredFields: ["a"],
        unclassifiedCommandNodes: ["b"],
        blockingSafetyFindings: ["c"],
        hasEnvironmentConstraints: false,
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.blockers.map((b) => b.code).sort()).toEqual(
      [
        "already_published",
        "graph_invalid",
        "unconfirmed_ai_fields",
        "unclassified_commands",
        "safety_findings",
        "no_environment_constraints",
      ].sort(),
    );
  });
});

describe("INITIAL_BAND", () => {
  /*
    R-1: evidence belongs to the revision it was tested against and never transfers
    automatically, even when a reviewer believes the old evidence still applies. That
    judgement has to be recorded as fresh evidence against the new revision, so every
    newly published revision starts at "unverified" with no exception baked in here.
  */
  it("is always unverified", () => {
    expect(INITIAL_BAND).toBe("unverified");
  });
});

describe("supersede", () => {
  it("throws when the previous revision was never published", () => {
    expect(() =>
      supersede({
        previous: revision({ id: "rev_old", publishedAt: null }),
        next: revision({ id: "rev_new", publishedAt: 1_000 }),
        now: 2_000,
      }),
    ).toThrow(ApiError);
  });

  it("throws when the next revision is not yet published", () => {
    expect(() =>
      supersede({
        previous: revision({ id: "rev_old", publishedAt: 500 }),
        next: revision({ id: "rev_new", publishedAt: null }),
        now: 2_000,
      }),
    ).toThrow(ApiError);
  });

  it("throws when the two revisions belong to different playbooks", () => {
    expect(() =>
      supersede({
        previous: revision({ id: "rev_old", playbookId: "pb_a", publishedAt: 500 }),
        next: revision({ id: "rev_new", playbookId: "pb_b", publishedAt: 1_000 }),
        now: 2_000,
      }),
    ).toThrow(ApiError);
  });

  it("sets supersededAt and status on the previous revision and leaves the next one untouched", () => {
    const previous = revision({ id: "rev_old", publishedAt: 500 });
    const next = revision({ id: "rev_new", publishedAt: 1_000 });

    const result = supersede({ previous, next, now: 2_000 });

    expect(result.previous.supersededAt).toBe(2_000);
    expect(result.previous.status).toBe("superseded");
    expect(result.next).toBe(next);
  });
});

describe("isCurrent", () => {
  it("is false for a superseded revision", () => {
    expect(isCurrent(revision({ publishedAt: 500, supersededAt: 1_000 }))).toBe(false);
  });

  it("is false for a deprecated revision", () => {
    expect(isCurrent(revision({ publishedAt: 500, deprecatedAt: 1_000 }))).toBe(false);
  });

  it("is true for a plain published revision", () => {
    expect(isCurrent(revision({ publishedAt: 500 }))).toBe(true);
  });
});

describe("stalenessTriggers", () => {
  it("fires time_since_last_success once STALE_AFTER_MS has passed since the last success", () => {
    const triggers = stalenessTriggers(
      stalenessInput({ lastSuccessAt: 0, publishedAt: 0, now: STALE_AFTER_MS + 1 }),
    );
    expect(triggers).toContain("time_since_last_success");
  });

  it("uses publishedAt as the baseline when there has never been a success", () => {
    const triggers = stalenessTriggers(
      stalenessInput({ lastSuccessAt: null, publishedAt: 0, now: STALE_AFTER_MS + 1 }),
    );
    expect(triggers).toContain("time_since_last_success");
  });

  it("fires new_major_or_minor_release when a release falls outside the declared range", () => {
    const triggers = stalenessTriggers(stalenessInput({ newReleasesOutsideRange: 1 }));
    expect(triggers).toContain("new_major_or_minor_release");
  });

  it("does not fire failure_cluster below the minimum report count, even at a 100% failure rate", () => {
    const triggers = stalenessTriggers(
      stalenessInput({
        recentReports: FAILURE_CLUSTER_MIN_REPORTS - 1,
        recentFailures: FAILURE_CLUSTER_MIN_REPORTS - 1,
      }),
    );
    expect(triggers).not.toContain("failure_cluster");
  });

  it("does not fire failure_cluster when reports are plentiful but the ratio is below threshold", () => {
    const triggers = stalenessTriggers(
      stalenessInput({ recentReports: 10, recentFailures: Math.floor(10 * FAILURE_CLUSTER_RATIO) - 1 }),
    );
    expect(triggers).not.toContain("failure_cluster");
  });

  it("fires failure_cluster once both the report count and the ratio meet their thresholds", () => {
    const recentReports = FAILURE_CLUSTER_MIN_REPORTS;
    const recentFailures = Math.ceil(recentReports * FAILURE_CLUSTER_RATIO);
    const triggers = stalenessTriggers(stalenessInput({ recentReports, recentFailures }));
    expect(triggers).toContain("failure_cluster");
  });

  it("returns no triggers for a healthy, recently verified revision", () => {
    const triggers = stalenessTriggers(
      stalenessInput({
        lastSuccessAt: 900,
        publishedAt: 0,
        now: 1_000,
        newReleasesOutsideRange: 0,
        recentFailures: 0,
        recentReports: 0,
        maintainerReported: false,
        linkedAdvisory: false,
      }),
    );
    expect(triggers).toEqual([]);
  });

  it("can return several triggers at once", () => {
    const triggers = stalenessTriggers(
      stalenessInput({
        lastSuccessAt: 0,
        publishedAt: 0,
        now: STALE_AFTER_MS + 1,
        newReleasesOutsideRange: 1,
        maintainerReported: true,
        linkedAdvisory: true,
      }),
    );
    expect(triggers).toEqual([
      "time_since_last_success",
      "new_major_or_minor_release",
      "maintainer_report",
      "security_advisory",
    ]);
  });
});

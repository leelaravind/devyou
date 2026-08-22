import { ApiError, newId, type ReproductionOutcome } from "@devyou/core";
import {
  deriveConfidenceBand,
  fingerprintEnvironment,
  describeEnvironment,
  tallyEvidence,
  type EnvironmentSnapshot,
  type EvidenceRow,
} from "@devyou/domain";

/**
 * Recording a reproduction.
 *
 * This is the write path the whole product turns on, so its rules are stated here
 * rather than spread across the route.
 *
 * 1. **The environment is snapshotted, not referenced.** A new immutable
 *    `environment_snapshots` row is written from whatever the reader declared at
 *    this moment. Plan §5 forbids evidence pointing at a mutable preset, because
 *    upgrading Node would otherwise rewrite the environment of every reproduction
 *    that person had ever filed.
 * 2. **The report and the evidence are written together.** A report without its
 *    evidence row would be invisible to confidence derivation; evidence without its
 *    report would have no abuse metadata. They are one batch.
 * 3. **Nothing is ever updated.** A second report from the same actor on the same
 *    revision is rejected by a unique index, not by an upsert. Changing your mind is
 *    a new revision's problem, not a rewrite of the record.
 * 4. **The confidence cache is recomputed from the append-only rows**, never
 *    incremented. An increment drifts; a recomputation cannot.
 */

export interface ReproductionInput {
  revisionId: string;
  actorId: string | null;
  outcome: ReproductionOutcome;
  reachedNodeId: string | null;
  notes: string | null;
  environment: EnvironmentSnapshot;
  ipHash: string | null;
  turnstileVerified: boolean;
}

const MAX_NOTES = 2000;

export async function recordReproduction(
  db: D1Database,
  input: ReproductionInput,
): Promise<{ reportId: string; band: string }> {
  const now = Math.floor(Date.now() / 1000);

  const revision = await db
    .prepare(
      `SELECT r.id, r.published_at, p.created_by AS author_id
       FROM playbook_revisions r
       JOIN playbooks p ON p.id = r.playbook_id
       WHERE r.id = ?1`,
    )
    .bind(input.revisionId)
    .first<{ id: string; published_at: number | null; author_id: string | null }>();

  if (!revision || revision.published_at === null) {
    /*
      404 rather than 422.

      A revision id is not secret, but confirming that an unpublished one exists
      turns this endpoint into an existence oracle for drafts. There is no case
      where an honest caller reaches here with an unpublished id.
    */
    throw new ApiError("NOT_FOUND", {
      internalDetail: `reproduction against unpublished or missing revision ${input.revisionId}`,
    });
  }

  const snapshotId = newId("environmentSnapshot");
  const evidenceId = newId("evidence");
  const reportId = newId("reproduction");

  const fingerprint = fingerprintEnvironment(input.environment);
  const label = describeEnvironment(input.environment);

  /*
    `outcome` maps to an evidence type and a result, and the mapping is not the
    identity function.

    A "failed" report becomes a `reproduction` record with result `failed` — not a
    `failure_observation`. The distinction matters: `failure_observation` is for a
    failure reported *without* someone having worked the playbook, and counts even
    from a zero-weight actor. A failed reproduction came from somebody who followed
    the procedure, and is weighted like any other reproduction.
  */
  const result = input.outcome === "worked" ? "passed" : input.outcome === "partial" ? "partial" : "failed";

  const statements = [
    db
      .prepare(
        `INSERT INTO environment_snapshots (id, created_at, label, os_family, os_version, architecture, fingerprint)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        snapshotId,
        now,
        label,
        input.environment.osFamily,
        input.environment.osVersion,
        input.environment.architecture,
        fingerprint,
      ),
    ...input.environment.components.map((component, index) =>
      db
        .prepare(
          `INSERT INTO environment_snapshot_components (id, snapshot_id, technology_id, raw_label, semver_normalized)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(
          `${snapshotId}_c${index}`,
          snapshotId,
          component.technologyId,
          component.rawLabel,
          component.semverNormalized,
        ),
    ),
    db
      .prepare(
        `INSERT INTO evidence_records
           (id, revision_id, node_id, evidence_type, result, actor_id, environment_snapshot_id, created_at)
         VALUES (?1, ?2, ?3, 'reproduction', ?4, ?5, ?6, ?7)`,
      )
      .bind(evidenceId, input.revisionId, input.reachedNodeId, result, input.actorId, snapshotId, now),
    db
      .prepare(
        `INSERT INTO reproduction_reports
           (id, revision_id, actor_id, environment_snapshot_id, outcome, reached_node_id,
            notes, evidence_record_id, created_at, ip_hash, turnstile_verified, review_state)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'accepted')`,
      )
      .bind(
        reportId,
        input.revisionId,
        input.actorId,
        snapshotId,
        input.outcome,
        input.reachedNodeId,
        input.notes ? input.notes.slice(0, MAX_NOTES) : null,
        evidenceId,
        now,
        input.ipHash,
        input.turnstileVerified ? 1 : 0,
      ),
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") && message.includes("reproduction_reports")) {
      throw new ApiError("CONFLICT", {
        publicMessage: "You have already reported on this revision.",
        internalDetail: `duplicate reproduction ${input.actorId} on ${input.revisionId}`,
      });
    }
    throw error;
  }

  const band = await recomputeConfidence(db, input.revisionId, revision.author_id);
  return { reportId, band };
}

/**
 * Recompute a revision's cached confidence from its evidence.
 *
 * A full recomputation rather than an increment. Increments drift — a failed batch,
 * a suppression, a trust-weight change, and the cached number quietly stops matching
 * the rows it claims to summarise. This reads the rows every time, which on a
 * revision with a few dozen evidence records is one indexed query.
 *
 * A test regenerates this table for every revision and asserts it matches, which is
 * only a meaningful test because this function is the sole writer.
 */
export async function recomputeConfidence(
  db: D1Database,
  revisionId: string,
  authorId: string | null,
): Promise<string> {
  const rows = await db
    .prepare(
      /*
        An anonymous report is worth 0 toward the band, and is still stored and
        still shown.

        This is the least bad answer to an explicitly unresolved question. The UX
        research lists "whether Sybil-resistant telemetry can be gathered from
        unauthenticated users" as open, and no existing product has solved it. The
        two obvious options are both worse: counting anonymous reports makes the
        confidence band trivially forgeable by anyone with a script, and refusing
        them outright throws away real signal and breaks the low-friction promise
        in plan §0.8.

        So the report is recorded, appears in the evidence list marked as anonymous,
        and a maintainer can see a cluster of them — while the number a reader is
        asked to trust comes only from accounts. The reporting flow stays inside
        R-31's 10-30 seconds either way; signing in changes what the report counts
        for, not how long it takes to file.
      */
      `SELECT e.evidence_type, e.result, e.actor_id, e.created_at, e.suppressed_at,
              s.fingerprint AS environment_fingerprint,
              CASE WHEN e.actor_id IS NULL THEN 0 ELSE coalesce(t.weight, 100) END AS actor_weight
       FROM evidence_records e
       LEFT JOIN environment_snapshots s ON s.id = e.environment_snapshot_id
       LEFT JOIN actor_trust t ON t.user_id = e.actor_id
       WHERE e.revision_id = ?1`,
    )
    .bind(revisionId)
    .all<{
      evidence_type: string;
      result: string;
      actor_id: string | null;
      created_at: number;
      suppressed_at: number | null;
      environment_fingerprint: string | null;
      actor_weight: number;
    }>();

  const evidence: EvidenceRow[] = rows.results.map((row) => ({
    evidenceType: row.evidence_type as EvidenceRow["evidenceType"],
    result: row.result as EvidenceRow["result"],
    environmentFingerprint: row.environment_fingerprint,
    actorId: row.actor_id,
    createdAt: row.created_at,
    suppressedAt: row.suppressed_at,
    actorWeight: row.actor_weight,
  }));

  const tally = tallyEvidence(evidence, authorId);

  const lifecycle = await db
    .prepare(
      `SELECT deprecated_at, superseded_at, needs_reverification_at
       FROM playbook_revisions WHERE id = ?1`,
    )
    .bind(revisionId)
    .first<{
      deprecated_at: number | null;
      superseded_at: number | null;
      needs_reverification_at: number | null;
    }>();

  const band = deriveConfidenceBand(tally, {
    deprecatedAt: lifecycle?.deprecated_at ?? null,
    supersededAt: lifecycle?.superseded_at ?? null,
    needsReverificationAt: lifecycle?.needs_reverification_at ?? null,
  });

  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO revision_confidence
         (revision_id, band, reproduced_passed, reproduced_partial, reproduced_failed,
          independent_confirmations, unique_environments, ci_executions,
          maintainer_attestations, official_references, last_success_at, last_failure_at, computed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
       ON CONFLICT(revision_id) DO UPDATE SET
         band = excluded.band,
         reproduced_passed = excluded.reproduced_passed,
         reproduced_partial = excluded.reproduced_partial,
         reproduced_failed = excluded.reproduced_failed,
         independent_confirmations = excluded.independent_confirmations,
         unique_environments = excluded.unique_environments,
         ci_executions = excluded.ci_executions,
         maintainer_attestations = excluded.maintainer_attestations,
         official_references = excluded.official_references,
         last_success_at = excluded.last_success_at,
         last_failure_at = excluded.last_failure_at,
         computed_at = excluded.computed_at`,
    )
    .bind(
      revisionId,
      band,
      tally.reproducedPassed,
      tally.reproducedPartial,
      tally.reproducedFailed,
      tally.independentConfirmations,
      tally.uniqueEnvironments,
      tally.ciExecutions,
      tally.maintainerAttestations,
      tally.officialReferences,
      tally.lastSuccessAt,
      tally.lastFailureAt,
      now,
    )
    .run();

  await recomputeSegments(db, revisionId, now);
  return band;
}

/**
 * Per-environment segments.
 *
 * R-5: evidence on Node 20 says nothing certain about Node 22, so a single global
 * band is a half-truth. These rows are what let the compatibility matrix say "works
 * on 20, fails on 22" rather than averaging the two into "mostly works" — which is
 * the specific dishonesty plan §6 forbids.
 *
 * Bucketed at major version. Finer than that and almost every segment has n=1, which
 * the percentage rule will refuse to express as a rate anyway.
 */
async function recomputeSegments(db: D1Database, revisionId: string, now: number): Promise<void> {
  const rows = await db
    .prepare(
      `SELECT c.technology_id,
              substr(c.semver_normalized, 1, 5) AS version_bucket,
              s.os_family,
              r.outcome,
              r.created_at
       FROM reproduction_reports r
       JOIN environment_snapshots s ON s.id = r.environment_snapshot_id
       LEFT JOIN environment_snapshot_components c ON c.snapshot_id = s.id
       WHERE r.revision_id = ?1 AND r.review_state = 'accepted'`,
    )
    .bind(revisionId)
    .all<{
      technology_id: string | null;
      version_bucket: string | null;
      os_family: string | null;
      outcome: string;
      created_at: number;
    }>();

  const segments = new Map<
    string,
    { technologyId: string | null; bucket: string | null; os: string | null; passed: number; partial: number; failed: number; last: number }
  >();

  for (const row of rows.results) {
    const key = `${row.technology_id ?? ""}|${row.version_bucket ?? ""}|${row.os_family ?? ""}`;
    const segment = segments.get(key) ?? {
      technologyId: row.technology_id,
      bucket: row.version_bucket,
      os: row.os_family,
      passed: 0,
      partial: 0,
      failed: 0,
      last: 0,
    };
    if (row.outcome === "worked") segment.passed += 1;
    else if (row.outcome === "partial") segment.partial += 1;
    else segment.failed += 1;
    segment.last = Math.max(segment.last, row.created_at);
    segments.set(key, segment);
  }

  const statements = [
    db.prepare(`DELETE FROM revision_confidence_segments WHERE revision_id = ?1`).bind(revisionId),
    ...[...segments.entries()].map(([key, segment]) =>
      db
        .prepare(
          `INSERT INTO revision_confidence_segments
             (id, revision_id, technology_id, version_bucket, os_family, passed, partial, failed, last_report_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        )
        .bind(
          `seg_${revisionId}_${hashKey(key)}`,
          revisionId,
          segment.technologyId,
          segment.bucket,
          segment.os,
          segment.passed,
          segment.partial,
          segment.failed,
          segment.last,
        ),
    ),
  ];

  void now;
  await db.batch(statements);
}

/** A short deterministic id fragment. Not security-relevant — it only has to be
 *  stable and unique within one revision's segments. */
function hashKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * A one-way hash of the caller's IP, for abuse clustering.
 *
 * The raw address is never stored. What anti-gaming needs is "were these ten
 * reports from the same place", which a hash answers, and it does not need to know
 * where that place is. The salt is per-revision so the same reader on two playbooks
 * does not produce a linkable identifier across the corpus.
 */
export async function hashIp(ip: string | null, salt: string): Promise<string | null> {
  if (!ip) return null;
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

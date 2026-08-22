import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./identity.js";
import { technologies, versions } from "./taxonomy.js";
import { diagnosticNodes, playbookRevisions, sourceReferences } from "./knowledge.js";

/**
 * Evidence.
 *
 * Two properties define this file, and both are enforced by triggers in the
 * migration rather than by convention:
 *
 * **Append-only.** No row in `evidence_records` or `reproduction_reports` may be
 * updated or deleted, by anybody, ever. Not by an admin, not by the author, not by
 * the person who wrote it. A failed reproduction is evidence (plan §0.3), and a
 * system where an inconvenient result can be removed produces confidence numbers
 * that mean nothing.
 *
 * **Revision-bound.** `revisionId` is `notNull` and points at an immutable
 * revision. There is no column pointing at a playbook. Evidence therefore cannot
 * follow an edit, because it has no way to refer to the thing that was edited.
 */

/**
 * An immutable snapshot of the environment a reproduction ran in.
 *
 * Evidence never references a mutable preset — plan §5 is explicit about this, and
 * the reason is that a preset is a user's *current* setup. If evidence pointed at
 * one, upgrading Node would silently rewrite the environment of every reproduction
 * that person had ever filed.
 */
export const environmentSnapshots = sqliteTable(
  "environment_snapshots",
  {
    id: text("id").primaryKey(),
    createdAt: integer("created_at").notNull(),
    /** Denormalised human-readable summary — "Ubuntu 24.04 · Node 22.3 · Docker
     *  27.1". Kept so a snapshot stays readable even if a technology row is later
     *  merged or renamed. */
    label: text("label").notNull(),
    osFamily: text("os_family"),
    osVersion: text("os_version"),
    architecture: text("architecture"),
    /** Stable hash of the components, so identical environments can be counted as
     *  one for "unique environments" without joining every component row. */
    fingerprint: text("fingerprint").notNull(),
  },
  (table) => [index("environment_snapshots_fingerprint_idx").on(table.fingerprint)],
);

export const environmentSnapshotComponents = sqliteTable(
  "environment_snapshot_components",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => environmentSnapshots.id, { onDelete: "cascade" }),
    technologyId: text("technology_id").references(() => technologies.id, {
      onDelete: "set null",
    }),
    versionId: text("version_id").references(() => versions.id, { onDelete: "set null" }),
    /** Free text as the reader typed it. Retained even when it resolves cleanly:
     *  "22.3.0" and "v22.3" are the same version and different evidence about how
     *  people describe their setup, which the parser needs. */
    rawLabel: text("raw_label").notNull(),
    semverNormalized: text("semver_normalized"),
  },
  (table) => [
    index("env_snapshot_components_snapshot_idx").on(table.snapshotId),
    index("env_snapshot_components_tech_idx").on(table.technologyId),
  ],
);

/**
 * A user's saved environment. Mutable, and never referenced by evidence.
 */
export const environmentPresets = sqliteTable(
  "environment_presets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    osFamily: text("os_family"),
    osVersion: text("os_version"),
    architecture: text("architecture"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("environment_presets_user_idx").on(table.userId)],
);

export const environmentPresetComponents = sqliteTable(
  "environment_preset_components",
  {
    id: text("id").primaryKey(),
    presetId: text("preset_id")
      .notNull()
      .references(() => environmentPresets.id, { onDelete: "cascade" }),
    technologyId: text("technology_id").references(() => technologies.id, { onDelete: "cascade" }),
    rawLabel: text("raw_label").notNull(),
    semverNormalized: text("semver_normalized"),
  },
  (table) => [index("environment_preset_components_preset_idx").on(table.presetId)],
);

/**
 * Evidence records. Append-only.
 *
 * `result` is `notNull`. There is no evidence without an outcome — a record that
 * says only "somebody looked at this" is not evidence of anything, and allowing it
 * would let a count of nothing masquerade as support.
 */
export const evidenceRecords = sqliteTable(
  "evidence_records",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => playbookRevisions.id, { onDelete: "restrict" }),
    /** Which claim inside the revision this supports. Null means the revision as a
     *  whole. `restrict` on delete, not `cascade`: deleting a node that has evidence
     *  should fail loudly, because published revisions are immutable and a node with
     *  evidence being deleted means something has already gone wrong. */
    nodeId: text("node_id").references(() => diagnosticNodes.id, { onDelete: "restrict" }),
    /** See `EVIDENCE_TYPES`. Not a rank — see the comment on that constant. */
    evidenceType: text("evidence_type").notNull(),
    /** See `EVIDENCE_RESULTS`. */
    result: text("result").notNull(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    environmentSnapshotId: text("environment_snapshot_id").references(
      () => environmentSnapshots.id,
      { onDelete: "restrict" },
    ),
    sourceReferenceId: text("source_reference_id").references(() => sourceReferences.id, {
      onDelete: "restrict",
    }),
    /** R2 key for an attached log or screenshot. The object is in
     *  `devyou-evidence-*`; this is the only pointer to it. */
    attachmentKey: text("attachment_key"),
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at").notNull(),
    /**
     * Set when this record is excluded from confidence derivation — a confirmed
     * gaming cluster, or a moderation outcome.
     *
     * The record is **never deleted**. It stays visible in the admin evidence
     * inspector, because the proof that justified suppressing it is the record
     * itself. A suppression that erased its own evidence would be unauditable.
     */
    suppressedAt: integer("suppressed_at"),
    suppressionReason: text("suppression_reason"),
  },
  (table) => [
    index("evidence_records_revision_idx").on(table.revisionId),
    index("evidence_records_node_idx").on(table.nodeId),
    index("evidence_records_type_idx").on(table.revisionId, table.evidenceType),
    index("evidence_records_actor_idx").on(table.actorId),
    index("evidence_records_created_idx").on(table.createdAt),
  ],
);

/**
 * Worked / Partial / Failed reports. Append-only.
 *
 * The whole flow has a 10–30 second budget (R-31), which is why `notes` is nullable
 * and `environmentSnapshotId` is prefilled from the session. Requiring a written
 * justification is a named abandonment trigger.
 *
 * One report per actor per revision, enforced by a unique index. Not to prevent
 * dishonesty — it prevents an accidental double-submit from counting twice, which
 * on a corpus this small would visibly move a number.
 */
export const reproductionReports = sqliteTable(
  "reproduction_reports",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => playbookRevisions.id, { onDelete: "restrict" }),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    environmentSnapshotId: text("environment_snapshot_id")
      .notNull()
      .references(() => environmentSnapshots.id, { onDelete: "restrict" }),
    /** See `REPRODUCTION_OUTCOMES`. */
    outcome: text("outcome").notNull(),
    /** Which node they got to, when the report came from a diagnostic session.
     *  A "failed" at the third test is different knowledge from a "failed" at the
     *  fix, and collapsing them loses where the playbook actually breaks. */
    reachedNodeId: text("reached_node_id").references(() => diagnosticNodes.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    /** The evidence record this report generated. Every report becomes evidence;
     *  the two tables exist because a report is a user action with abuse metadata
     *  and evidence is the derived fact. */
    evidenceRecordId: text("evidence_record_id").references(() => evidenceRecords.id, {
      onDelete: "restrict",
    }),
    createdAt: integer("created_at").notNull(),
    /* Abuse metadata. Hashed, never raw — a reproduction report is not a reason to
       keep somebody's IP address. */
    ipHash: text("ip_hash"),
    turnstileVerified: integer("turnstile_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    reviewState: text("review_state").notNull().default("accepted"),
  },
  (table) => [
    uniqueIndex("reproduction_reports_actor_revision_unique").on(table.revisionId, table.actorId),
    index("reproduction_reports_revision_idx").on(table.revisionId),
    index("reproduction_reports_outcome_idx").on(table.revisionId, table.outcome),
    index("reproduction_reports_created_idx").on(table.createdAt),
  ],
);

/**
 * A cached, derived view of a revision's confidence.
 *
 * Strictly a cache. It is recomputed from `evidence_records` by a job and by any
 * write that adds evidence, and every field here can be regenerated from the
 * append-only tables. It exists because deriving a band on every playbook render
 * would mean several aggregate queries per page on the hottest route in the
 * product.
 *
 * Nothing may write a band here that the derivation function did not produce. A
 * test regenerates the whole table from raw evidence and asserts it matches.
 */
export const revisionConfidence = sqliteTable(
  "revision_confidence",
  {
    revisionId: text("revision_id")
      .primaryKey()
      .references(() => playbookRevisions.id, { onDelete: "cascade" }),
    /** See `CONFIDENCE_BANDS`. */
    band: text("band").notNull(),
    reproducedPassed: integer("reproduced_passed").notNull().default(0),
    reproducedPartial: integer("reproduced_partial").notNull().default(0),
    reproducedFailed: integer("reproduced_failed").notNull().default(0),
    independentConfirmations: integer("independent_confirmations").notNull().default(0),
    uniqueEnvironments: integer("unique_environments").notNull().default(0),
    ciExecutions: integer("ci_executions").notNull().default(0),
    maintainerAttestations: integer("maintainer_attestations").notNull().default(0),
    officialReferences: integer("official_references").notNull().default(0),
    lastSuccessAt: integer("last_success_at"),
    lastFailureAt: integer("last_failure_at"),
    computedAt: integer("computed_at").notNull(),
  },
  (table) => [index("revision_confidence_band_idx").on(table.band)],
);

/**
 * Confidence per environment segment.
 *
 * R-5: evidence on v18 says nothing certain about v22, so a single global band is a
 * half-truth. This table is what lets the compatibility matrix (R-30) show "works
 * on 20, fails on 22" instead of averaging them into "mostly works", which is the
 * specific dishonesty plan §6 forbids.
 */
export const revisionConfidenceSegments = sqliteTable(
  "revision_confidence_segments",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => playbookRevisions.id, { onDelete: "cascade" }),
    technologyId: text("technology_id").references(() => technologies.id, { onDelete: "cascade" }),
    /** Major.minor bucket, e.g. "22.3" → "22". Finer than this and every segment
     *  has n=1, which R-4 will refuse to express as a rate anyway. */
    versionBucket: text("version_bucket"),
    osFamily: text("os_family"),
    passed: integer("passed").notNull().default(0),
    partial: integer("partial").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    lastReportAt: integer("last_report_at"),
  },
  (table) => [
    uniqueIndex("revision_confidence_segments_unique").on(
      table.revisionId,
      table.technologyId,
      table.versionBucket,
      table.osFamily,
    ),
    index("revision_confidence_segments_revision_idx").on(table.revisionId),
  ],
);

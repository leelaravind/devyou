import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./identity.js";
import { technologies, versions } from "./taxonomy.js";

/**
 * The knowledge model.
 *
 * The shape that matters: `playbooks` is a stable identity and `playbook_revisions`
 * are immutable snapshots. Every piece of content — nodes, edges, environment
 * constraints — hangs off a *revision*, never off the playbook. That is what makes
 * "evidence is bound to the exact revision it validated" (R-1) enforceable rather
 * than aspirational: there is no way to attach evidence to a playbook, because a
 * playbook has no content.
 */

export const problems = sqliteTable(
  "problems",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    canonicalTitle: text("canonical_title").notNull(),
    summary: text("summary").notNull(),
    /** See `PROBLEM_STATUSES`. */
    status: text("status").notNull().default("active"),
    /** Set when this problem is merged into another. The row survives so old URLs
     *  redirect instead of 404ing — a dead link to a merged problem is a lost
     *  reader and a lost inbound reference. */
    mergedIntoId: text("merged_into_id"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("problems_slug_unique").on(table.slug),
    index("problems_status_idx").on(table.status),
  ],
);

/**
 * Error fingerprints.
 *
 * R-18 makes this a first-class retrieval path rather than a preprocessing detail.
 * The normalisation follows the Sentry grouping model — stack trace first, then
 * exception type, then message — because the message is the part most polluted by
 * request ids, timestamps and absolute paths.
 *
 * `signatureHash` is the join key between "what the reader pasted" and "what a
 * playbook is about". It is indexed and looked up before any full-text search runs.
 */
export const problemSignatures = sqliteTable(
  "problem_signatures",
  {
    id: text("id").primaryKey(),
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    /** Vendor error code where one exists: `SQLITE_BUSY`, `ECONNREFUSED`, `40001`. */
    errorCode: text("error_code"),
    /** The message with volatile parts removed. */
    normalizedMessage: text("normalized_message").notNull(),
    signatureHash: text("signature_hash").notNull(),
    languageHint: text("language_hint"),
    runtimeHint: text("runtime_hint"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("problem_signatures_hash_idx").on(table.signatureHash),
    index("problem_signatures_code_idx").on(table.errorCode),
    index("problem_signatures_problem_idx").on(table.problemId),
  ],
);

export const symptoms = sqliteTable(
  "symptoms",
  {
    id: text("id").primaryKey(),
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (table) => [index("symptoms_problem_idx").on(table.problemId)],
);

/**
 * Playbook identity. Deliberately almost empty.
 *
 * It holds no title, no body and no content of any kind. Everything readable lives
 * on a revision. `currentRevisionId` is a pointer, and moving it is the only thing
 * "publishing an edit" does.
 */
export const playbooks = sqliteTable(
  "playbooks",
  {
    id: text("id").primaryKey(),
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    /** Nullable until first publication. A playbook with no published revision is
     *  not readable by the public. */
    currentRevisionId: text("current_revision_id"),
    /** See `PLAYBOOK_STATUSES`. */
    status: text("status").notNull().default("draft"),
    /** `public` | `unlisted`. There is no `private` in V1 — team playbooks are an
     *  explicit V2 item and adding the value early invites the feature. */
    visibility: text("visibility").notNull().default("public"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("playbooks_slug_unique").on(table.slug),
    index("playbooks_problem_idx").on(table.problemId),
    index("playbooks_status_idx").on(table.status),
  ],
);

/**
 * Immutable published snapshots.
 *
 * After `publishedAt` is set, every content-bearing column here and every row that
 * references this revision becomes frozen. That is enforced three ways, on purpose:
 *
 * 1. SQLite triggers in the migration, which reject the UPDATE at the database.
 * 2. The domain layer, which has no function that mutates a published revision.
 * 3. Tests that attempt the mutation and assert it fails.
 *
 * Any one of them alone would eventually be bypassed by a helpful refactor.
 *
 * `status` may still change — `published` → `needs_reverification` → `deprecated` is
 * lifecycle, not content, and the triggers allow exactly those columns to move.
 */
export const playbookRevisions = sqliteTable(
  "playbook_revisions",
  {
    id: text("id").primaryKey(),
    playbookId: text("playbook_id")
      .notNull()
      .references(() => playbooks.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    /** What changed since the previous revision, in the author's words. Shown in
     *  history so a reader can judge whether prior evidence is still relevant —
     *  which is a human decision, never an automatic transfer. */
    changeSummary: text("change_summary"),
    status: text("status").notNull().default("draft"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    publishedAt: integer("published_at"),
    supersedesRevisionId: text("supersedes_revision_id"),
    /** Set when a later revision supersedes this one. The revision stays readable
     *  at its stable URL; plan §9 requires historical URLs to survive, and a 404
     *  would destroy the evidence trail that justified the change. */
    supersededAt: integer("superseded_at"),
    deprecatedAt: integer("deprecated_at"),
    deprecationReason: text("deprecation_reason"),
    /** Set by the staleness rules in plan §15. Deterministic triggers only — AI may
     *  flag, never decide (R-11). */
    needsReverificationAt: integer("needs_reverification_at"),
    needsReverificationReason: text("needs_reverification_reason"),
  },
  (table) => [
    uniqueIndex("playbook_revisions_number_unique").on(table.playbookId, table.revisionNumber),
    index("playbook_revisions_playbook_idx").on(table.playbookId),
    index("playbook_revisions_status_idx").on(table.status),
    index("playbook_revisions_published_idx").on(table.publishedAt),
  ],
);

/**
 * Diagnostic nodes, scoped to a revision.
 *
 * `safetyLevel` is `notNull` with no default for a reason: a command whose danger
 * nobody classified would render without a warning, and the failure mode of a
 * missing classification is a reader pasting a destructive command believing it was
 * reviewed. The publish gate rejects a node with a command and no classification.
 */
export const diagnosticNodes = sqliteTable(
  "diagnostic_nodes",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => playbookRevisions.id, { onDelete: "cascade" }),
    /** See `NODE_TYPES`. */
    nodeType: text("node_type").notNull(),
    title: text("title").notNull(),
    /** Markdown subset. Rendered through the sanitiser in @devyou/security; never
     *  as raw HTML. */
    body: text("body").notNull().default(""),
    commandText: text("command_text"),
    commandLanguage: text("command_language"),
    expectedOutput: text("expected_output"),
    /** See `SAFETY_LEVELS`. */
    safetyLevel: text("safety_level").notNull().default("informational"),
    /** What the command actually changes, in plain words. Required for anything
     *  above `informational` — plan §14 asks the UI to "explain effect", and an
     *  explanation nobody wrote cannot be shown. */
    safetyEffect: text("safety_effect"),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (table) => [
    index("diagnostic_nodes_revision_idx").on(table.revisionId),
    index("diagnostic_nodes_type_idx").on(table.revisionId, table.nodeType),
  ],
);

/**
 * Edges, also revision-scoped.
 *
 * Both endpoints must belong to the **same** revision. A cross-revision edge would
 * let a session traverse from text that was tested into text that was not, which is
 * the same defect as transferring evidence. The engine checks it, the graph
 * validator checks it, and a test asserts it.
 */
export const diagnosticEdges = sqliteTable(
  "diagnostic_edges",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => playbookRevisions.id, { onDelete: "cascade" }),
    fromNodeId: text("from_node_id")
      .notNull()
      .references(() => diagnosticNodes.id, { onDelete: "cascade" }),
    toNodeId: text("to_node_id")
      .notNull()
      .references(() => diagnosticNodes.id, { onDelete: "cascade" }),
    /** See `BRANCH_CONDITIONS`. */
    conditionType: text("condition_type").notNull(),
    /** Author's wording for the branch, e.g. "connection refused". Falls back to
     *  the condition's generic label. */
    conditionLabel: text("condition_label"),
    priority: integer("priority").notNull().default(0),
  },
  (table) => [
    index("diagnostic_edges_revision_idx").on(table.revisionId),
    index("diagnostic_edges_from_idx").on(table.fromNodeId),
    uniqueIndex("diagnostic_edges_unique").on(table.fromNodeId, table.conditionType, table.toNodeId),
  ],
);

/**
 * What environments a revision claims to apply to.
 *
 * Ranges are stored as normalised, sortable strings so SQLite can compare them
 * without a user-defined function. `null` on either bound means unbounded.
 *
 * Plan §5 is explicit that V1 does not try to normalise every possible environment
 * variable, so this covers technology, version range, OS and architecture and stops
 * there. A constraint nobody can express accurately is worse than no constraint.
 */
export const revisionEnvironmentConstraints = sqliteTable(
  "revision_environment_constraints",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => playbookRevisions.id, { onDelete: "cascade" }),
    technologyId: text("technology_id")
      .notNull()
      .references(() => technologies.id, { onDelete: "restrict" }),
    minVersionId: text("min_version_id").references(() => versions.id, { onDelete: "set null" }),
    maxVersionId: text("max_version_id").references(() => versions.id, { onDelete: "set null" }),
    minSemver: text("min_semver"),
    maxSemver: text("max_semver"),
    /** Whether the max bound is inclusive. `<=2.4.0` and `<2.4.0` are different
     *  claims and conflating them mis-matches a whole minor line. */
    maxInclusive: integer("max_inclusive", { mode: "boolean" }).notNull().default(false),
    architecture: text("architecture"),
    /** `required` — the playbook only applies here; `known_affected` — observed
     *  here; `known_unaffected` — explicitly does not apply. The third is why this
     *  is not a simple list: "not on Windows" is knowledge worth recording. */
    constraintKind: text("constraint_kind").notNull().default("required"),
  },
  (table) => [
    index("revision_env_constraints_revision_idx").on(table.revisionId),
    index("revision_env_constraints_tech_idx").on(table.technologyId),
  ],
);

/**
 * External sources.
 *
 * `retrievedAt` matters more than it looks: an official documentation page that
 * supported a claim in March may say something different now, and evidence of type
 * `official_reference` is only as good as the date it was read.
 */
export const sourceReferences = sqliteTable(
  "source_references",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    /** See `SOURCE_TYPES`. */
    sourceType: text("source_type").notNull(),
    publisher: text("publisher"),
    retrievedAt: integer("retrieved_at").notNull(),
    /** Set by the URL safety checks in @devyou/security. A flagged link still
     *  renders, with a warning — silently dropping it would hide the reason. */
    safetyFlag: text("safety_flag"),
  },
  (table) => [
    index("source_references_url_idx").on(table.url),
    index("source_references_type_idx").on(table.sourceType),
  ],
);

export const revisionSourceReferences = sqliteTable(
  "revision_source_references",
  {
    revisionId: text("revision_id")
      .notNull()
      .references(() => playbookRevisions.id, { onDelete: "cascade" }),
    sourceReferenceId: text("source_reference_id")
      .notNull()
      .references(() => sourceReferences.id, { onDelete: "cascade" }),
    nodeId: text("node_id").references(() => diagnosticNodes.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("revision_source_refs_unique").on(
      table.revisionId,
      table.sourceReferenceId,
      table.nodeId,
    ),
  ],
);

/** Which technologies a revision is about. Drives `/t/:slug` pages and ranking. */
export const revisionTechnologies = sqliteTable(
  "revision_technologies",
  {
    revisionId: text("revision_id")
      .notNull()
      .references(() => playbookRevisions.id, { onDelete: "cascade" }),
    technologyId: text("technology_id")
      .notNull()
      .references(() => technologies.id, { onDelete: "cascade" }),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    uniqueIndex("revision_technologies_unique").on(table.revisionId, table.technologyId),
    index("revision_technologies_tech_idx").on(table.technologyId),
  ],
);

/**
 * Relationships between playbooks: duplicates, supersession, related work.
 *
 * A duplicate is *linked*, never merged away silently. R-42 and the adoption
 * research both point at duplicate-closing as the specific behaviour that made
 * Stack Overflow hostile, and the loss is real — the "duplicate" often covers a
 * different environment.
 */
export const playbookRelations = sqliteTable(
  "playbook_relations",
  {
    id: text("id").primaryKey(),
    fromPlaybookId: text("from_playbook_id")
      .notNull()
      .references(() => playbooks.id, { onDelete: "cascade" }),
    toPlaybookId: text("to_playbook_id")
      .notNull()
      .references(() => playbooks.id, { onDelete: "cascade" }),
    /** `duplicate_of` | `related` | `supersedes` | `prerequisite`. */
    relationType: text("relation_type").notNull(),
    /** `ai_suggested` | `human_confirmed`. AI may propose; only a human confirms.
     *  An AI-suggested relation is not shown to readers until confirmed. */
    confirmationState: text("confirmation_state").notNull().default("ai_suggested"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("playbook_relations_unique").on(
      table.fromPlaybookId,
      table.toPlaybookId,
      table.relationType,
    ),
    index("playbook_relations_to_idx").on(table.toPlaybookId),
  ],
);

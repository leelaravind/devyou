import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./identity.js";
import { diagnosticNodes, playbookRevisions, playbooks } from "./knowledge.js";

/**
 * Contribution: the private, mutable side of the system.
 *
 * Everything here is a *proposal*. Nothing in this file is public, nothing is
 * evidence, and nothing here can change a confidence band. Publication is the
 * boundary: it takes a draft and produces an immutable revision, and it is the only
 * path across.
 */

/**
 * A draft. Mutable, private, resumable.
 *
 * `rawText` is what the contributor pasted — terminal history, a stack trace, rough
 * notes. It is kept because R-32's whole premise is "paste rough notes and AI
 * structures them", and if the structuring is wrong the author needs to see what
 * they actually wrote, not the model's reading of it.
 *
 * It is also the most dangerous column in the database: it is untrusted text that
 * will be fed to an LLM. It is never rendered as HTML and never concatenated into a
 * prompt without the content boundary from @devyou/ai.
 */
export const contributionDrafts = sqliteTable(
  "contribution_drafts",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Set when this draft revises an existing playbook rather than creating one. */
    playbookId: text("playbook_id").references(() => playbooks.id, { onDelete: "set null" }),
    basedOnRevisionId: text("based_on_revision_id").references(() => playbookRevisions.id, {
      onDelete: "set null",
    }),
    rawText: text("raw_text").notNull().default(""),
    /** The AI's structured proposal, as validated JSON. Never trusted as-is: every
     *  field carries provenance and the inferred ones need confirmation. */
    structuredJson: text("structured_json"),
    /** `capturing` | `structuring` | `awaiting_review` | `editing` | `ready` |
     *  `published` | `abandoned`. */
    status: text("status").notNull().default("capturing"),
    /** Which AI task produced `structuredJson`, for provenance and for cost
     *  attribution. */
    aiTaskId: text("ai_task_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    publishedRevisionId: text("published_revision_id").references(() => playbookRevisions.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("contribution_drafts_author_idx").on(table.authorId),
    index("contribution_drafts_status_idx").on(table.status),
  ],
);

/**
 * Per-field provenance and confirmation.
 *
 * Plan §10 step C requires every field to carry where it came from, and step D
 * requires the author to explicitly confirm anything the model *inferred* rather
 * than extracted. The publish gate reads this table: a draft with an unconfirmed
 * `ai_inferred_requires_confirmation` row cannot publish.
 *
 * That is the mechanism behind "AI cannot silently invent required facts". Without
 * it the rule is a sentence in a document.
 */
export const draftFieldProvenance = sqliteTable(
  "draft_field_provenance",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id")
      .notNull()
      .references(() => contributionDrafts.id, { onDelete: "cascade" }),
    /** JSON pointer into `structuredJson`, e.g. `/nodes/2/expectedOutput`. */
    fieldPath: text("field_path").notNull(),
    /** See `PROVENANCE`. */
    provenance: text("provenance").notNull(),
    confirmedAt: integer("confirmed_at"),
    confirmedBy: text("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    /** What the model originally proposed, kept even after the author corrects it.
     *  It is the record of what the AI got wrong, which is the only way to tell
     *  whether the structuring is improving. */
    originalValue: text("original_value"),
  },
  (table) => [
    uniqueIndex("draft_field_provenance_unique").on(table.draftId, table.fieldPath),
    index("draft_field_provenance_draft_idx").on(table.draftId),
  ],
);

/**
 * Micro-contributions against a published revision.
 *
 * R-40: disagreement is funnelled into proposing a branch or a test, not into a
 * comment thread. This table is where that funnel lands. There is no comments
 * table anywhere in this schema, and that is deliberate.
 */
export const changeProposals = sqliteTable(
  "change_proposals",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => playbookRevisions.id, { onDelete: "cascade" }),
    nodeId: text("node_id").references(() => diagnosticNodes.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    /** `missing_test` | `correction` | `additional_branch` | `stale_report` |
     *  `safety_report` | `environment_gap`. */
    proposalType: text("proposal_type").notNull(),
    body: text("body").notNull(),
    /** Optional structured payload — a proposed node, a proposed edge. */
    payloadJson: text("payload_json"),
    /** `open` | `accepted` | `declined` | `merged`. A declined proposal keeps its
     *  reason and stays visible to its author; silently discarding contributions is
     *  the behaviour the adoption research names as fatal. */
    status: text("status").notNull().default("open"),
    resolutionReason: text("resolution_reason"),
    resolvedBy: text("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: integer("resolved_at"),
    /** Set when accepting this produced a new revision. */
    resultingRevisionId: text("resulting_revision_id").references(() => playbookRevisions.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("change_proposals_revision_idx").on(table.revisionId),
    index("change_proposals_status_idx").on(table.status),
    index("change_proposals_author_idx").on(table.authorId),
  ],
);

/**
 * Diagnostic session state.
 *
 * Session state, never knowledge. Plan §8: a session stores where a reader is and
 * what they observed; it does not mutate the playbook, and reaching a root cause
 * creates no evidence. Only an explicit submitted report does that.
 *
 * `actorId` is nullable because an anonymous reader must be able to run a full
 * diagnostic session — plan §0.7. Anonymous sessions are keyed by an opaque token
 * in a short-lived cookie and expire.
 */
export const diagnosticSessions = sqliteTable(
  "diagnostic_sessions",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => playbookRevisions.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id, { onDelete: "cascade" }),
    environmentSnapshotId: text("environment_snapshot_id"),
    activeNodeId: text("active_node_id").references(() => diagnosticNodes.id, {
      onDelete: "set null",
    }),
    /** Terminal state, when reached. Recording it is what lets the product measure
     *  "resolution rate" and "attempts before resolution" — plan §17 — without
     *  tracking readers around the site. */
    outcomeNodeId: text("outcome_node_id").references(() => diagnosticNodes.id, {
      onDelete: "set null",
    }),
    startedAt: integer("started_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at"),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("diagnostic_sessions_actor_idx").on(table.actorId),
    index("diagnostic_sessions_revision_idx").on(table.revisionId),
    index("diagnostic_sessions_expiry_idx").on(table.expiresAt),
  ],
);

/**
 * What happened at each node in a session.
 *
 * `invalidatedAt` rather than DELETE. Backtracking invalidates every downstream
 * outcome (plan §8), and keeping the invalidated steps is what makes "you changed
 * your answer at step 2, so steps 3-5 no longer apply" explainable rather than
 * mysterious.
 */
export const diagnosticSessionSteps = sqliteTable(
  "diagnostic_session_steps",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => diagnosticSessions.id, { onDelete: "cascade" }),
    nodeId: text("node_id")
      .notNull()
      .references(() => diagnosticNodes.id, { onDelete: "cascade" }),
    /** See `BRANCH_CONDITIONS`. */
    observedCondition: text("observed_condition"),
    stepIndex: integer("step_index").notNull(),
    observedAt: integer("observed_at").notNull(),
    invalidatedAt: integer("invalidated_at"),
  },
  (table) => [
    index("diagnostic_session_steps_session_idx").on(table.sessionId, table.stepIndex),
  ],
);

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./identity.js";
import { playbookRevisions, playbooks } from "./knowledge.js";
import { evidenceRecords, reproductionReports } from "./evidence.js";

/**
 * Moderation, identity claims, audit and telemetry.
 */

export const moderationCases = sqliteTable(
  "moderation_cases",
  {
    id: text("id").primaryKey(),
    /** `playbook` | `revision` | `evidence` | `reproduction` | `draft` | `user`. */
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    /** `dangerous_command` | `malicious_package` | `spam` | `plagiarism` |
     *  `hidden_unicode` | `suspicious_link` | `fake_reproduction` |
     *  `prompt_injection` | `other`. */
    reason: text("reason").notNull(),
    /** `reporter` | `automated_rule` | `ai_assist`. AI can open a case and can
     *  never close one — plan §11 forbids AI deleting content or suspending
     *  accounts, and a case it could resolve itself would be exactly that. */
    origin: text("origin").notNull(),
    reporterId: text("reporter_id").references(() => users.id, { onDelete: "set null" }),
    detail: text("detail"),
    severity: text("severity").notNull().default("normal"),
    /** `open` | `investigating` | `actioned` | `dismissed`. */
    status: text("status").notNull().default("open"),
    /** Required to close a case. A resolution with no reason is unauditable, and
     *  the admin action layer rejects one. */
    resolutionReason: text("resolution_reason"),
    resolvedBy: text("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: integer("resolved_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("moderation_cases_status_idx").on(table.status, table.severity),
    index("moderation_cases_subject_idx").on(table.subjectType, table.subjectId),
  ],
);

/**
 * Maintainer and vendor identity claims.
 *
 * A claim, not a role. Research is explicit that loosely verified "official" status
 * is worse than none — it reads as pay-to-play the moment anybody doubts it. So a
 * granted claim confers exactly one thing: the ability to file
 * `maintainer_attestation` evidence, which is one signal among several and never
 * outranks reproduction. It grants no moderation power at all.
 */
export const officialIdentityClaims = sqliteTable(
  "official_identity_claims",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    technologyId: text("technology_id").notNull(),
    /** `maintainer` | `vendor_engineer` | `documentation_owner`. */
    claimType: text("claim_type").notNull(),
    /** How it was proven: a DNS TXT record, a commit signed with a known key, a
     *  post on the project's own domain. Free text, reviewed by a human. */
    evidenceUrl: text("evidence_url"),
    evidenceDetail: text("evidence_detail"),
    /** `pending` | `granted` | `refused` | `revoked`. */
    status: text("status").notNull().default("pending"),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: integer("reviewed_at"),
    reviewReason: text("review_reason"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("official_identity_claims_unique").on(
      table.userId,
      table.technologyId,
      table.claimType,
    ),
    index("official_identity_claims_status_idx").on(table.status),
  ],
);

/**
 * Privileged-operation record. Append-only, enforced by trigger.
 *
 * Every destructive admin action writes one, with a reason code. The admin action
 * layer will not perform an action that has no audit row, which is a stronger
 * guarantee than "remember to log it".
 */
export const adminAuditEvents = sqliteTable(
  "admin_audit_events",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** `resource:action`, matching the capability statement map exactly. */
    capability: text("capability").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    /** Required, and validated against a fixed set. A free-text reason nobody
     *  constrains becomes "fixing" on every row. */
    reasonCode: text("reason_code").notNull(),
    reasonDetail: text("reason_detail"),
    /** Before/after for the changed fields only. Never the whole row — an audit log
     *  that copies content becomes a second, unmanaged store of it. */
    changeJson: text("change_json"),
    stepUpVerified: integer("step_up_verified", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("admin_audit_events_actor_idx").on(table.actorId),
    index("admin_audit_events_subject_idx").on(table.subjectType, table.subjectId),
    index("admin_audit_events_created_idx").on(table.createdAt),
  ],
);

/**
 * Search telemetry, privacy-minimised.
 *
 * Plan §17 forbids collecting raw stack traces and logs into general analytics, and
 * a search box that accepts a stack trace is precisely where that would happen by
 * accident. So the raw query is **not stored**. What is stored is the normalised
 * fingerprint, the shape of the query, and whether it found anything — which is
 * everything the zero-result and reformulation metrics need.
 *
 * Retention is defined before launch (plan §5) and enforced by a scheduled job.
 */
export const searchEvents = sqliteTable(
  "search_events",
  {
    id: text("id").primaryKey(),
    /** The normalised error fingerprint, if the query contained one. Not the query. */
    signatureHash: text("signature_hash"),
    /** `exact_error` | `stack_trace` | `log` | `natural_language` | `mixed`. */
    queryShape: text("query_shape").notNull(),
    queryTokenCount: integer("query_token_count").notNull().default(0),
    resultCount: integer("result_count").notNull().default(0),
    /** Rank of the result the searcher opened, if any. The single most useful
     *  relevance signal available without storing queries. */
    clickedRank: integer("clicked_rank"),
    hadEnvironmentFilter: integer("had_environment_filter", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Opaque, rotating, per-day. Enough to detect a reformulation within one
     *  session; not enough to follow anybody across days. */
    sessionBucket: text("session_bucket"),
    latencyMs: integer("latency_ms"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("search_events_created_idx").on(table.createdAt),
    index("search_events_zero_idx").on(table.resultCount),
    index("search_events_signature_idx").on(table.signatureHash),
  ],
);

/**
 * AI task ledger.
 *
 * Plan §11 requires model, provider, prompt version, cost, latency and result to be
 * stored for every AI call. This is also the cost-control surface: the daily spend
 * ceiling is enforced by summing this table before dispatching.
 *
 * `inputHash` is the cache key. Plan §11 asks for caching by normalised input, and
 * on a corpus where the same stack trace is pasted repeatedly it is the difference
 * between a bill and a rounding error.
 */
export const aiTasks = sqliteTable(
  "ai_tasks",
  {
    id: text("id").primaryKey(),
    /** `structure_contribution` | `duplicate_candidates` | `classify_technology` |
     *  `summarise` | `interpret_query` | `moderation_assist` | `staleness_compare`. */
    taskType: text("task_type").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputHash: text("input_hash").notNull(),
    /** `queued` | `running` | `succeeded` | `schema_invalid` | `failed` |
     *  `refused` | `budget_exceeded`. `schema_invalid` is separate from `failed`
     *  because it means the model answered and the answer did not validate, which
     *  is a prompt problem rather than an outage. */
    status: text("status").notNull().default("queued"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costMicroUsd: integer("cost_micro_usd"),
    latencyMs: integer("latency_ms"),
    /** Set when a repair attempt was made. Plan §11 allows at most one. */
    repairAttempted: integer("repair_attempted", { mode: "boolean" }).notNull().default(false),
    errorDetail: text("error_detail"),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [
    index("ai_tasks_type_idx").on(table.taskType, table.status),
    index("ai_tasks_cache_idx").on(table.taskType, table.inputHash),
    index("ai_tasks_created_idx").on(table.createdAt),
    index("ai_tasks_requester_idx").on(table.requestedBy),
  ],
);

/**
 * Feature flags and runtime configuration.
 *
 * In D1 rather than KV because a flag change is an audited administrative action
 * and needs a row somebody can point at. The read path caches it in KV.
 */
export const featureFlags = sqliteTable(
  "feature_flags",
  {
    key: text("key").primaryKey(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    description: text("description").notNull(),
    valueJson: text("value_json"),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: integer("updated_at").notNull(),
  },
);

/**
 * Rate limiting, per actor or per IP hash.
 *
 * A counter table rather than a Durable Object: the limits that matter here are
 * per-day contribution and reproduction ceilings, which are cheap to check against
 * D1 once per write. Per-second edge limiting is Cloudflare's job, not this table's.
 */
export const rateCounters = sqliteTable(
  "rate_counters",
  {
    id: text("id").primaryKey(),
    /** `user:<id>` or `ip:<hash>`. */
    subject: text("subject").notNull(),
    action: text("action").notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("rate_counters_unique").on(table.subject, table.action, table.windowStart),
    index("rate_counters_window_idx").on(table.windowStart),
  ],
);

/** Links a moderation case to the exact evidence it concerns, without duplicating it. */
export const moderationCaseEvidence = sqliteTable(
  "moderation_case_evidence",
  {
    caseId: text("case_id")
      .notNull()
      .references(() => moderationCases.id, { onDelete: "cascade" }),
    evidenceRecordId: text("evidence_record_id").references(() => evidenceRecords.id, {
      onDelete: "restrict",
    }),
    reproductionReportId: text("reproduction_report_id").references(() => reproductionReports.id, {
      onDelete: "restrict",
    }),
    playbookId: text("playbook_id").references(() => playbooks.id, { onDelete: "cascade" }),
    revisionId: text("revision_id").references(() => playbookRevisions.id, { onDelete: "cascade" }),
  },
  (table) => [index("moderation_case_evidence_case_idx").on(table.caseId)],
);

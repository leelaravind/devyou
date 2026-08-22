/**
 * The DevYou schema.
 *
 * Grouped by what the tables are for rather than by table count:
 *
 *   identity      who is acting, and how much their evidence weighs
 *   taxonomy      technologies, aliases and versions — what makes "version-aware" real
 *   knowledge     problems, playbooks and immutable revisions with their graphs
 *   evidence      append-only reproduction and evidence records, plus derived confidence
 *   contribution  drafts, proposals and diagnostic session state — all private, all mutable
 *   governance    moderation, identity claims, audit, telemetry, flags, rate limits
 *
 * One thing is absent from every file and its absence is the design: there is no
 * `verified` column. Confidence is derived from `evidence_records` at read time and
 * cached in `revision_confidence`, which can be regenerated from scratch. A lint
 * rule blocks the identifier in this package.
 */
export * from "./identity.js";
export * from "./taxonomy.js";
export * from "./knowledge.js";
export * from "./evidence.js";
export * from "./contribution.js";
export * from "./governance.js";

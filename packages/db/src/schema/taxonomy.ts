import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * The technology vocabulary.
 *
 * This is what makes "version-aware" mean anything. A playbook that says it applies
 * to "Node" is a playbook that applies to nothing in particular; one that says
 * `node >=20.0.0 <22.0.0` can be matched against a reader's actual environment and
 * can be marked stale when 22 ships.
 */
export const technologies = sqliteTable(
  "technologies",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** See `TECHNOLOGY_TYPES` in @devyou/core. */
    type: text("type").notNull(),
    officialUrl: text("official_url"),
    /** `active` | `deprecated` | `merged`. Merged technologies keep their row so
     *  historical revisions still resolve; `mergedIntoId` points at the survivor. */
    status: text("status").notNull().default("active"),
    mergedIntoId: text("merged_into_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("technologies_slug_unique").on(table.slug),
    index("technologies_type_idx").on(table.type),
  ],
);

/**
 * Aliases: how a technology actually appears in an error message.
 *
 * The search path depends on this far more than the display path does. Nobody
 * pastes "PostgreSQL"; they paste `psql: FATAL:`, `pg_stat_activity`, `SQLSTATE
 * 40001`. Each of those is an alias, and without them the exact-error route cannot
 * narrow by technology at all.
 */
export const technologyAliases = sqliteTable(
  "technology_aliases",
  {
    id: text("id").primaryKey(),
    technologyId: text("technology_id")
      .notNull()
      .references(() => technologies.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    /** `name` | `package` | `binary` | `error_token` | `import_path`. Kinds are
     *  weighted differently in ranking: an `error_token` match is a much stronger
     *  signal than a `name` match, because nobody types an error token by accident. */
    kind: text("kind").notNull().default("name"),
  },
  (table) => [
    uniqueIndex("technology_aliases_unique").on(table.alias, table.technologyId),
    index("technology_aliases_alias_idx").on(table.alias),
  ],
);

/**
 * Versions.
 *
 * `semverNormalized` is a zero-padded, sortable rendering (`00020.00011.00001`) so
 * range comparison is a plain string comparison in SQLite, which has no semver
 * support and no user-defined functions on D1. Storing the raw label alongside it
 * matters because plenty of real versions are not semver — `24.04`, `2024-11-01`,
 * `v1.2.3-alpine` — and the label is what a reader recognises.
 */
export const versions = sqliteTable(
  "versions",
  {
    id: text("id").primaryKey(),
    technologyId: text("technology_id")
      .notNull()
      .references(() => technologies.id, { onDelete: "cascade" }),
    versionLabel: text("version_label").notNull(),
    semverNormalized: text("semver_normalized"),
    releasedAt: integer("released_at"),
    eolAt: integer("eol_at"),
    /** `active` | `eol` | `yanked`. */
    status: text("status").notNull().default("active"),
    /** True for a major or minor release. R-8 and plan §15: a new minor is a
     *  deterministic trigger for re-verification of anything constrained to a range
     *  that no longer covers it. */
    isMinorOrMajor: integer("is_minor_or_major", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    uniqueIndex("versions_unique").on(table.technologyId, table.versionLabel),
    index("versions_sort_idx").on(table.technologyId, table.semverNormalized),
    index("versions_released_idx").on(table.releasedAt),
  ],
);

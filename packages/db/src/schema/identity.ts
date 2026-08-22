import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Identity, product-local.
 *
 * DevYou has its own accounts. ADR-0001: ATSYou's `users` table is not, and will
 * not become, an identity source here — the products share a Cloudflare account and
 * a set of conventions, never an authorisation boundary.
 *
 * `network_actor_id` is a nullable forward hook for the day a network identity
 * contract exists. It is deliberately just a string with no foreign key: a foreign
 * key to another product's table is the coupling this whole design avoids.
 */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    createdAt: integer("created_at").notNull(),
    /** `active` | `suspended` | `deleted`. Suspension is reversible; deletion
     *  anonymises the row and keeps the evidence, because removing a reproduction
     *  would silently change a playbook's confidence for everybody else. */
    status: text("status").notNull().default("active"),
    email: text("email"),
    emailVerifiedAt: integer("email_verified_at"),
    networkActorId: text("network_actor_id"),
    /**
     * Capability role, server-side only.
     *
     * `user` | `contributor` | `reviewer` | `support_admin` | `dev_admin`.
     *
     * Note what this is not: a reputation tier. The adoption research is explicit
     * that a status hierarchy is what drove contributors off Stack Overflow, so a
     * role here grants a capability and confers no standing. `maintainer_verified`
     * is a *claim* recorded in `official_identity_claims`, not a role, precisely so
     * it cannot accumulate power.
     */
    role: text("role").notNull().default("user"),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    index("users_status_idx").on(table.status),
  ],
);

export const profiles = sqliteTable(
  "profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    handle: text("handle").notNull(),
    avatarUrl: text("avatar_url"),
    githubLogin: text("github_login"),
    /** Short by design. A profile here is an attribution record, not a homepage. */
    bio: text("bio"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("profiles_handle_unique").on(table.handle),
    index("profiles_github_idx").on(table.githubLogin),
  ],
);

/**
 * Sessions.
 *
 * Reading and searching never touch this table — plan §0.7 makes public read
 * frictionless, and an anonymous reader must not be issued a session cookie merely
 * for arriving.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the token. The token itself is never stored — a stolen database
     *  should not be a stolen set of live sessions. */
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    /** Coarse only. Enough to show "signed in from Firefox on Linux" and to spot a
     *  session that moved continent; not enough to build a movement history. */
    userAgentFamily: text("user_agent_family"),
    ipHash: text("ip_hash"),
    revokedAt: integer("revoked_at"),
  },
  (table) => [
    uniqueIndex("sessions_token_unique").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
    index("sessions_expiry_idx").on(table.expiresAt),
  ],
);

/**
 * Trust signals used to weight evidence, kept apart from the user row.
 *
 * R-9: reproduction evidence is weighted by the reproducer's independence — account
 * age, network diversity, environment diversity. This lives in its own table
 * because it is derived, recomputed by a job, and must never be mistaken for
 * something a user earned. It has no display surface.
 */
export const actorTrust = sqliteTable(
  "actor_trust",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    accountAgeDays: integer("account_age_days").notNull().default(0),
    distinctEnvironments: integer("distinct_environments").notNull().default(0),
    reproductionCount: integer("reproduction_count").notNull().default(0),
    /** Set when clustering suggests coordinated reporting. Suppresses the actor's
     *  evidence from confidence derivation without deleting it — the records stay
     *  visible to admin, because deleting the evidence would destroy the proof that
     *  justified suppressing it. */
    suspectedCluster: text("suspected_cluster"),
    weight: integer("weight").notNull().default(100),
    computedAt: integer("computed_at").notNull().default(sql`(unixepoch())`),
  },
  (table) => [index("actor_trust_cluster_idx").on(table.suspectedCluster)],
);

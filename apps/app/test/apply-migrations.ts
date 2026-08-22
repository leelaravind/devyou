import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

/**
 * Apply the real migrations to each isolated test database before any test runs.
 *
 * `TEST_MIGRATIONS` is read from `packages/db/migrations` by the vitest config, so
 * the schema under test is the same SQL that runs against staging and production —
 * `0001_invariant_enforcement.sql` included. That is the point: a test asserting
 * that a published revision cannot be mutated has to run against the trigger that
 * stops it, not against a table shape that merely looks the same.
 *
 * The binding exists only in tests, so it is declared on the ambient `Cloudflare.Env`
 * rather than added to the Worker's real binding surface — augmenting `ProvidedEnv`
 * instead leaves `env` typed as the plain `Env` and the property unknown.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

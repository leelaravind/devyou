import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

/**
 * Apply the real migrations to each isolated test database before any test runs.
 *
 * `TEST_MIGRATIONS` is read from `packages/db/migrations` by the vitest config, so the
 * schema under test is the same SQL that runs against staging and production —
 * `0001_invariant_enforcement.sql` included. That matters more here than it does for the
 * public Worker: the admin surface is where somebody would try to edit a published
 * revision or delete an audit row, and a test asserting they cannot has to run against the
 * trigger that stops them rather than against a table shape that merely looks the same.
 *
 * The binding exists only in tests, so it is declared on the ambient `Cloudflare.Env`
 * rather than added to the Worker's real binding surface.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

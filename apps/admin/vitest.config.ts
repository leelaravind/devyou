import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Two projects, because this Worker carries two kinds of risk.
 *
 * **workerd** — the perimeter, exercised inside the real runtime. The Access gate is a
 * signature verification, so it can only be tested honestly by generating a key pair,
 * signing a token and presenting it, which needs WebCrypto's RSA implementation rather
 * than a stub. The capability and audit tests run against the real D1 schema and the real
 * migrations, invariant triggers included: a test asserting that the audit log is
 * append-only has to run against the trigger that enforces it.
 *
 * **guards** — source-level assertions needing `node:fs`. These cover the risk of a route
 * that *stops* doing something. Dropping a `requireAdmin` call during a refactor, or
 * writing to D1 outside `performAdminAction`, leaves every existing test passing because
 * none of them exercises the route that changed. Reading the sources is the only way to
 * assert something about every route, including the ones nobody remembered.
 *
 * `CF_ACCESS_AUD` is deliberately absent from the bindings below. The default state
 * under test is "Access is not configured", which is the state the Worker will genuinely
 * first be deployed in — see owner action A0-1. A test that wants a configured perimeter
 * supplies the AUD itself, which keeps the fail-closed path as the one that is exercised
 * by default rather than the one somebody remembers to check.
 */
const migrations = await readD1Migrations(
  path.resolve(import.meta.dirname, "../../packages/db/migrations"),
);

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            miniflare: {
              /*
                Behind the deployed Worker's date, and deliberately so — the same pin the
                public Worker's config carries. Miniflare bundles its own workerd build,
                and asking that build for a compatibility date it does not know about fails
                at startup with `ERR_RUNTIME_FAILURE` and no indication of which setting
                caused it.
              */
              compatibilityDate: "2026-08-11",
              compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
              d1Databases: ["DB"],
              kvNamespaces: ["CACHE"],
              r2Buckets: ["EVIDENCE"],
              bindings: {
                TEST_MIGRATIONS: migrations,
                ENVIRONMENT: "staging",
                ADMIN_APP_URL: "https://dev-admin-staging.itisyou.app",
                PUBLIC_APP_URL: "https://dev-staging.itisyou.app",
                CF_ACCESS_TEAM_DOMAIN: "https://itisyou-network.cloudflareaccess.com",
              },
            },
          }),
        ],
        test: {
          name: "workerd",
          include: ["test/**/*.{test,spec}.ts"],
          exclude: ["test/**/*.node.test.ts"],
          setupFiles: ["./test/apply-migrations.ts"],
          // The first test to import a server module pays for Vite to transform it inside
          // workerd, once per run. Raising this stops a cold start being reported as a
          // failure. RSA key generation in the Access tests is not free either.
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: "guards",
          include: ["test/**/*.node.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});

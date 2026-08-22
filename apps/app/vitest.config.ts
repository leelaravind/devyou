import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Two projects, because this Worker carries two kinds of risk.
 *
 * **workerd** — integration tests running inside the real runtime against the real
 * D1 schema and the real migrations, including the invariant triggers. A test that
 * passes here has exercised the same enforcement the deployed Worker gets, rather
 * than a mock that agrees with itself.
 *
 * **guards** — source-level assertions that need `node:fs`. These cover the risk of
 * a route that *stops* doing something: dropping a cache policy or a rate limit
 * during a refactor leaves every existing test passing, because none of them
 * exercises the route that was changed. Reading the sources is the only way to
 * assert something about every route, including the ones nobody remembered.
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
                Behind the deployed Worker's date, and deliberately so.

                `wrangler.jsonc` sets 2026-08-22. Miniflare bundles its own workerd
                build, and asking that build for a compatibility date it does not
                know about fails at startup with `ERR_RUNTIME_FAILURE` and no
                indication of which setting caused it. This is pinned to the newest
                date the bundled runtime supports, and should move up whenever
                miniflare does.
              */
              compatibilityDate: "2026-08-11",
              compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
              d1Databases: ["DB"],
              kvNamespaces: ["CACHE"],
              /*
                The producer side only. There is no consumer here on purpose: the
                jobs Worker is a separate deploy, and what this Worker must be
                tested for is that a structuring job is *dispatched and ledgered*,
                not what the model eventually says. Without the binding, every
                dispatch would take the failure path and the test would assert the
                wrong thing.
              */
              queueProducers: ["EVENTS"],
              bindings: {
                TEST_MIGRATIONS: migrations,
                ENVIRONMENT: "staging",
                PUBLIC_APP_URL: "https://dev-staging.itisyou.app",
                ADMIN_APP_URL: "https://dev-admin-staging.itisyou.app",
              },
            },
          }),
        ],
        test: {
          name: "workerd",
          include: ["test/**/*.{test,spec}.ts"],
          exclude: ["test/**/*.node.test.ts"],
          setupFiles: ["./test/apply-migrations.ts"],
          // The first test to import a server module pays for Vite to transform it
          // inside workerd, once per run. Raising this stops a cold start being
          // reported as a failure.
          testTimeout: 20_000,
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

import { defineConfig } from "drizzle-kit";

/**
 * Migration generation only. Applying is done by scripts/apply-migrations.mjs
 * through wrangler, because drizzle-kit cannot reach a remote D1 database and the
 * migration order matters (see the runner for why it is not `d1 migrations apply`).
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
});

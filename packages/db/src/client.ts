import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDb>;

/**
 * The Drizzle client over D1.
 *
 * One per request. D1 has no connection pool to reuse and a module-level client
 * would capture the wrong `env` across environments.
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema, casing: "snake_case" });
}

export { schema };

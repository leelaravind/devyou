import { z } from "zod";
import { CONTRACT_VERSION } from "./version.js";

/**
 * The health contract.
 *
 * Content-bearing, not a bare 200. The network baseline audit's own finding was that a
 * status surface which only proves a Worker is running tells you nothing on the day
 * that matters: the Worker is up, D1 is refusing writes, and the green tick is a lie.
 *
 * So every check names the dependency it exercised and reports what it found. A check
 * that could not run is `unknown` rather than `fail` — those are different operational
 * situations and collapsing them makes a misconfiguration look like an outage.
 */
export const healthCheckSchema = z.object({
  /** `d1`, `kv`, `r2`, `access`, `migrations` — the dependency, not the test. */
  name: z.string().min(1),
  status: z.enum(["pass", "fail", "unknown"]),
  /** Human-readable, and safe to display. Never an exception message: a stack trace
   *  rendered in somebody else's console is an information leak with extra steps. */
  detail: z.string().max(300).optional(),
  latencyMs: z.number().int().nonnegative().optional(),
});

export const healthReportSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  product: z.literal("devyou"),
  environment: z.enum(["staging", "production"]),
  /**
   * True only when every check passed.
   *
   * Derived from `checks`, never set independently. A summary field somebody can
   * write directly is a summary field that eventually disagrees with the detail
   * underneath it, and the summary is the part people read.
   */
  ok: z.boolean(),
  checkedAt: z.iso.datetime(),
  checks: z.array(healthCheckSchema),
});

export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type HealthReport = z.infer<typeof healthReportSchema>;

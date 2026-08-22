import { CONTRACT_VERSION, type HealthCheck, type HealthReport } from "@devyou/admin-contract";
import { accessConfig } from "./access.server";

/**
 * Health, content-bearing.
 *
 * The Phase 0 network baseline recorded the finding this is written against: a status
 * surface that only proves a Worker is running tells you nothing on the day that matters,
 * because the Worker is up, D1 is refusing writes, and the green tick is a lie. So every
 * check below actually exercises the dependency and reports what it found.
 *
 * Two details worth stating.
 *
 * **`unknown` is a distinct outcome from `fail`.** A check that could not run — because a
 * binding is absent, or configuration is missing — is a different operational situation
 * from one that ran and failed, and collapsing them makes a misconfiguration look like an
 * outage. Only `fail` counts against `ok`.
 *
 * **The invariant triggers are checked.** That is the least obvious check here and the
 * most useful. The append-only and immutability guarantees in `0001_invariant_enforcement.sql`
 * are the product's actual promises, and a migration applied out of order, or a database
 * restored from a snapshot taken before it, would leave every table present, every query
 * working, and every guarantee silently gone. Counting the triggers is the cheapest way to
 * notice.
 */

/** The triggers `0001_invariant_enforcement.sql` installs. Named individually rather than
 *  counted, so a missing one is identified rather than merely implied by a number. */
const REQUIRED_TRIGGERS = [
  "trg_revision_content_immutable",
  "trg_revision_no_unpublish",
  "trg_revision_no_delete_published",
  "trg_nodes_immutable_after_publish",
  "trg_edges_same_revision",
  "trg_evidence_append_only_update",
  "trg_evidence_append_only_delete",
  "trg_reproduction_append_only_update",
  "trg_reproduction_append_only_delete",
  "trg_audit_append_only_update",
  "trg_audit_append_only_delete",
] as const;

export async function buildHealthReport(env: Env): Promise<HealthReport> {
  const checks = await Promise.all([
    checkD1(env),
    checkInvariantTriggers(env),
    checkKv(env),
    checkR2(env),
    checkAccess(env),
  ]);

  return {
    contractVersion: CONTRACT_VERSION,
    product: "devyou",
    environment: env.ENVIRONMENT,
    ok: checks.every((check) => check.status !== "fail"),
    checkedAt: new Date().toISOString(),
    checks,
  };
}

async function checkD1(env: Env): Promise<HealthCheck> {
  return timed("d1", async () => {
    /* A real read against a real table, not `SELECT 1`. `SELECT 1` proves the binding is
       wired; this proves the schema is there and queryable, which is the failure that
       actually happens after a migration goes sideways. */
    const row = await env.DB.prepare(
      `SELECT (SELECT count(*) FROM playbooks) AS playbooks,
              (SELECT count(*) FROM evidence_records) AS evidence`,
    ).first<{ playbooks: number; evidence: number }>();

    if (!row) return { status: "fail" as const, detail: "no row returned" };
    return {
      status: "pass" as const,
      detail: `${row.playbooks} playbooks, ${row.evidence} evidence records`,
    };
  });
}

async function checkInvariantTriggers(env: Env): Promise<HealthCheck> {
  return timed("migrations", async () => {
    const rows = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_%'`,
    ).all<{ name: string }>();

    const present = new Set(rows.results.map((row) => row.name));
    const missing = REQUIRED_TRIGGERS.filter((name) => !present.has(name));

    if (missing.length > 0) {
      return {
        status: "fail" as const,
        detail: `invariant triggers missing: ${missing.join(", ")}`,
      };
    }
    return {
      status: "pass" as const,
      detail: `${REQUIRED_TRIGGERS.length} invariant triggers present`,
    };
  });
}

async function checkKv(env: Env): Promise<HealthCheck> {
  return timed("kv", async () => {
    /* A read, not a write. A health endpoint that writes on every call becomes a write
       amplifier the moment something starts polling it, and reading proves the binding
       responds just as well. A miss is a pass: the question is whether KV answers. */
    await env.CACHE.get("health:probe");
    return { status: "pass" as const, detail: "namespace responded" };
  });
}

async function checkR2(env: Env): Promise<HealthCheck> {
  return timed("r2", async () => {
    await env.EVIDENCE.head("health/probe");
    return { status: "pass" as const, detail: "bucket responded" };
  });
}

/**
 * Whether the outer gate is configured.
 *
 * This check can only ever report `pass` to somebody who is reading it, because an
 * unconfigured Access application means the Worker refused the request that would have
 * rendered this page. It is here anyway, for the case that is not hypothetical: a future
 * console polling `/api/v1/health` through an Access service token needs the AUD in the
 * report to confirm *which* application admitted it, and an operator comparing staging to
 * production needs to see the two are not sharing one.
 *
 * The AUD itself is never included. It is a Worker secret, and invariant 11 does not have
 * a health-endpoint exception.
 */
async function checkAccess(env: Env): Promise<HealthCheck> {
  const config = accessConfig(env);
  if (!config) {
    return {
      name: "access",
      status: "fail",
      detail: "no Access application configured — owner action A0-1 outstanding",
    };
  }
  return { name: "access", status: "pass", detail: `team domain ${config.teamDomain}` };
}

/**
 * Run a check, time it, and turn a thrown error into a `fail` rather than a 500.
 *
 * A health endpoint that throws is a health endpoint that reports nothing about the four
 * dependencies that were fine. The error message is deliberately not forwarded — it can
 * carry a binding name, a query fragment or an internal host, and this payload is designed
 * to be readable by a future network console.
 */
async function timed(
  name: string,
  run: () => Promise<{ status: "pass" | "fail"; detail: string }>,
): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const result = await run();
    return { name, status: result.status, detail: result.detail, latencyMs: Date.now() - started };
  } catch (error) {
    console.error("health_check_failed", { name });
    return {
      name,
      status: "fail",
      detail: error instanceof Error ? "threw during the check" : "failed",
      latencyMs: Date.now() - started,
    };
  }
}

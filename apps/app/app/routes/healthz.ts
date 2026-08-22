import type { Route } from "./+types/healthz";
import { cloudflareContext } from "../context/cloudflare";

/**
 * Health, with content — not just a 200.
 *
 * The network inventory records a real incident shape on this account: the root
 * site's `/healthz` returned HTTP 200 while serving a maintenance page, so a naive
 * uptime probe would have reported it healthy while it was down. Any probe worth
 * running has to check what came back.
 *
 * So this returns the checks it actually performed. A caller that only looks at the
 * status code still learns something true; a caller that reads the body learns
 * which dependency is failing.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  try {
    await env.DB.prepare("select 1 as ok").first();
    checks.push({ name: "d1", ok: true });
  } catch {
    // The error is deliberately not echoed: this endpoint is public, and a database
    // error string can name a table or a column.
    checks.push({ name: "d1", ok: false, detail: "unreachable" });
  }

  const ok = checks.every((check) => check.ok);

  return Response.json(
    { ok, environment: env.ENVIRONMENT, checks, ts: new Date().toISOString() },
    { status: ok ? 200 : 503 },
  );
}

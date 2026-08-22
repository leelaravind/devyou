import { healthReportSchema } from "@devyou/admin-contract";
import type { Route } from "./+types/api.v1.health";
import { requireAdmin } from "../lib/route.server";
import { json } from "../lib/http.server";
import { buildHealthReport } from "../lib/health.server";

/**
 * `GET /api/v1/health` — the contract health endpoint.
 *
 * Behind the same Cloudflare Access gate and the same capability check as every page. A
 * contract endpoint that skipped the perimeter "because a machine calls it" would be the
 * hole, not the feature — and ADR-0001 is explicit that the contract is published outward
 * and is not a back door inward.
 *
 * A future console reaches it with an Access **service token**, which mints the same
 * assertion with `common_name` in place of `email`. That identity is authenticated and
 * still authorises nothing on its own: it must also match an active DevYou user row
 * holding `health:view`. Provisioning that row is a deliberate act by a `dev_admin`, which
 * is the correct amount of friction for granting a machine a standing view of this
 * product's internals.
 *
 * The response is parsed against its own schema before being sent. That looks redundant —
 * `buildHealthReport` returns a `HealthReport` and the compiler already said so — and it
 * is not: the contract's whole value is that a consumer can rely on the shape, and a type
 * assertion proves nothing about a value assembled from database rows and `Date`
 * arithmetic. If the payload ever stops matching, this surface fails loudly here rather
 * than shipping a malformed document that a console will fail to parse quietly, later,
 * somewhere else.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = await requireAdmin(context, "health:view");

  const report = healthReportSchema.parse(await buildHealthReport(env));

  /* A degraded report is still a 200. The document *is* the answer, and it says `ok:
     false` in a field a consumer already has to read. Returning 503 would make a
     monitoring tool that only looks at status codes report "health endpoint down", which
     is a different and less useful fact than "R2 is failing". */
  return json(report);
}

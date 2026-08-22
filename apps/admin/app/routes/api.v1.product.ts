import { productDescriptorSchema } from "@devyou/admin-contract";
import { STATEMENTS } from "@devyou/auth";
import type { Route } from "./+types/api.v1.product";
import { requireAdmin } from "../lib/route.server";
import { json } from "../lib/http.server";

/**
 * `GET /api/v1/product` — the product descriptor.
 *
 * What a future network console needs to render DevYou as one entry in a list. It names no
 * database, exposes no binding and offers no way in: an operator reaching `adminUrl`
 * passes DevYou's own Access application, exactly as they would by typing the hostname.
 *
 * Gated on `health:view` — the one capability every admin role holds — rather than on
 * something narrower. The descriptor contains nothing an operator of this console does not
 * already know by being here; the gate exists so that the endpoint has the same perimeter
 * as everything else, not because the content is sensitive.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = await requireAdmin(context, "health:view");

  const descriptor = productDescriptorSchema.parse({
    contractVersion: "1",
    id: "devyou",
    name: "DevYou",
    summary:
      "Public, cross-vendor, version-aware engineering troubleshooting playbooks with derived confidence.",
    adminUrl: env.ADMIN_APP_URL,
    publicUrl: env.PUBLIC_APP_URL,
    environment: env.ENVIRONMENT,
    /*
      Derived from `STATEMENTS`, not hand-listed.

      A hand-written list is a second copy of the capability model, and the copy is always
      the one that is out of date — which on this endpoint means a console rendering a
      permission matrix that does not match the one being enforced.
    */
    capabilities: Object.entries(STATEMENTS).flatMap(([resource, actions]) =>
      actions.map((action) => `${resource}:${action}`),
    ),
  });

  return json(descriptor);
}

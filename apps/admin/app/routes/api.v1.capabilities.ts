import { capabilityDeclarationSchema } from "@devyou/admin-contract";
import { REASON_CODES, ROLES, capabilityMatrix } from "@devyou/auth";
import type { Route } from "./+types/api.v1.capabilities";
import { requireAdmin } from "../lib/route.server";
import { json } from "../lib/http.server";

/**
 * `GET /api/v1/capabilities` — the serialised capability declaration.
 *
 * The whole matrix, exactly as `@devyou/auth` computes it, so a future console can render a
 * permission model it does not own. `capabilityMatrix()` is the same function the capability
 * test asserts against, which is what makes this a description of what is *enforced* rather
 * than a document that describes what somebody intended.
 *
 * Read-only in the strongest sense: nothing a console does with this can grant, revoke or
 * check a capability. Enforcement lives inside DevYou, next to the database. A console that
 * decided it had a capability would be deciding about a system it cannot reach.
 *
 * The reason-code vocabulary travels with it. A console showing an audit trail has to label
 * the codes, and one guessing at labels is how `author_request` becomes "user asked" in one
 * place and "requested" in another — at which point the two logs can no longer be read
 * together, which was the only reason to mirror anything.
 */
export async function loader({ context }: Route.LoaderArgs) {
  await requireAdmin(context, "health:view");

  const declaration = capabilityDeclarationSchema.parse({
    contractVersion: "1",
    product: "devyou",
    roles: ROLES,
    reasonCodes: REASON_CODES,
    capabilities: capabilityMatrix(),
  });

  return json(declaration);
}

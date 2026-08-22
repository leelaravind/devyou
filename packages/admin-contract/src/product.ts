import { z } from "zod";
import { CONTRACT_VERSION } from "./version.js";

/**
 * The product descriptor.
 *
 * What a future network console needs in order to render DevYou as one entry in a
 * list, and nothing else. ADR-0001 decision 4: the contract is published outward, not
 * adapted inward — so this describes what DevYou *is*, and contains no hook by which a
 * console could reach into it.
 *
 * Note the two absences, both deliberate:
 *
 *   - There is no database identifier, connection string or region. Plan §13 rule 1
 *     forbids giving a central console SQL access to `devyou-db-*`, and a descriptor
 *     that named the database would be the first step toward somebody trying.
 *   - There is no session, token or credential field. A console does not sign in *to*
 *     DevYou; an operator reaches `adminUrl` and passes DevYou's own Cloudflare Access
 *     application. Federating identity is a later decision, and one this schema must
 *     not quietly pre-empt.
 */
export const productDescriptorSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  /** Stable, lowercase, and never reused. A console keys its own storage on this. */
  id: z.literal("devyou"),
  name: z.string().min(1),
  /** One line. A console renders it under the name; anything longer is truncated
   *  somewhere the author cannot see. */
  summary: z.string().min(1).max(200),
  /** Where an operator goes. Behind DevYou's own Access application — see ADR-0001. */
  adminUrl: z.url(),
  publicUrl: z.url(),
  environment: z.enum(["staging", "production"]),
  /** The capability names this product declares. Serialised separately in full; this
   *  is the flat list, so a console can decide whether it has anything to show
   *  without parsing the whole matrix. */
  capabilities: z.array(z.string()).readonly(),
});

export type ProductDescriptor = z.infer<typeof productDescriptorSchema>;

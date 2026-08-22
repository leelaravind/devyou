import { z } from "zod";
import { CONTRACT_VERSION } from "./version.js";

/**
 * The serialised capability declaration.
 *
 * So a console can render a permission matrix it does not own. It is a *description*
 * of DevYou's authorisation model, not an interface to it: nothing a console does with
 * this document can grant, revoke or check a capability. Enforcement stays in
 * `@devyou/auth`, inside DevYou, where the database is.
 *
 * `needsReason` travels with each row because it is the part an operator most needs to
 * see before acting and the part most likely to be assumed away. A console that renders
 * the matrix without it invites somebody to plan an action they will then be refused.
 */
export const capabilityRowSchema = z.object({
  resource: z.string().min(1),
  action: z.string().min(1),
  /** Roles that hold this capability. An empty array is meaningful — it means the
   *  capability exists and nobody has it, which is an explicit deny rather than an
   *  omission, and a console should show it as such. */
  grantedTo: z.array(z.string()).readonly(),
  needsReason: z.boolean(),
});

export const capabilityDeclarationSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  product: z.literal("devyou"),
  roles: z.array(z.string()).readonly(),
  /** The fixed reason-code vocabulary. Published because a console that shows an audit
   *  trail needs to label the codes, and a console guessing at labels is how
   *  `author_request` becomes "user asked" in one place and "requested" in another. */
  reasonCodes: z.array(z.string()).readonly(),
  capabilities: z.array(capabilityRowSchema),
});

export type CapabilityRow = z.infer<typeof capabilityRowSchema>;
export type CapabilityDeclaration = z.infer<typeof capabilityDeclarationSchema>;

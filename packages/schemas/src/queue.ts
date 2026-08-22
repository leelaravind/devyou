import { z } from "zod";

/**
 * Queue message contracts.
 *
 * The public Worker produces these; the jobs Worker consumes them. Neither imports
 * the other, so this file is the only thing holding the two ends together — and a
 * message shape that drifts between them fails at the Zod parse in the consumer
 * rather than halfway through a database write.
 *
 * Every message carries **identifiers, never content**. A structuring job names a
 * draft id and the consumer reads the text from D1 itself. That is not tidiness:
 * a queue message is retried, dead-lettered and retained, and putting a
 * contributor's pasted terminal history — which is exactly where a stray
 * credential lives — into a durable message body would spread it somewhere nobody
 * would think to redact.
 */

export const StructureContributionMessage = z.object({
  type: z.literal("structure_contribution"),
  draftId: z.string().max(64),
  /** For the `ai_tasks` ledger and the per-contributor spend limit. The provider
   *  never sees it — `anthropic.ts` sends a per-task identifier only. */
  requestedBy: z.string().max(64),
  enqueuedAt: z.number().int(),
});
export type StructureContributionMessage = z.infer<typeof StructureContributionMessage>;

/**
 * Every job the queue carries.
 *
 * A union rather than a bag with an optional payload, so a consumer that handles
 * one type cannot silently accept another. New job types are added here, which is
 * also where somebody has to think about whether the work belongs off the request
 * path at all.
 */
export const JobMessage = z.discriminatedUnion("type", [StructureContributionMessage]);
export type JobMessage = z.infer<typeof JobMessage>;

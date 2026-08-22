import { z } from "zod";
import { CONTRACT_VERSION } from "./version.js";

/**
 * The event mirror.
 *
 * A *summary* stream, never replication of `admin_audit_events`. ADR-0001 decision 4
 * is explicit about the difference and it is worth spelling out, because "mirror the
 * audit log" is the obvious thing somebody will build otherwise.
 *
 * The DevYou audit row carries the actor's user id, the subject's id, and a before/after
 * diff. Copying that into a second system means the same governance record now exists
 * in two places with two retention policies and two sets of people who can read it —
 * and the copy is not append-only, because the copy lives somewhere else.
 *
 * What crosses the boundary instead is: something happened, roughly when, roughly who,
 * and one line about what. Enough for a network operator to notice unusual activity and
 * go and look at the real log. Not enough to reconstruct it.
 */
export const mirroredEventSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  product: z.literal("devyou"),
  /** The capability that was exercised, e.g. `playbooks:quarantine`. Matches the
   *  statement map exactly, so a console can group without a translation table. */
  type: z.string().min(1),
  occurredAt: z.iso.datetime(),
  /**
   * An opaque, stable reference to the actor — **not** the DevYou user id and not an
   * email address.
   *
   * A console needs to tell "the same person did these six things" apart from "six
   * different people did one thing each". It does not need to know who they are, and
   * handing it an identifier that resolves in DevYou's database would make DevYou's
   * user table a de facto network identity source, which ADR-0001 forbids.
   */
  actorRef: z.string().min(1),
  /** One sentence, already redacted. Never free-text reason detail, which is written
   *  by an admin under time pressure and routinely contains a name or a URL. */
  summary: z.string().min(1).max(200),
  /** Whether the action changed something readers can see. Lets a console show a
   *  short "visible changes" view without interpreting capability names. */
  publiclyVisible: z.boolean(),
});

export type MirroredEvent = z.infer<typeof mirroredEventSchema>;

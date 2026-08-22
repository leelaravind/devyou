import { JobMessage } from "@devyou/schemas";
import { structureContribution } from "./structure.js";

/**
 * The jobs Worker.
 *
 * A queue consumer and nothing else. There is no `fetch` handler here, which is the
 * enforcement behind "no request path can spend money on a model call" — the
 * credential lives in this Worker and this Worker has no door onto the internet.
 *
 * Every message is validated against the Zod contract in `@devyou/schemas` before
 * anything reads a field off it. A queue message is not user input, but it is
 * written by a different Worker on a different deploy cadence, and a shape that has
 * drifted should fail at the parse rather than halfway through a database write.
 */
export default {
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const parsed = JobMessage.safeParse(message.body);

      if (!parsed.success) {
        /*
          A malformed message is acknowledged, not retried.

          Redelivering it produces the same parse failure until the retry limit,
          then fills the dead letter queue with something no consumer will ever
          accept. The log line is what a human acts on.
        */
        console.error("job_message_invalid", {
          id: message.id,
          detail: parsed.error.issues.map((issue) => issue.message).join("; ").slice(0, 300),
        });
        message.ack();
        continue;
      }

      try {
        switch (parsed.data.type) {
          case "structure_contribution":
            await structureContribution(env, parsed.data);
            break;
        }
        message.ack();
      } catch (error) {
        /*
          Only an infrastructure fault reaches here.

          Everything that is a property of the submission — a refusal, a schema
          mismatch, an exhausted budget — is recorded on the `ai_tasks` row and
          returns normally, because retrying a prompt problem turns one bad
          submission into three paid calls. A throw means the database or the
          network, and those are worth another attempt.
        */
        console.error("job_failed", {
          id: message.id,
          type: parsed.data.type,
          message: error instanceof Error ? error.message : "unknown",
        });
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;

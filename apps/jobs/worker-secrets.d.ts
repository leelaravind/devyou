/**
 * Worker Secrets, declared by hand.
 *
 * `wrangler types` regenerates `worker-configuration.d.ts` from `wrangler.jsonc`,
 * and a secret must never appear in a committed config file — so it is declared
 * here instead, and this file is not generated. Editing it is how a new secret
 * becomes visible to the compiler.
 *
 * Optional, because a deployment without an AI credential is a supported state.
 * `structure_contribution` then records a refusal on the `ai_tasks` row and the
 * contributor writes the structure themselves; nothing else in the product
 * changes. Typing it as required would make the compiler insist on a credential
 * that a staging Worker legitimately does not have.
 *
 * Set it with `wrangler secret put ANTHROPIC_API_KEY --env staging`, never in
 * `.env` and never in this repository.
 */
interface Env {
  /** Anthropic key for the AI assistance tasks. This Worker is the only one that
   *  holds it, and nothing it produces is served to a browser. */
  ANTHROPIC_API_KEY?: string;
}

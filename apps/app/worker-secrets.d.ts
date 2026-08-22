/**
 * Worker Secrets, declared by hand.
 *
 * `wrangler types` regenerates `worker-configuration.d.ts` from `wrangler.jsonc`,
 * and secrets are deliberately not in `wrangler.jsonc` — putting a client secret in
 * a committed config file is the mistake this whole arrangement exists to prevent.
 * So they are declared here instead, and this file is not generated: editing it is
 * how a new secret becomes visible to the compiler.
 *
 * Every one is optional. A deployment without GitHub OAuth credentials is a
 * supported state — `isConfigured()` returns false and the sign-in page says so —
 * and typing them as required would make the compiler insist on credentials that
 * a staging Worker legitimately does not have.
 *
 * Set them with `wrangler secret put GITHUB_CLIENT_SECRET --env staging`, never in
 * `.env` and never in this repository.
 *
 * `ANTHROPIC_API_KEY` is deliberately **not** declared here, and its absence is the
 * control rather than an oversight. `apps/jobs/wrangler.jsonc` states the split: no
 * request path may spend money on a model call, so the public Worker produces a queue
 * message and `devyou-jobs` — which has no hostname and no `fetch` handler — holds the
 * credential and consumes it. Declaring the key on this Env would make
 * `env.ANTHROPIC_API_KEY` compile in a loader, and the first person to write that line
 * would have moved a paid, prompt-injectable call onto the public request path without
 * anything failing. With the declaration absent, that line does not typecheck.
 */
interface Env {
  /** GitHub OAuth app client id. Public by nature, but kept alongside the secret so
   *  the pair is configured or absent together rather than half-present. */
  GITHUB_CLIENT_ID?: string;
  /** GitHub OAuth app client secret. */
  GITHUB_CLIENT_SECRET?: string;
}

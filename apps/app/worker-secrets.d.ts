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
 */
interface Env {
  /** GitHub OAuth app client id. Public by nature, but kept alongside the secret so
   *  the pair is configured or absent together rather than half-present. */
  GITHUB_CLIENT_ID?: string;
  /** GitHub OAuth app client secret. */
  GITHUB_CLIENT_SECRET?: string;
  /** Anthropic key for the AI assistance tasks. Server-side only — the provider
   *  abstraction is the only thing that reads it, and it never reaches the client. */
  ANTHROPIC_API_KEY?: string;
}

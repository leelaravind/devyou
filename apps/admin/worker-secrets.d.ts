/**
 * Worker Secrets, declared by hand.
 *
 * `wrangler types` regenerates `worker-configuration.d.ts` from `wrangler.jsonc`, and
 * a secret must never appear in `wrangler.jsonc`. So it is declared here, and this file
 * is not generated: editing it is how a new secret becomes visible to the compiler.
 *
 * Optional in the type, mandatory at runtime — and that asymmetry is the point. The
 * Access application does not exist yet (owner action A0-1), so a deployment without
 * `CF_ACCESS_POLICY_AUD` is a real state the Worker must handle. Typing it as required
 * would make the compiler assert a fact about production that is currently false, and
 * would hide the branch that matters: with no AUD configured the Worker refuses every
 * request. See `app/lib/access.server.ts`.
 *
 * Set it with `wrangler secret put CF_ACCESS_POLICY_AUD --env staging`, never in
 * `.env`, `.dev.vars` committed to git, or this repository.
 */
interface Env {
  /**
   * The AUD tag of the Cloudflare Access application protecting the admin hostnames.
   *
   * It identifies exactly one application. Without it, a JWT minted for *any* Access
   * application in the team domain would verify — same issuer, same signing keys — so
   * an operator with access to an unrelated internal tool would be admitted here. That
   * is why an unconfigured AUD is a refusal rather than a relaxed check.
   */
  CF_ACCESS_POLICY_AUD?: string;
}

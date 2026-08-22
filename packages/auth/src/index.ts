/**
 * Identity, product-local.
 *
 * `session.ts` — opaque tokens, hashed at rest, plus the same-origin check.
 * `capabilities.ts` — the statement map, which is the single source of truth for
 * what a role may do and grants no standing to anybody.
 * `github.ts` — the one sign-in provider, which proves control of an account and
 * nothing else.
 *
 * ADR-0001: DevYou's users are DevYou's. No other product's table is an identity
 * source here, and this one is not an identity source for anything else.
 */
export * from "./session.js";
export * from "./capabilities.js";
export * from "./github.js";

import {
  SESSION_COOKIE,
  assertSameOrigin,
  cookieValue,
  isConfigured,
  resolvePrincipal,
  type GitHubConfig,
  type Principal,
} from "@devyou/auth";
import { httpError } from "./http.server";

/**
 * Auth wiring for the public Worker.
 *
 * Two things worth knowing before using any of this.
 *
 * **Sign-in is optional infrastructure, not a gate.** Every public route resolves a
 * principal and carries on without one. Plan §0.7 makes reading and searching
 * frictionless, and §0.8 keeps reporting a reproduction low-friction — signing in
 * changes what a report *counts for*, never whether it can be filed.
 *
 * **Sign-in can be unconfigured, and that is a supported state.** GitHub OAuth needs
 * an app registered by the account owner, which is an action outside this
 * repository. When the credentials are absent the sign-in page says so plainly
 * instead of offering a button that leads to a provider error. Everything else on
 * the site works unchanged.
 */

export interface AuthState {
  principal: Principal | null;
  signInAvailable: boolean;
}

export async function loadAuthState(request: Request, env: Env): Promise<AuthState> {
  return {
    principal: await resolvePrincipal(env.DB, request),
    signInAvailable: isConfigured(githubConfig(env)),
  };
}

export function githubConfig(env: Env): Partial<GitHubConfig> {
  return {
    /* An empty string is treated as absent. `wrangler secret put` with an empty
       value, and a `.dev.vars` line with nothing after the `=`, both produce one —
       and a config that is present-but-blank fails at GitHub with a confusing error
       instead of at `isConfigured()` with a clear one. */
    clientId: nonEmpty(env.GITHUB_CLIENT_ID),
    clientSecret: nonEmpty(env.GITHUB_CLIENT_SECRET),
    redirectUri: `${env.PUBLIC_APP_URL}/auth/github/callback`,
  };
}

export function sessionTokenFrom(request: Request): string | null {
  return cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
}

/**
 * Refuse a cross-origin state change, as a 403 rather than a 500.
 *
 * `assertSameOrigin` throws an `ApiError`, which React Router would surface as an
 * unhandled 500 — see `httpError` for why that distinction is worth the four lines.
 */
export function guardOrigin(request: Request, env: Env): void {
  try {
    assertSameOrigin(request, env.PUBLIC_APP_URL);
  } catch (error) {
    throw httpError(error);
  }
}

/**
 * The OAuth `state` cookie.
 *
 * Short-lived, `HttpOnly`, and `SameSite=Lax` rather than `Strict` — the callback
 * arrives as a top-level navigation *from GitHub*, so a `Strict` cookie would not be
 * sent and the check would fail for every legitimate sign-in while passing for
 * nobody.
 */
export const OAUTH_STATE_COOKIE = "dv_oauth_state";
const STATE_TTL_SECONDS = 600;

export function serialiseStateCookie(state: string, secure: boolean): string {
  return [
    `${OAUTH_STATE_COOKIE}=${state}`,
    "Path=/auth",
    `Max-Age=${STATE_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; Path=/auth; Max-Age=0; HttpOnly; SameSite=Lax`;
}

/**
 * Compare the returned state to the stored one, in constant time.
 *
 * A timing-safe comparison is arguably theatre for a value that is 256 bits of
 * CSRNG, since guessing it byte by byte is not a realistic attack. It costs three
 * lines and removes the need for anybody to make that judgement again.
 */
export function stateMatches(expected: string | null, actual: string | null): boolean {
  if (!expected || !actual || expected.length !== actual.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index++) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined;
}

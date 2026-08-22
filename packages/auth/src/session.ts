import { ApiError, newId } from "@devyou/core";

/**
 * Sessions.
 *
 * Product-local, as ADR-0001 requires: ATSYou's `users` table is not an identity
 * source here, and DevYou's is not one for anything else.
 *
 * The token is a 256-bit random value sent to the browser and **never stored**.
 * What the database holds is its SHA-256. A stolen database is therefore not a
 * stolen set of live sessions — the attacker has hashes, and the cookie value that
 * would authenticate is not derivable from them.
 *
 * Reading and searching never touch this module. Plan §0.7 makes public read
 * frictionless, and an anonymous reader must not be issued a session merely for
 * arriving — so there is no "create a session on first request" path here, by
 * omission rather than by policy.
 */

export const SESSION_COOKIE = "dv_session";

/** Thirty days. Long enough that a contributor is not signed out between visits,
 *  short enough that an abandoned session on a shared machine expires. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Re-issued when a session is more than a day old, so the expiry slides for
 *  active users without a write on every request. */
const REFRESH_AFTER_SECONDS = 24 * 60 * 60;

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: number;
  lastSeenAt: number;
}

export interface Principal {
  userId: string;
  role: string;
  status: string;
  handle: string | null;
  displayName: string | null;
}

/** A fresh opaque token. 256 bits from the platform CSRNG. */
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createSession(
  db: D1Database,
  userId: string,
  context: { userAgentFamily: string | null; ipHash: string | null },
): Promise<{ token: string; expiresAt: number }> {
  const token = newSessionToken();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL_SECONDS;

  await db
    .prepare(
      `INSERT INTO sessions
         (id, user_id, token_hash, created_at, expires_at, last_seen_at, user_agent_family, ip_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?6, ?7)`,
    )
    .bind(
      newId("session"),
      userId,
      await hashToken(token),
      now,
      expiresAt,
      context.userAgentFamily,
      context.ipHash,
    )
    .run();

  return { token, expiresAt };
}

/**
 * Resolve a request's principal, or null.
 *
 * Returns null rather than throwing for every failure mode — expired, revoked,
 * unknown, suspended. A caller that needs a principal uses `requirePrincipal`; a
 * caller that merely *prefers* one (the search page, which personalises nothing but
 * shows a sign-in link) must not have to catch.
 */
export async function resolvePrincipal(
  db: D1Database,
  request: Request,
): Promise<Principal | null> {
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token || token.length !== 64) return null;

  const now = Math.floor(Date.now() / 1000);

  const row = await db
    .prepare(
      `SELECT s.id, s.user_id, s.expires_at, u.role, u.status, p.handle, p.display_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE s.token_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2`,
    )
    .bind(await hashToken(token), now)
    .first<{
      id: string;
      user_id: string;
      expires_at: number;
      role: string;
      status: string;
      handle: string | null;
      display_name: string | null;
    }>();

  if (!row) return null;

  /*
    A suspended account resolves to nothing, not to a principal with a flag.

    Returning a principal and expecting every call site to check `status` is a
    check somebody eventually forgets. A suspended user is signed out everywhere,
    immediately, by this one condition.
  */
  if (row.status !== "active") return null;

  return {
    userId: row.user_id,
    role: row.role,
    status: row.status,
    handle: row.handle,
    displayName: row.display_name,
  };
}

/** Whether the session should have its expiry extended. Called after resolution so
 *  the write is out of the read path's critical section. */
export function shouldRefresh(lastSeenAt: number, now: number): boolean {
  return now - lastSeenAt > REFRESH_AFTER_SECONDS;
}

export async function touchSession(db: D1Database, token: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE sessions SET last_seen_at = ?1, expires_at = ?2
       WHERE token_hash = ?3 AND revoked_at IS NULL`,
    )
    .bind(now, now + SESSION_TTL_SECONDS, await hashToken(token))
    .run();
}

export async function revokeSession(db: D1Database, token: string): Promise<void> {
  await db
    .prepare(`UPDATE sessions SET revoked_at = ?1 WHERE token_hash = ?2`)
    .bind(Math.floor(Date.now() / 1000), await hashToken(token))
    .run();
}

/** Revoke every session for a user — the remedy for "my account may be
 *  compromised", and what account suspension calls. */
export async function revokeAllSessions(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(`UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL`)
    .bind(Math.floor(Date.now() / 1000), userId)
    .run();
}

export function requirePrincipal(principal: Principal | null): Principal {
  if (!principal) throw new ApiError("UNAUTHENTICATED");
  return principal;
}

/* ---------------------------------------------------------------------------
   Cookies
   --------------------------------------------------------------------------- */

/**
 * The session cookie.
 *
 * `HttpOnly` — unlike the environment cookie, this one authorises things, so
 * script must not be able to read it. `SameSite=Lax` rather than `Strict`: a
 * contributor following a playbook link from Slack should still be signed in, and
 * every state-changing route checks the request origin separately.
 */
export function serialiseSessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

/**
 * Reject a cross-origin state-changing request.
 *
 * `SameSite=Lax` already blocks the cross-site POST that CSRF depends on, but it is
 * one control and browsers have historically differed on the edges. Comparing the
 * `Origin` header to the expected host is cheap, has no false positives on a normal
 * same-origin form, and fails closed when the header is absent on a method that
 * should always send it.
 */
export function assertSameOrigin(request: Request, expectedUrl: string): void {
  if (request.method === "GET" || request.method === "HEAD") return;

  const origin = request.headers.get("origin");
  if (!origin) {
    throw new ApiError("FORBIDDEN", { internalDetail: "state-changing request with no Origin" });
  }

  let expectedHost: string;
  try {
    expectedHost = new URL(expectedUrl).host;
  } catch {
    throw new ApiError("INTERNAL", { internalDetail: "malformed configured app URL" });
  }

  if (new URL(origin).host !== expectedHost) {
    throw new ApiError("FORBIDDEN", { internalDetail: "cross-origin state change refused" });
  }
}

export function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

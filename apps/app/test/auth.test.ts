import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_COOKIE,
  buildAuthorisationUrl,
  clearSessionCookie,
  createSession,
  exchangeCode,
  hashToken,
  isConfigured,
  newSessionToken,
  resolvePrincipal,
  revokeAllSessions,
  revokeSession,
  serialiseSessionCookie,
  upsertAccount,
} from "@devyou/auth";
import {
  OAUTH_STATE_COOKIE,
  clearStateCookie,
  serialiseStateCookie,
  stateMatches,
} from "../app/lib/auth.server";

/**
 * Sign-in, against the real schema.
 *
 * `packages/auth` had tests for `capabilities.ts` and nothing else, which meant the
 * OAuth state check, the cookie flags, session revocation and the account upsert were
 * all unasserted — on the one code path that decides whose name ends up attached to a
 * piece of evidence. This file covers them.
 *
 * The GitHub network calls are exercised against a stubbed `fetch`. That is a
 * deliberate exception to this repository's preference for the real thing: the real
 * thing is somebody else's API, the interesting cases are its *failures* (a reused
 * code, a truncated payload), and those cannot be provoked on demand. What is not
 * stubbed is anything DevYou owns — the database, the schema, the session lookup.
 */

const CONFIG = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "https://dev.itisyou.app/auth/github/callback",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function requestWithCookie(value: string | null): Request {
  const headers = new Headers();
  if (value !== null) headers.set("cookie", `${SESSION_COOKIE}=${value}`);
  return new Request("https://dev.itisyou.app/", { headers });
}

/** Stub `fetch` for the two GitHub endpoints, in call order: token, then user. */
function stubGitHub(token: unknown, user: unknown, tokenOk = true, userOk = true): void {
  let call = 0;
  vi.stubGlobal("fetch", async () => {
    call += 1;
    return call === 1
      ? new Response(JSON.stringify(token), { status: tokenOk ? 200 : 502 })
      : new Response(JSON.stringify(user), { status: userOk ? 200 : 500 });
  });
}

/* ---------------------------------------------------------------------------
   Configuration
   --------------------------------------------------------------------------- */

describe("whether sign-in is offered at all", () => {
  it("is unavailable when either credential is missing or blank", () => {
    expect(isConfigured({ ...CONFIG, clientSecret: undefined })).toBe(false);
    expect(isConfigured({ ...CONFIG, clientId: undefined })).toBe(false);
    /* Blank rather than absent is the case `githubConfig` normalises, and it is the
       one a real deployment produces: `wrangler secret put` with an empty value, or a
       `.dev.vars` line with nothing after the `=`. Present-but-blank must not count as
       configured, or the failure moves from a clear message here to a confusing one at
       GitHub. */
    expect(isConfigured({ ...CONFIG, clientSecret: "" })).toBe(false);
    expect(isConfigured(CONFIG)).toBe(true);
  });
});

/* ---------------------------------------------------------------------------
   The authorisation request
   --------------------------------------------------------------------------- */

describe("the authorisation URL", () => {
  it("asks for no scopes", () => {
    /*
      The consent screen is the only thing most contributors will ever read about
      DevYou's access to their account. Asking for `read:user` when the product uses
      the public profile the unscoped token already returns would make that screen
      overstate the ask, for nothing.
    */
    const { url } = buildAuthorisationUrl(CONFIG);
    expect(new URL(url).searchParams.get("scope")).toBe("");
  });

  it("carries a fresh 256-bit state every time", () => {
    const first = buildAuthorisationUrl(CONFIG);
    const second = buildAuthorisationUrl(CONFIG);

    expect(first.state).toHaveLength(64);
    expect(first.state).toMatch(/^[0-9a-f]{64}$/);
    /* A reused state is a replayable one. */
    expect(first.state).not.toBe(second.state);
    expect(new URL(first.url).searchParams.get("state")).toBe(first.state);
  });

  it("sends the exact registered redirect_uri", () => {
    expect(new URL(buildAuthorisationUrl(CONFIG).url).searchParams.get("redirect_uri")).toBe(
      CONFIG.redirectUri,
    );
  });
});

/* ---------------------------------------------------------------------------
   State / login CSRF
   --------------------------------------------------------------------------- */

describe("the state check", () => {
  it("refuses a missing, empty or wrong-length state", () => {
    /*
      Each of these is login CSRF until proven otherwise: somebody completing an OAuth
      flow in a victim's browser so the victim's session is bound to the attacker's
      GitHub account. Quieter than ordinary CSRF, and worse — everything the victim
      then writes is attributed to an account the attacker controls.
    */
    expect(stateMatches(null, "abc")).toBe(false);
    expect(stateMatches("abc", null)).toBe(false);
    expect(stateMatches("", "")).toBe(false);
    expect(stateMatches("abcd", "abc")).toBe(false);
  });

  it("accepts only an exact match", () => {
    const state = buildAuthorisationUrl(CONFIG).state;
    expect(stateMatches(state, state)).toBe(true);
    expect(stateMatches(state, state.slice(0, -1) + (state.endsWith("0") ? "1" : "0"))).toBe(false);
  });

  it("scopes the state cookie to /auth, HttpOnly, and expires it quickly", () => {
    const cookie = serialiseStateCookie("abc", true);
    expect(cookie).toContain(`${OAUTH_STATE_COOKIE}=abc`);
    expect(cookie).toContain("Path=/auth");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    /* Lax rather than Strict, and that is not a weakening: the callback arrives as a
       top-level navigation *from GitHub*, so a Strict cookie would not be sent and the
       check would fail for every legitimate sign-in while passing for nobody. */
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toMatch(/Max-Age=\d{1,3}\b/);
  });

  it("clears the state cookie on the same path it was set", () => {
    /* A clear scoped to a different path leaves the original cookie alive, which is
       the whole failure this is guarding: a state value that survives a failed attempt
       is a state value that can be replayed. */
    expect(clearStateCookie()).toContain("Path=/auth");
    expect(clearStateCookie()).toContain("Max-Age=0");
  });
});

/* ---------------------------------------------------------------------------
   Token exchange
   --------------------------------------------------------------------------- */

describe("exchanging the code", () => {
  it("returns the identity and never the access token", async () => {
    stubGitHub(
      { access_token: "gho_secret_value" },
      { id: 42, login: "octocat", name: "The Octocat", avatar_url: "https://example.test/a.png" },
    );

    const identity = await exchangeCode(CONFIG, "code-123");

    expect(identity).toEqual({
      githubId: 42,
      login: "octocat",
      displayName: "The Octocat",
      avatarUrl: "https://example.test/a.png",
    });
    /* The token is used once and never returned, stored or logged. DevYou has no
       reason to act on GitHub's behalf later, so keeping it would be a credential to
       protect for no capability the product uses. */
    expect(JSON.stringify(identity)).not.toContain("gho_secret_value");
  });

  it("does not echo GitHub's error wording to the caller", async () => {
    stubGitHub({ error: "bad_verification_code" }, {});

    await expect(exchangeCode(CONFIG, "reused-code")).rejects.toMatchObject({
      publicMessage: "That sign-in link has expired. Please try again.",
    });
  });

  it("refuses a user payload missing an id or a login", async () => {
    /* A truncated or changed payload must fail the sign-in rather than produce an
       account with an undefined login, which would then collide with every other one. */
    stubGitHub({ access_token: "t" }, { login: "octocat" });
    await expect(exchangeCode(CONFIG, "c")).rejects.toThrow();

    stubGitHub({ access_token: "t" }, { id: 1 });
    await expect(exchangeCode(CONFIG, "c")).rejects.toThrow();
  });

  it("fails rather than proceeding when GitHub is unreachable", async () => {
    stubGitHub({}, {}, false);
    await expect(exchangeCode(CONFIG, "c")).rejects.toThrow();
  });
});

/* ---------------------------------------------------------------------------
   The account
   --------------------------------------------------------------------------- */

describe("the account a GitHub sign-in creates", () => {
  const identity = (login: string) => ({
    githubId: 1,
    login,
    displayName: "Someone",
    avatarUrl: null,
  });

  it("is a contributor, which holds no capability at all", async () => {
    const { userId, created } = await upsertAccount(env.DB, identity("newcomer"));
    expect(created).toBe(true);

    const row = await env.DB.prepare(`SELECT role, status, email FROM users WHERE id = ?1`)
      .bind(userId)
      .first<{ role: string; status: string; email: string | null }>();

    /*
      Plan §12, in one assertion: "a GitHub-linked account proves control of that
      account, not technical correctness." `contributor` is the label for "we can
      attribute a reproduction to this person" and grants nothing — see
      `capabilities.test.ts`, which asserts the empty grant list directly.
    */
    expect(row?.role).toBe("contributor");
    expect(row?.status).toBe("active");
    /* No email is taken. The unscoped token does not return one, and asking for
       `user:email` would widen the consent screen for a field the product does not
       use. It also keeps GitHub sign-in structurally unable to collide with an admin
       account, which is matched on `users.email`. */
    expect(row?.email).toBeNull();
  });

  it("reads nothing that could become reputation", async () => {
    /*
      A structural assertion rather than a behavioural one, and the stronger of the
      two: `GitHubIdentity` has four fields, and follower count, account age, starred
      repositories and organisation membership are not among them. There is nothing
      for a later change to start weighting, because the value never enters the
      process.
    */
    const { userId } = await upsertAccount(env.DB, identity("measured"));
    const profile = await env.DB.prepare(`SELECT * FROM profiles WHERE user_id = ?1`)
      .bind(userId)
      .first<Record<string, unknown>>();

    const columns = Object.keys(profile ?? {});
    for (const forbidden of ["followers", "public_repos", "stars", "account_age", "reputation"]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it("returns the same account on a second sign-in", async () => {
    const first = await upsertAccount(env.DB, identity("returning"));
    const second = await upsertAccount(env.DB, identity("returning"));

    expect(second.userId).toBe(first.userId);
    expect(second.created).toBe(false);
  });

  it("allocates a distinct handle rather than failing when one is taken", async () => {
    await env.DB.prepare(
      `INSERT INTO users (id, created_at, status, role) VALUES ('usr_handle_squatter', 1, 'active', 'contributor')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO profiles (user_id, display_name, handle, created_at)
       VALUES ('usr_handle_squatter', 'Squatter', 'contested', 1)`,
    ).run();

    const { userId } = await upsertAccount(env.DB, identity("contested"));
    const handle = await env.DB.prepare(`SELECT handle FROM profiles WHERE user_id = ?1`)
      .bind(userId)
      .first<{ handle: string }>();

    /* Being unable to sign in because somebody else has your name is a worse outcome
       than an unfamiliar handle. */
    expect(handle?.handle).not.toBe("contested");
    expect(handle?.handle).toMatch(/^contested-/);
  });
});

/* ---------------------------------------------------------------------------
   Sessions
   --------------------------------------------------------------------------- */

describe("the session a sign-in issues", () => {
  /* A monotonic counter rather than randomness. Storage is shared across the tests in
     this describe block, so a fixture that could repeat an id would collide on the
     primary key — and `Math.random` is banned by lint here anyway, correctly: the rule
     cannot tell a test fixture from a token. */
  let seq = 0;

  async function signedIn(role = "contributor", status = "active") {
    const id = `usr_sess_${(seq += 1)}`;
    await env.DB.prepare(`INSERT INTO users (id, created_at, status, role) VALUES (?1, 1, ?2, ?3)`)
      .bind(id, status, role)
      .run();
    const { token } = await createSession(env.DB, id, { userAgentFamily: null, ipHash: null });
    return { id, token };
  }

  it("stores only the hash, never the token", async () => {
    const { token } = await signedIn();
    const row = await env.DB.prepare(`SELECT token_hash FROM sessions WHERE token_hash = ?1`)
      .bind(await hashToken(token))
      .first<{ token_hash: string }>();

    expect(row).not.toBeNull();
    /* A stolen database must not be a stolen set of live sessions. */
    expect(row?.token_hash).not.toBe(token);

    const anyMatch = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?1`,
    )
      .bind(token)
      .first<{ n: number }>();
    expect(anyMatch?.n).toBe(0);
  });

  it("issues 256 bits from the platform CSRNG", () => {
    const a = newSessionToken();
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(newSessionToken());
  });

  it("resolves the principal it was issued for", async () => {
    const { id, token } = await signedIn();
    const principal = await resolvePrincipal(env.DB, requestWithCookie(token));
    expect(principal?.userId).toBe(id);
  });

  it("resolves nothing for a revoked session", async () => {
    const { token } = await signedIn();
    await revokeSession(env.DB, token);
    expect(await resolvePrincipal(env.DB, requestWithCookie(token))).toBeNull();
  });

  it("resolves nothing after every session is revoked", async () => {
    const { id, token } = await signedIn();
    await revokeAllSessions(env.DB, id);
    expect(await resolvePrincipal(env.DB, requestWithCookie(token))).toBeNull();
  });

  it("resolves nothing for an expired session", async () => {
    const { token } = await signedIn();
    await env.DB.prepare(`UPDATE sessions SET expires_at = 1 WHERE token_hash = ?1`)
      .bind(await hashToken(token))
      .run();
    expect(await resolvePrincipal(env.DB, requestWithCookie(token))).toBeNull();
  });

  it("signs a suspended account out everywhere, immediately", async () => {
    /*
      One condition in `resolvePrincipal` rather than a `status` flag on the principal
      that every call site must remember to check. Suspension has to take effect on the
      next request without anybody revoking anything.
    */
    const { id, token } = await signedIn();
    expect(await resolvePrincipal(env.DB, requestWithCookie(token))).not.toBeNull();

    await env.DB.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?1`).bind(id).run();
    expect(await resolvePrincipal(env.DB, requestWithCookie(token))).toBeNull();
  });

  it("resolves nothing for an absent, malformed or unknown token", async () => {
    expect(await resolvePrincipal(env.DB, requestWithCookie(null))).toBeNull();
    expect(await resolvePrincipal(env.DB, requestWithCookie("short"))).toBeNull();
    expect(await resolvePrincipal(env.DB, requestWithCookie("f".repeat(64)))).toBeNull();
  });
});

describe("the session cookie", () => {
  it("is HttpOnly, Secure and same-site over https", () => {
    const cookie = serialiseSessionCookie("t".repeat(64), true);
    /* HttpOnly because unlike the environment cookie this one authorises things, so
       script must not be able to read it. */
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });

  it("omits Secure only when the request was not https", () => {
    /* Local development over http, and nothing else. Production always passes true —
       `auth.github.callback.ts` derives it from the callback URL's own protocol. */
    expect(serialiseSessionCookie("t", false)).not.toContain("Secure");
  });

  it("clears with an immediate expiry and the same attributes", () => {
    expect(clearSessionCookie()).toContain("Max-Age=0");
    expect(clearSessionCookie()).toContain("HttpOnly");
    expect(clearSessionCookie()).toContain("Path=/");
  });
});

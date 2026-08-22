import { ApiError, newId, slugify } from "@devyou/core";

/**
 * GitHub sign-in.
 *
 * Plan §12 picks GitHub as the lowest-friction developer identity, and adds the
 * caveat that matters most here:
 *
 *   "Do not couple GitHub identity to trust automatically. A GitHub-linked account
 *    proves control of that account, not technical correctness."
 *
 * So a GitHub sign-in grants exactly one thing: an attributable identity. It sets
 * `role = 'contributor'`, which carries no capabilities at all (see
 * `capabilities.ts`) — it is the label for "this is a person we can attribute a
 * reproduction to". Account age, follower count, stars and organisation membership
 * are not read and are not stored, because using them would be exactly the
 * automatic trust coupling the plan forbids.
 *
 * The one derived signal that *is* used lives elsewhere: `actor_trust` weights a
 * reproduction by the reporter's independence, computed from their own behaviour
 * on this site rather than from anything GitHub says about them.
 */

const AUTHORISE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

export interface GitHubConfig {
  clientId: string;
  clientSecret: string;
  /** Absolute, and must match the OAuth app's registered callback exactly. */
  redirectUri: string;
}

export function isConfigured(config: Partial<GitHubConfig>): config is GitHubConfig {
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

/**
 * Build the authorisation URL and the state to check it against.
 *
 * `state` is 256 bits of CSRNG, returned to the caller to put in a short-lived
 * cookie and compared on the callback. Without it, an attacker can complete an
 * OAuth flow in a victim's browser and bind the victim's session to the attacker's
 * GitHub account — a login CSRF, which is quieter and worse than the usual kind.
 *
 * Scope is empty. DevYou needs the public profile the unscoped token already
 * returns; asking for `read:user` or `user:email` would make the consent screen ask
 * for more than the product uses, and the least alarming consent screen is the one
 * that is honestly narrow.
 */
export function buildAuthorisationUrl(
  config: GitHubConfig,
  options: { returnTo?: string } = {},
): { url: string; state: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const state = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  const url = new URL(AUTHORISE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "");
  url.searchParams.set("allow_signup", "true");

  void options;
  return { url: url.toString(), state };
}

export interface GitHubIdentity {
  githubId: number;
  login: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Exchange the code for the identity.
 *
 * The access token is used once, here, and never stored. DevYou has no reason to
 * act on GitHub's behalf later — it needed to know who this is, and now it does.
 * A stored token would be a credential to protect, a scope to justify, and a thing
 * to revoke, for no capability the product uses.
 */
export async function exchangeCode(config: GitHubConfig, code: string): Promise<GitHubIdentity> {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    throw new ApiError("UNAVAILABLE", {
      publicMessage: "GitHub could not be reached. Try again shortly.",
      internalDetail: `github token endpoint returned ${tokenResponse.status}`,
    });
  }

  const tokenBody = (await tokenResponse.json()) as { access_token?: string; error?: string };
  if (!tokenBody.access_token) {
    /*
      The GitHub error is not echoed to the caller.

      It is usually `bad_verification_code`, which means the code was reused or
      expired — commonly a double-submitted callback. Surfacing the provider's
      wording invites somebody to probe the exchange; a plain retry message does not.
    */
    throw new ApiError("UNAUTHENTICATED", {
      publicMessage: "That sign-in link has expired. Please try again.",
      internalDetail: `github token exchange failed: ${tokenBody.error ?? "no token"}`,
    });
  }

  const userResponse = await fetch(USER_URL, {
    headers: {
      authorization: `Bearer ${tokenBody.access_token}`,
      accept: "application/vnd.github+json",
      "user-agent": "devyou",
    },
  });

  if (!userResponse.ok) {
    throw new ApiError("UNAVAILABLE", {
      internalDetail: `github user endpoint returned ${userResponse.status}`,
    });
  }

  const user = (await userResponse.json()) as {
    id?: number;
    login?: string;
    name?: string | null;
    avatar_url?: string | null;
  };

  if (typeof user.id !== "number" || typeof user.login !== "string") {
    throw new ApiError("UNAVAILABLE", { internalDetail: "github user payload missing id or login" });
  }

  return {
    githubId: user.id,
    login: user.login,
    displayName: user.name ?? null,
    avatarUrl: user.avatar_url ?? null,
  };
}

/**
 * Find or create the local account.
 *
 * Matched on `github_login`, which GitHub allows a user to change — so a rename
 * produces a new local account rather than silently taking over an old one. That is
 * the safe direction: the alternative, matching on a numeric id and updating the
 * login, is correct until somebody renames *into* a login somebody else vacated,
 * at which point attribution silently transfers. Duplicate accounts are a support
 * problem; misattributed evidence is a correctness problem.
 */
export async function upsertAccount(
  db: D1Database,
  identity: GitHubIdentity,
): Promise<{ userId: string; created: boolean }> {
  const existing = await db
    .prepare(`SELECT user_id FROM profiles WHERE github_login = ?1`)
    .bind(identity.login)
    .first<{ user_id: string }>();

  if (existing) return { userId: existing.user_id, created: false };

  const userId = newId("user");
  const now = Math.floor(Date.now() / 1000);
  const handle = await allocateHandle(db, identity.login);

  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, created_at, status, role) VALUES (?1, ?2, 'active', 'contributor')`,
      )
      .bind(userId, now),
    db
      .prepare(
        `INSERT INTO profiles (user_id, display_name, handle, avatar_url, github_login, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(
        userId,
        identity.displayName ?? identity.login,
        handle,
        identity.avatarUrl,
        identity.login,
        now,
      ),
  ]);

  return { userId, created: true };
}

/** A handle that is free. Falls back to a suffixed form rather than failing the
 *  sign-in — being unable to sign in because somebody else has your name is a
 *  worse outcome than an unfamiliar handle. */
async function allocateHandle(db: D1Database, login: string): Promise<string> {
  const base = slugify(login) || "contributor";

  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    const taken = await db
      .prepare(`SELECT 1 AS taken FROM profiles WHERE handle = ?1`)
      .bind(candidate)
      .first<{ taken: number }>();
    if (!taken) return candidate;
  }

  return `${base}-${randomSuffix()}${randomSuffix()}`;
}

function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(2));
  return [...bytes].map((byte) => byte.toString(36)).join("").slice(0, 4);
}

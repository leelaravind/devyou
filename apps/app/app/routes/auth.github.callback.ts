import { redirect } from "react-router";
import {
  createSession,
  exchangeCode,
  isConfigured,
  serialiseSessionCookie,
  upsertAccount,
} from "@devyou/auth";
import type { Route } from "./+types/auth.github.callback";
import { cloudflareContext } from "../context/cloudflare";
import {
  OAUTH_STATE_COOKIE,
  clearStateCookie,
  githubConfig,
  stateMatches,
} from "../lib/auth.server";
import { hashIp } from "../lib/reproduction.server";

/**
 * The OAuth callback.
 *
 * Every failure here redirects to `/sign-in?error=…` with a short code rather than
 * rendering a message from the provider. Two reasons: the provider's wording invites
 * probing, and a reader who has just been bounced through GitHub deserves a page
 * that looks like the site they were on rather than an error screen.
 *
 * The state cookie is cleared on every path — success, failure, and mismatch. A
 * state value that survives a failed attempt is a state value that can be replayed.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const config = githubConfig(env);
  const clear = clearStateCookie();

  if (!isConfigured(config)) {
    return redirect("/sign-in?error=unavailable", { headers: { "Set-Cookie": clear } });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

  /*
    GitHub sends `error=access_denied` when somebody cancels on the consent screen.
    That is not a failure — it is a person changing their mind — so it goes back to
    the sign-in page quietly rather than as an error.
  */
  if (url.searchParams.get("error") === "access_denied") {
    return redirect("/sign-in", { headers: { "Set-Cookie": clear } });
  }

  const expectedState = cookie(request.headers.get("cookie"), OAUTH_STATE_COOKIE);
  if (!stateMatches(expectedState, returnedState)) {
    /*
      A state mismatch is login CSRF until proven otherwise: somebody completing an
      OAuth flow in this browser to bind this session to their account. It is also
      what a stale bookmarked callback looks like, which is why the reader gets a
      plain "try again" rather than an accusation.
    */
    return redirect("/sign-in?error=state", { headers: { "Set-Cookie": clear } });
  }

  if (!code) {
    return redirect("/sign-in?error=no_code", { headers: { "Set-Cookie": clear } });
  }

  try {
    const identity = await exchangeCode(config, code);
    const { userId } = await upsertAccount(env.DB, identity);

    const ip = request.headers.get("cf-connecting-ip");
    const { token } = await createSession(env.DB, userId, {
      userAgentFamily: userAgentFamily(request.headers.get("user-agent")),
      ipHash: await hashIp(ip, "session"),
    });

    const headers = new Headers();
    headers.append("Set-Cookie", clear);
    headers.append("Set-Cookie", serialiseSessionCookie(token, url.protocol === "https:"));

    return redirect("/", { headers });
  } catch (error) {
    console.error("github_callback_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return redirect("/sign-in?error=exchange", { headers: { "Set-Cookie": clear } });
  }
}

/**
 * A coarse family, not the user-agent string.
 *
 * Enough to show "Firefox on Linux" in a session list and to notice a session that
 * moved platform; not enough to fingerprint anybody. Plan §17: collect what the
 * feature needs and nothing more.
 */
function userAgentFamily(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Firefox/.test(userAgent)
    ? "Firefox"
    : /Edg\//.test(userAgent)
      ? "Edge"
      : /Chrome/.test(userAgent)
        ? "Chrome"
        : /Safari/.test(userAgent)
          ? "Safari"
          : "Other";
  const platform = /Windows/.test(userAgent)
    ? "Windows"
    : /Mac OS/.test(userAgent)
      ? "macOS"
      : /Linux|X11/.test(userAgent)
        ? "Linux"
        : /Android/.test(userAgent)
          ? "Android"
          : /iPhone|iPad/.test(userAgent)
            ? "iOS"
            : "Other";
  return `${browser} on ${platform}`;
}

function cookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

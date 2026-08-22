import { redirect } from "react-router";
import { clearSessionCookie, revokeSession } from "@devyou/auth";
import type { Route } from "./+types/sign-out";
import { cloudflareContext } from "../context/cloudflare";
import { guardOrigin, sessionTokenFrom } from "../lib/auth.server";

/**
 * Sign out.
 *
 * POST only, and origin-checked. A GET sign-out can be triggered by any page that
 * embeds an image pointing at it, which is a small nuisance rather than a
 * vulnerability — but it is a free one to close, and a link prefetcher would
 * otherwise sign people out for reading.
 *
 * The session is revoked server-side as well as cleared client-side. Clearing the
 * cookie alone leaves a live token in the database that a copy of it would still
 * authenticate.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  guardOrigin(request, env);

  const token = sessionTokenFrom(request);
  if (token) await revokeSession(env.DB, token);

  return redirect("/", { headers: { "Set-Cookie": clearSessionCookie() } });
}

export function loader() {
  return redirect("/");
}

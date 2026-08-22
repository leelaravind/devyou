import { createRequestHandler, RouterContextProvider } from "react-router";
import { ApiError, newCspNonce, withSecurityHeaders } from "@devyou/core";
import { accessContext } from "../app/context/access";
import { cloudflareContext } from "../app/context/cloudflare";
import { nonceContext } from "../app/context/nonce";
import { verifyAccessJwt } from "../app/lib/access.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/**
 * The admin Worker boundary.
 *
 * Three things happen here and nowhere else, and each is here rather than in a route
 * because a route can be added by somebody in a hurry.
 *
 * **1. The Cloudflare Access assertion is verified before anything else runs.** Not
 * before the loaders — before the router. Nothing downstream can observe a request that
 * did not present a valid assertion for this exact Access application, which means no
 * route can forget, no static asset can slip past, and no error page can render against
 * an unauthenticated request. The verified identity is put into the request context;
 * routes read it from there and never re-derive it.
 *
 * **2. Static assets are served through this function.** `assets.run_worker_first` is
 * set in `wrangler.jsonc` precisely so the asset router does not answer first. Without
 * it, the admin JavaScript bundle would be served by code that never checked the
 * assertion — a second layer that covers the HTML but not the script the HTML loads is
 * not a second layer.
 *
 * **3. Every response leaves with `no-store` and `noindex`.** No opt-in, no per-route
 * cache policy, no exceptions list. The public Worker has a `cachePolicyFor` function
 * because most of what it serves is identical for every reader; here nothing is, and the
 * absence of that function is the design rather than an omission.
 */
export default {
  async fetch(request, env, ctx) {
    const nonce = newCspNonce();
    const url = new URL(request.url);

    let identity;
    try {
      identity = await verifyAccessJwt(request, env);
    } catch (error) {
      return refuse(error, nonce);
    }

    /*
      Assets, after the gate and only after it.

      The path test is deliberately narrow — the build emits everything under `/assets/`
      plus a favicon — so anything else falls through to the router and gets a proper
      404 from the app rather than a bare asset miss.
    */
    if (url.pathname.startsWith("/assets/") || url.pathname === "/favicon.ico") {
      return decorate(await env.ASSETS.fetch(request), nonce);
    }

    const context = new RouterContextProvider();
    context.set(nonceContext, nonce);
    context.set(cloudflareContext, { env, ctx });
    context.set(accessContext, identity);

    return decorate(await requestHandler(request, context), nonce);
  },
} satisfies ExportedHandler<Env>;

/**
 * The headers every response carries.
 *
 * `no-store` on literally everything, content-hashed assets included. That costs a
 * re-download of the bundle on each cold navigation, which on a surface used by a
 * handful of operators is not a cost worth trading for the question "which of these
 * responses is safe to cache, and was that still true after the last change?".
 *
 * `x-robots-tag` rather than a `<meta>` tag. A meta tag only exists in an HTML document
 * that a crawler parsed; the header covers the JSON contract endpoints and the audit CSV
 * export as well. The hostname sits behind Access and should never be reachable by a
 * crawler at all — this is the layer that holds if that is ever untrue for an afternoon.
 */
function decorate(response: Response, nonce: string): Response {
  const decorated = withSecurityHeaders(response, { nonce, cache: "no-store" });
  decorated.headers.set("x-robots-tag", "noindex, nofollow, noarchive, nosnippet");
  return decorated;
}

/**
 * Refuse, in plain text, with the same headers as any other response.
 *
 * Plain text rather than the styled error boundary, because reaching the error boundary
 * would mean running the router — which is the thing that has just been refused. A
 * refusal that renders the application shell is a refusal that has already loaded the
 * application.
 *
 * The message is `publicMessage`, which for the unconfigured case names owner action
 * A0-1. That is deliberately explicit: the operator staring at this screen is the person
 * who has to go and create the Access application, and "403 Forbidden" would send them
 * looking for a bug instead.
 */
function refuse(error: unknown, nonce: string): Response {
  const apiError = ApiError.is(error)
    ? error
    : new ApiError("INTERNAL", {
        internalDetail: error instanceof Error ? error.message : "unknown access failure",
      });

  if (apiError.internalDetail) {
    console.warn("admin_access_refused", {
      code: apiError.code,
      detail: apiError.internalDetail,
    });
  }

  return decorate(
    new Response(`${apiError.publicMessage}\n`, {
      status: apiError.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
    nonce,
  );
}

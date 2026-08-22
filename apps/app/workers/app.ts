import { createRequestHandler, RouterContextProvider } from "react-router";
import {
  CACHE,
  isImmutableAsset,
  newCspNonce,
  withSecurityHeaders,
} from "@devyou/core";
import { cloudflareContext } from "../app/context/cloudflare";
import { nonceContext } from "../app/context/nonce";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/**
 * The public Worker.
 *
 * Every response leaves through here with its security headers attached and a fresh
 * CSP nonce injected. Doing it at the boundary rather than per route is the point:
 * a route can forget a `headers()` export, and the route that forgets will be the
 * one added in a hurry.
 */
export default {
  async fetch(request, env, ctx) {
    const nonce = newCspNonce();
    const url = new URL(request.url);

    const context = new RouterContextProvider();
    context.set(nonceContext, nonce);
    context.set(cloudflareContext, { env, ctx });

    const response = await requestHandler(request, context);

    return withSecurityHeaders(response, {
      nonce,
      cache: cachePolicyFor(url.pathname, response),
    });
  },
} satisfies ExportedHandler<Env>;

/**
 * How long a response may be cached, by what it is.
 *
 * Public playbook, search and technology pages are identical for every reader and
 * are exactly what an edge cache should hold — that is a cost and a latency win on
 * the routes that matter most. Everything else defaults to `no-store`, because
 * anything that could have read a session must not sit in a shared cache.
 *
 * The default is the safe one. A new route is uncached until somebody deliberately
 * adds it here, which is the correct direction for this mistake to fail in.
 */
function cachePolicyFor(pathname: string, response: Response): string {
  if (isImmutableAsset(pathname)) return CACHE.immutable;

  // Never cache an error. A cached 500 outlives the incident that caused it.
  if (!response.ok) return CACHE.private;

  if (pathname === "/robots.txt" || pathname.endsWith("/sitemap.xml") || pathname === "/llms.txt") {
    return CACHE.metadata;
  }

  const isPublicKnowledge =
    pathname === "/" ||
    pathname === "/search" ||
    pathname.startsWith("/p/") ||
    pathname.startsWith("/t/") ||
    pathname.startsWith("/playbooks");

  /*
    A diagnostic session is per-reader state, even when unauthenticated: which
    branch they took, what they observed. It shares a URL prefix with the cacheable
    playbook page, so it is excluded explicitly rather than by prefix.
  */
  const isSessionState = pathname.includes("/diagnose");

  return isPublicKnowledge && !isSessionState ? CACHE.publicKnowledge : CACHE.private;
}

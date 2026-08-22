import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

import { nonceContext } from "./context/nonce";

/**
 * The server entry, which exists for one reason: the nonce has to reach scripts
 * that `<Scripts>` does not render.
 *
 * React Router streams its hydration data through **its own inline scripts**,
 * emitted by `ServerRouter` rather than by `<Scripts>`:
 *
 * ```html
 * <script>window.__reactRouterContext.streamController.enqueue("…")</script>
 * <script>window.__reactRouterContext.streamController.close();</script>
 * ```
 *
 * Under `script-src 'self' 'nonce-…' 'strict-dynamic'` with no `'unsafe-inline'`,
 * a browser refuses those if they carry no nonce. The client entry then loads,
 * subscribes to a stream that is never enqueued and never closed, and **React never
 * hydrates**.
 *
 * That failure is silent and partial, which is what makes it worth this comment.
 * The server-rendered HTML is complete, so the page looks right. Real `<form>`
 * elements posting to real actions still work, with a full page load. What is lost
 * is every client-side behaviour: pending states, `useNavigation`, SPA navigation,
 * the diagnostic session's live region updates. No error, no console warning, and
 * invisible to any test that asserts on server-rendered HTML — and invisible in
 * development, where the CSP is not applied.
 *
 * `ServerRouter` takes a `nonce` prop for its inline scripts, and
 * `renderToReadableStream` takes one for React's own bootstrap script. Both are
 * needed; either alone leaves a script the policy refuses.
 *
 * This was diagnosed once already, on a sibling product in this network. Carrying
 * the fix in from the first commit rather than rediscovering it is the entire value
 * of having read that repository.
 */

export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  const nonce = loadContext.get(nonceContext);
  const userAgent = request.headers.get("user-agent");

  let shellRendered = false;

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
    {
      nonce,
      signal: request.signal,
      onError(error: unknown) {
        responseStatusCode = 500;
        // Errors thrown after the shell has been sent cannot change the status
        // code, and logging them twice makes a single failure look like two.
        if (shellRendered) console.error(error);
      },
    },
  );
  shellRendered = true;

  /*
    Crawlers and AI retrievers wait for the complete document.

    This matters more here than on most products. Plan §16 and the market research
    both hang on DevYou's public knowledge being retrievable, and a crawler served a
    streaming shell indexes a page with no playbook in it.
  */
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}

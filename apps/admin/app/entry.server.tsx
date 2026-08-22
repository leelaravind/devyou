import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { renderToReadableStream } from "react-dom/server";

import { nonceContext } from "./context/nonce";

/**
 * The server entry, which exists for one reason: the nonce has to reach scripts that
 * `<Scripts>` does not render.
 *
 * React Router streams its hydration data through **its own inline scripts**, emitted by
 * `ServerRouter` rather than by `<Scripts>`:
 *
 * ```html
 * <script>window.__reactRouterContext.streamController.enqueue("…")</script>
 * ```
 *
 * Under `script-src 'self' 'nonce-…' 'strict-dynamic'` with no `'unsafe-inline'`, a
 * browser refuses those if they carry no nonce. The client entry then subscribes to a
 * stream that is never enqueued and never closed, and **React never hydrates** — with no
 * error, no console warning, and complete server-rendered HTML, so the page looks right.
 *
 * On the public site that failure costs pending states and SPA navigation. Here it costs
 * something worse: every admin form is a real `<form method="post">`, so they keep
 * working, but the confirmation states, the pending indicators on a destructive action
 * and the `useNavigation` guards against a double submit all go quietly missing. An
 * operator double-clicking "Quarantine" would submit twice.
 *
 * `ServerRouter` takes a `nonce` prop for its inline scripts, and
 * `renderToReadableStream` takes one for React's own bootstrap script. Both are needed;
 * either alone leaves a script the policy refuses.
 *
 * Unlike the public Worker there is no `isbot` branch here. Nothing on this hostname is
 * ever served to a crawler — Access sits in front of it and every response carries
 * `noindex` — so waiting for `allReady` on a bot user-agent would be code that can only
 * ever run for something that should not have got this far.
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
  let shellRendered = false;

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
    {
      nonce,
      signal: request.signal,
      onError(error: unknown) {
        responseStatusCode = 500;
        // Errors thrown after the shell has been sent cannot change the status code,
        // and logging them twice makes one failure look like two.
        if (shellRendered) console.error(error);
      },
    },
  );
  shellRendered = true;

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}

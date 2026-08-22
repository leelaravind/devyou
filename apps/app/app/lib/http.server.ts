import { ApiError } from "@devyou/core";

/**
 * Turning a domain error into an HTTP response.
 *
 * `ApiError` already knows its status code, but React Router does not know about
 * `ApiError` — an error thrown from a loader or action that is not a `Response`
 * renders the error boundary as a 500. That is wrong in a way that costs more than
 * it looks: a refused cross-origin POST reported as 500 pollutes the error rate the
 * on-call alert watches, and makes a genuine outage indistinguishable from somebody
 * probing a form.
 *
 * So the translation happens here, once, at the edge of the route layer. Domain
 * code keeps throwing `ApiError` and stays free of HTTP; routes throw the result of
 * this function.
 *
 * `internalDetail` is logged and never serialised — that split is the whole reason
 * `ApiError` has two message fields.
 */
export function httpError(error: unknown): Response {
  if (ApiError.is(error)) {
    if (error.internalDetail) {
      console.warn("api_error", { code: error.code, detail: error.internalDetail });
    }
    /*
      `statusText` carries the public message, not the internal one. The root error
      boundary renders it for any non-404 status, so it is reader-facing text and is
      held to the same standard as anything else on the page.
    */
    return new Response(null, { status: error.status, statusText: error.publicMessage });
  }

  console.error("unhandled_route_error", {
    message: error instanceof Error ? error.message : "unknown",
  });
  return new Response(null, { status: 500 });
}

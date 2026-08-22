import { ApiError } from "@devyou/core";

/**
 * Turning a domain error into an HTTP response.
 *
 * The same translation the public Worker does, for the same reason: React Router
 * surfaces a thrown non-`Response` as a 500, so a refused cross-origin POST or a
 * capability denial would land in the error rate the on-call alert watches and make a
 * genuine outage indistinguishable from somebody probing a form.
 *
 * One difference from the public Worker, and it is the interesting one. There,
 * `internalDetail` is logged at `warn`. Here every `ApiError` is a *governance* event —
 * an assertion that failed verification, a role that lacked a capability, an action
 * refused for want of a reason code — and each is worth reading when something has gone
 * wrong. They are still logged as detail rather than serialised: the split between
 * `publicMessage` and `internalDetail` exists so that "no such user" and "user exists,
 * you may not see them" can be logged apart and answered identically.
 */
export function httpError(error: unknown): Response {
  if (ApiError.is(error)) {
    if (error.internalDetail) {
      console.warn("admin_refused", { code: error.code, detail: error.internalDetail });
    }
    return new Response(null, { status: error.status, statusText: error.publicMessage });
  }

  console.error("unhandled_admin_route_error", {
    message: error instanceof Error ? error.message : "unknown",
  });
  return new Response(null, { status: 500 });
}

/**
 * A JSON response for the contract endpoints.
 *
 * `no-store` is set here as well as at the Worker boundary. The boundary is the
 * guarantee; this is so the header is visible at the place a reader of this route asks
 * "is this cached?", rather than requiring them to go and check.
 */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

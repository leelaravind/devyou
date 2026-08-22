import type { RouterContextProvider } from "react-router";
import { ApiError } from "@devyou/core";
import type { Capability } from "@devyou/auth";
import { accessContext } from "../context/access";
import { cloudflareContext } from "../context/cloudflare";
import {
  requireActor,
  requireCapability,
  requireSameOrigin,
  type AdminActor,
} from "./perimeter.server";
import { httpError } from "./http.server";

/**
 * React Router hands a loader and an action a `Readonly<RouterContextProvider>` — reads
 * only, because a route setting request context would be mutating state the Worker
 * boundary owns. The helpers below take that read-only view rather than the class, which
 * is what they need and all they should have.
 */
type RequestContext = Readonly<RouterContextProvider>;

/**
 * The line every admin route starts with.
 *
 * There is exactly one way into a loader and one way into an action, and neither returns
 * an `env` until the operator has been resolved. `requireAdmin` additionally takes the
 * capability as a required argument, so a *read* surface cannot obtain a database handle
 * without naming what it intends to read — forgetting that check is not an omission
 * somebody has to spot in review, it is a route that does not compile. Actions gate one
 * step later, at `performAdminAction`; see the note on `beginAdminAction` for why, and for
 * what keeps that equivalent.
 *
 * Both throw `Response`, not `ApiError`. React Router renders a thrown non-`Response` as an
 * unhandled 500, which would report a capability refusal as a server fault and pollute the
 * error rate an on-call alert watches; see `http.server.ts`.
 */

export interface AdminRequestContext {
  env: Env;
  ctx: ExecutionContext;
  actor: AdminActor;
}

/** For a loader: read-only, no origin check (a GET carries no state change to forge). */
export async function requireAdmin(
  context: RequestContext,
  capability: Capability,
): Promise<AdminRequestContext> {
  const { env, ctx } = context.get(cloudflareContext);
  const identity = context.get(accessContext);

  if (!identity) {
    /*
      Unreachable through the Worker boundary, which verifies the assertion before the
      request handler runs and populates this context from the result.

      Kept because "unreachable" is a property of today's `workers/app.ts`. If a future
      change routes a request to the handler by some other path — a second entrypoint, a
      service binding, a test harness that constructs its own context — this is what
      stops that path from being an unauthenticated one. It is cheap, and the failure it
      prevents is total.
    */
    throw httpError(
      new ApiError("UNAUTHENTICATED", {
        internalDetail: "route reached with no verified Access identity in context",
      }),
    );
  }

  try {
    const actor = await requireActor(env.DB, identity);
    requireCapability(actor, capability);
    return { env, ctx, actor };
  } catch (error) {
    throw httpError(error);
  }
}

/**
 * For an action.
 *
 * Same-origin first, then the operator — and, unlike the loader helper, **no capability
 * argument**. That difference is deliberate and worth stating, because it looks like a
 * gap.
 *
 * Every surface here offers more than one operation on the same row — resolve *or*
 * escalate, suspend *or* set a role — and React Router gives a route one `action`. Which
 * capability applies is not known until the submitted `intent` has been read, and reading
 * the body cannot be made conditional on a capability that depends on the body.
 *
 * So this resolves the operator and the form and stops. It is safe for one reason: the
 * only code in this Worker that writes to D1 is `performAdminAction`, which takes the
 * capability as a required argument and calls `requireCapability` before it constructs a
 * statement. The chokepoint moves from the door to the till; it does not disappear.
 * `admin-surfaces.node.test.ts` asserts that no route file issues a write of its own, which
 * is what keeps that true.
 *
 * The origin check lives here rather than at the Worker boundary because it only applies
 * to state-changing methods, and the boundary would have to re-derive which those are.
 * Access issues its own `CF_Authorization` cookie, so a cross-site POST to this hostname
 * arrives already past the outer gate: Access authenticates the browser, not the intent.
 */
export async function beginAdminAction(
  request: Request,
  context: RequestContext,
): Promise<AdminRequestContext & { form: FormData; intent: string }> {
  const { env, ctx } = context.get(cloudflareContext);

  try {
    requireSameOrigin(request, env);
  } catch (error) {
    throw httpError(error);
  }

  const identity = context.get(accessContext);
  if (!identity) {
    throw httpError(
      new ApiError("UNAUTHENTICATED", {
        internalDetail: "action reached with no verified Access identity in context",
      }),
    );
  }

  let actor: AdminActor;
  try {
    actor = await requireActor(env.DB, identity);
  } catch (error) {
    throw httpError(error);
  }

  const form = await request.formData();
  const intent = form.get("intent");

  return { env, ctx, actor, form, intent: typeof intent === "string" ? intent : "" };
}

/**
 * Run an action body, translating any domain error into a response.
 *
 * Actions throw `ApiError` from three layers — the reason-code check, the capability
 * check, and D1 itself when an invariant trigger rejects a statement. That last one
 * matters: an admin who contrives a request that would mutate a published revision gets
 * a database refusal, and it must surface as a refusal rather than as a 500 that reads
 * like a bug in the trigger.
 */
export async function runAction<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof Response) throw error;
    throw httpError(error);
  }
}

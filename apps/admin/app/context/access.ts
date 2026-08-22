import { createContext } from "react-router";
import type { AccessIdentity } from "../lib/access.server";

/**
 * The verified Cloudflare Access identity for this request.
 *
 * Populated by `workers/app.ts` *after* the assertion has been verified, and only then.
 * A loader reading this context is reading a fact, not a claim, which is why the
 * default is `null` rather than an empty identity object: a route that somehow runs
 * without the boundary having populated it must see an obvious absence, not a plausible
 * blank identity that a truthy check would let through.
 */
export const accessContext = createContext<AccessIdentity | null>(null);

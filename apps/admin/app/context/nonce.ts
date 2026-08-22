import { createContext } from "react-router";

/**
 * The Content-Security-Policy nonce for this request.
 *
 * Set by the Worker on the way in and read in two places: `root.tsx`, for the script
 * tags React Router renders, and `entry.server.tsx`, for the inline hydration scripts
 * React Router streams. Both need it — see the comment in `entry.server.tsx` for what
 * breaks, silently, when only one gets it.
 */
export const nonceContext = createContext<string>("");

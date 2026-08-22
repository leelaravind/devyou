import { createContext } from "react-router";

/** The Worker environment and execution context, for loaders and actions. */
export const cloudflareContext = createContext<{ env: Env; ctx: ExecutionContext }>();

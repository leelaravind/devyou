import { type RouteConfig, index, route } from "@react-router/dev/routes";

/**
 * Routes.
 *
 * The URL shape is part of the product, not an implementation detail. Plan §16
 * requires stable canonical URLs that a future read API can expose with the same
 * ids, so `/p/:slug` and `/p/:slug/r/:revision` are contracts rather than
 * conveniences — a playbook's address must survive every later revision of it.
 */
export default [
  index("routes/home.tsx"),
  route("healthz", "routes/healthz.ts"),
] satisfies RouteConfig;

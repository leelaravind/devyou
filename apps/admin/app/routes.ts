import { type RouteConfig, index, route } from "@react-router/dev/routes";

/**
 * Routes.
 *
 * Flat and short, on purpose. Each surface is one route that lists its subject and, when
 * given `?focus=<id>`, renders the detail and the actions for one row beside the list.
 * The alternative — a list route and a detail route per surface — doubles the file count
 * and, more importantly, doubles the number of places that have to remember to check a
 * capability. Twelve surfaces with one perimeter call each is a set somebody can audit
 * by reading; twenty-four is not.
 *
 * `/api/v1/*` are the `@devyou/admin-contract` endpoints. They sit behind exactly the
 * same Access gate and the same capability checks as everything else — a contract
 * endpoint that skipped the perimeter "because a machine calls it" would be the hole,
 * not the feature. ADR-0001: the contract is published outward; it is not a back door
 * inward.
 */
export default [
  index("routes/overview.tsx"),

  route("moderation", "routes/moderation.tsx"),
  route("evidence", "routes/evidence.tsx"),
  route("playbooks", "routes/playbooks.tsx"),
  route("proposals", "routes/proposals.tsx"),
  route("contributors", "routes/contributors.tsx"),
  route("claims", "routes/claims.tsx"),
  route("taxonomy", "routes/taxonomy.tsx"),
  route("search-quality", "routes/search-quality.tsx"),
  route("ai", "routes/ai.tsx"),
  route("flags", "routes/flags.tsx"),
  route("audit", "routes/audit.tsx"),
  route("health", "routes/health.tsx"),

  /*
    Exporting the audit log is itself an audited action — `audit:export` is in
    `REQUIRES_REASON`. It is a POST rather than a GET for that reason: a downloadable
    link would be followed by a prefetching browser, and the resulting audit row would
    record an export nobody performed.
  */
  route("audit/export", "routes/audit.export.ts"),

  route("api/v1/product", "routes/api.v1.product.ts"),
  route("api/v1/health", "routes/api.v1.health.ts"),
  route("api/v1/capabilities", "routes/api.v1.capabilities.ts"),
] satisfies RouteConfig;

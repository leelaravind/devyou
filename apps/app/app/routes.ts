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
  route("search", "routes/search.tsx"),

  /*
    `/p/:slug` is the canonical playbook address and `/p/:slug/r/:revision` is a
    permanent one. Plan §9 requires historical URLs to keep working, so a revision
    URL must resolve for as long as the revision exists — including after it is
    superseded or deprecated, because a 404 there destroys the evidence trail that
    justified the change.
  */
  route("p/:slug", "routes/p.$slug.tsx"),
  route("p/:slug/diagnose", "routes/p.$slug.diagnose.tsx"),
  route("p/:slug/evidence", "routes/p.$slug.evidence.tsx"),
  route("p/:slug/history", "routes/p.$slug.history.tsx"),
  route("p/:slug/r/:revision", "routes/p.$slug.r.$revision.tsx"),

  /*
    The reproduction report and the change proposal.

    Both are separate routes rather than modals on the diagnostic page, and both are
    GET-then-POST rather than one click. R-31 puts the whole reporting flow inside
    10-30 seconds, which is achieved by prefilling the environment — not by removing
    the step where the reader states what actually happened.
  */
  route("p/:slug/report", "routes/p.$slug.report.tsx"),
  route("p/:slug/propose", "routes/p.$slug.propose.tsx"),

  route("t/:slug", "routes/t.$slug.tsx"),
  route("playbooks", "routes/playbooks.tsx"),
  route("environment", "routes/environment.tsx"),

  route("robots.txt", "routes/robots.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),
  route("healthz", "routes/healthz.ts"),
] satisfies RouteConfig;

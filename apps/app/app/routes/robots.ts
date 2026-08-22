import type { Route } from "./+types/robots";
import { CACHE } from "@devyou/core";
import { cloudflareContext } from "../context/cloudflare";

/**
 * robots.txt.
 *
 * AI crawlers are deliberately **not** blocked here, and that is a choice rather than
 * an oversight. Plan §16 and the market research both treat machine retrievability as
 * a goal, not a threat: a troubleshooting answer that a model can retrieve and cite is
 * exactly the kind of reach this product wants, the same way a documentation site
 * wants to rank. Adding `GPTBot`/`ClaudeBot`/etc. disallows here would not protect
 * anything real — the asset this product is actually built on is the interactive
 * diagnostic layer: branching tests, "tell us what you actually observed", evidence
 * tied to a specific revision. None of that is reproduced by crawling static HTML. A
 * scraped page is a paragraph; a session here is a conversation with evidence behind
 * it. So the mitigation for extraction is that the interactive layer is where the
 * value is, not a robots rule — a rule here would only cost search and citation
 * visibility, for no protection that actually holds.
 *
 * `/search` is excluded for the same reason its own route sets `noindex`: a results
 * page keyed by a user's pasted query is a doorway page, and a corpus of them reads as
 * spam to the same search engines this product's reach depends on. `/contribute` is a
 * form, not content. `/api/` serves data, not pages. Query-string URLs are excluded so
 * a crawler cannot generate infinite near-duplicate paths out of filter parameters
 * (see `?tech=` on `/playbooks`).
 */
export function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  /*
    No `Crawl-delay`. It only matters for crawlers that honour it, and the corpus this
    site serves — a few hundred playbooks and technologies, not millions — is nowhere
    near large enough for even an unthrottled full crawl to threaten D1 read capacity
    or the edge cache. Adding a delay with no load problem to justify it would only
    slow down honest indexing.
  */
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /search",
    "Disallow: /contribute",
    "Disallow: /api/",
    "Disallow: /*?*",
    "",
    `Sitemap: ${env.PUBLIC_APP_URL}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": CACHE.metadata,
    },
  });
}

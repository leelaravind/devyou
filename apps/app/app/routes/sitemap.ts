import type { Route } from "./+types/sitemap";
import { CACHE, PUBLICLY_READABLE_STATUSES } from "@devyou/core";
import { cloudflareContext } from "../context/cloudflare";

/**
 * sitemap.xml.
 *
 * Lists exactly the pages that are actually indexable: the home page, the playbook
 * index, every publicly readable playbook's *current* revision, and every technology
 * with at least one such playbook. "Publicly readable" is `PUBLICLY_READABLE_STATUSES`
 * — it deliberately includes `deprecated` and `superseded`, because plan §9 keeps
 * those readable at their stable `/p/:slug` URL, and a sitemap that omitted them would
 * be telling crawlers to forget a page this site still serves at 200.
 *
 * Capped at 5000 URLs — the sitemap protocol's own hard limit, not a DevYou-specific
 * choice. A corpus that grows past it needs a sitemap *index* pointing at several
 * sub-sitemaps split by type (playbooks, technologies) — plan §16. Nothing here builds
 * that split yet, because nothing here is remotely close to 5000 URLs; the cap is
 * still enforced so the response can never silently become an invalid file if that
 * changes before the split is built.
 */
const MAX_URLS = 5000;
const STATIC_PATHS = ["/", "/playbooks"];

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const statusPlaceholders = PUBLICLY_READABLE_STATUSES.map((_, index) => `?${index + 1}`).join(", ");

  const [playbookRows, technologyRows] = await Promise.all([
    env.DB.prepare(
      `SELECT p.slug AS slug, r.published_at AS published_at
       FROM playbooks p
       JOIN playbook_revisions r ON r.id = p.current_revision_id
       WHERE r.published_at IS NOT NULL AND r.status IN (${statusPlaceholders})
       ORDER BY r.published_at DESC`,
    )
      .bind(...PUBLICLY_READABLE_STATUSES)
      .all<SitemapRow>(),
    env.DB.prepare(
      `SELECT t.slug AS slug, MAX(r.published_at) AS published_at
       FROM technologies t
       JOIN revision_technologies rt ON rt.technology_id = t.id
       JOIN playbook_revisions r ON r.id = rt.revision_id
       JOIN playbooks p ON p.id = r.playbook_id AND p.current_revision_id = r.id
       WHERE r.published_at IS NOT NULL AND r.status IN (${statusPlaceholders})
       GROUP BY t.id
       ORDER BY published_at DESC`,
    )
      .bind(...PUBLICLY_READABLE_STATUSES)
      .all<SitemapRow>(),
  ]);

  let budget = MAX_URLS - STATIC_PATHS.length;
  const playbookEntries = playbookRows.results.slice(0, Math.max(budget, 0));
  budget -= playbookEntries.length;
  const technologyEntries = technologyRows.results.slice(0, Math.max(budget, 0));

  const entries = [
    ...STATIC_PATHS.map((path) => urlTag(`${env.PUBLIC_APP_URL}${path}`)),
    ...playbookEntries.map((row) => urlTag(`${env.PUBLIC_APP_URL}/p/${row.slug}`, row.published_at)),
    ...technologyEntries.map((row) => urlTag(`${env.PUBLIC_APP_URL}/t/${row.slug}`, row.published_at)),
  ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": CACHE.metadata,
    },
  });
}

interface SitemapRow {
  slug: string;
  published_at: number;
}

function urlTag(loc: string, publishedAtSeconds?: number): string {
  const lastmod = publishedAtSeconds
    ? `\n    <lastmod>${toW3CDateTime(publishedAtSeconds)}</lastmod>`
    : "";
  return `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmod}\n  </url>`;
}

/** Unix seconds to a W3C datetime string, without the milliseconds `toISOString`
 *  appends — the sitemap protocol's own examples use whole-second precision. */
function toW3CDateTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

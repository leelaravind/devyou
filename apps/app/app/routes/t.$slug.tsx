import { Link } from "react-router";
import { Card, ConfidenceBadge, Icon, Page, Tag } from "@devyou/ui";
import {
  CACHE,
  isPubliclyReadable,
  type ConfidenceBand,
  type PlaybookStatus,
  type TechnologyType,
} from "@devyou/core";
import type { Route } from "./+types/t.$slug";
import { cloudflareContext } from "../context/cloudflare";

/**
 * A technology's page: what it is, the playbooks that cover it, and the versions this
 * catalogue knows about.
 *
 * Fully server-rendered and indexable — unlike `/search`, this content is identical
 * for every reader and every crawler, which is exactly what makes it worth indexing
 * (plan §16): a stable per-technology page is a far stronger citation surface than a
 * search-results page keyed by somebody's pasted error ever is.
 */

const TYPE_LABEL: Record<TechnologyType, string> = {
  language: "Language",
  runtime: "Runtime",
  framework: "Framework",
  database: "Database",
  cloud: "Cloud",
  os: "Operating system",
  tool: "Tool",
  library: "Library",
  service: "Service",
};

export function meta({ loaderData }: Route.MetaArgs) {
  const { technology } = loaderData;
  const title = `${technology.name} — DEV.ITISYOU`;
  const description = `Version-aware diagnostic playbooks for ${technology.name}, each carrying the evidence of what has and hasn't actually worked.`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
  ];
}

export function headers(_: Route.HeadersArgs) {
  // Identical for every reader — nothing on this page depends on a cookie or a query.
  return { "cache-control": CACHE.publicKnowledge };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  const technologyRow = await env.DB.prepare(
    `SELECT id, slug, name, type, official_url FROM technologies WHERE slug = ?1`,
  )
    .bind(params.slug)
    .first<TechnologyRow>();

  /*
    404, not a soft "no such technology" page. Plan §16's stable-URL contract is only
    worth having for real technologies; a technology page with nothing behind it is not
    a page anybody should link to or a crawler should index.
  */
  if (!technologyRow) throw new Response(null, { status: 404 });

  const [playbookRows, versionRows] = await Promise.all([
    env.DB.prepare(
      `SELECT p.slug AS playbook_slug, r.id AS revision_id, r.title, r.summary, r.status, r.published_at
       FROM revision_technologies rt
       JOIN playbook_revisions r ON r.id = rt.revision_id
       JOIN playbooks p ON p.id = r.playbook_id AND p.current_revision_id = r.id
       WHERE rt.technology_id = ?1
       ORDER BY r.published_at DESC`,
    )
      .bind(technologyRow.id)
      .all<PlaybookRow>(),
    env.DB.prepare(
      `SELECT id, version_label, status, released_at, eol_at
       FROM versions
       WHERE technology_id = ?1
       ORDER BY semver_normalized DESC`,
    )
      .bind(technologyRow.id)
      .all<VersionRow>(),
  ]);

  /*
    Publicly readable is checked in code, not folded into the SQL's WHERE clause — it
    is the exact same rule `loadRevisionBySlug` uses in `app/lib/playbook.server.ts`.
    Keeping it as one JS predicate rather than a second, separately maintained status
    list is what stops the two ever silently drifting apart.
  */
  const published = playbookRows.results.filter(
    (row) => row.published_at !== null && isPubliclyReadable(row.status as PlaybookStatus),
  );

  const ids = published.map((row) => row.revision_id);
  const confidenceByRevision = new Map<string, ConfidenceRow>();
  if (ids.length > 0) {
    const placeholders = ids.map((_, index) => `?${index + 1}`).join(", ");
    const confidenceRows = await env.DB.prepare(
      `SELECT revision_id, band, reproduced_passed, reproduced_partial, reproduced_failed,
              unique_environments
       FROM revision_confidence WHERE revision_id IN (${placeholders})`,
    )
      .bind(...ids)
      .all<ConfidenceRow>();
    for (const row of confidenceRows.results) confidenceByRevision.set(row.revision_id, row);
  }

  return {
    technology: {
      slug: technologyRow.slug,
      name: technologyRow.name,
      type: technologyRow.type as TechnologyType,
      officialUrl: technologyRow.official_url,
    },
    playbooks: published.map((row) => {
      const confidence = confidenceByRevision.get(row.revision_id);
      return {
        slug: row.playbook_slug,
        title: row.title,
        summary: row.summary,
        band: (confidence?.band ?? "unverified") as ConfidenceBand,
        reproducedPassed: confidence?.reproduced_passed ?? 0,
        reproducedPartial: confidence?.reproduced_partial ?? 0,
        reproducedFailed: confidence?.reproduced_failed ?? 0,
        uniqueEnvironments: confidence?.unique_environments ?? 0,
      };
    }),
    versions: versionRows.results.map((row) => ({
      id: row.id,
      label: row.version_label,
      status: row.status,
      releasedAt: row.released_at,
      eolAt: row.eol_at,
    })),
  };
}

export default function TechnologyPage({ loaderData }: Route.ComponentProps) {
  const { technology, playbooks, versions } = loaderData;

  return (
    <Page className="gap-8">
      <header>
        <Tag tone="neutral" className="mb-2">
          {TYPE_LABEL[technology.type]}
        </Tag>
        <h1 className="mb-2 font-headline text-headline-lg text-on-surface">{technology.name}</h1>
        {technology.officialUrl && (
          <a
            href={technology.officialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-body-sm text-evidence-blue underline"
          >
            <Icon name="link" size={14} />
            Official site
          </a>
        )}
      </header>

      <section aria-labelledby="playbooks-heading">
        <h2
          id="playbooks-heading"
          className="mb-gutter font-headline text-headline-md text-on-surface"
        >
          Playbooks for {technology.name}
        </h2>
        {playbooks.length === 0 ? (
          <Card as="section">
            <p className="text-body-sm text-on-surface-variant">
              No playbooks reference {technology.name} yet.{" "}
              <Link to="/contribute" className="text-evidence-blue underline">
                Write the first one
              </Link>
              .
            </p>
          </Card>
        ) : (
          <ol className="flex list-none flex-col gap-gutter">
            {playbooks.map((playbook) => (
              <li key={playbook.slug}>
                <Card as="article" interactive>
                  <h3 className="mb-1 font-headline text-body-md font-semibold text-on-surface">
                    <Link to={`/p/${playbook.slug}`} className="hover:underline">
                      {playbook.title}
                    </Link>
                  </h3>
                  <p className="mb-3 text-body-sm text-on-surface-variant">{playbook.summary}</p>
                  <ConfidenceBadge
                    band={playbook.band}
                    counts={{
                      reproducedPassed: playbook.reproducedPassed,
                      reproducedFailed: playbook.reproducedFailed,
                      reproducedPartial: playbook.reproducedPartial,
                      uniqueEnvironments: playbook.uniqueEnvironments,
                    }}
                    explainHref={`/p/${playbook.slug}/evidence`}
                    size="sm"
                  />
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="versions-heading">
        <h2
          id="versions-heading"
          className="mb-gutter font-headline text-headline-md text-on-surface"
        >
          Versions
        </h2>
        {versions.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">No versions recorded yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {versions.map((version) => (
              <li key={version.id}>
                <Tag tone="neutral" className={version.status !== "active" ? "opacity-60" : undefined}>
                  {version.label}
                  {version.status !== "active" && ` · ${version.status}`}
                </Tag>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}

interface TechnologyRow {
  id: string;
  slug: string;
  name: string;
  type: string;
  official_url: string | null;
}

interface PlaybookRow {
  playbook_slug: string;
  revision_id: string;
  title: string;
  summary: string;
  status: string;
  published_at: number | null;
}

interface ConfidenceRow {
  revision_id: string;
  band: string;
  reproduced_passed: number;
  reproduced_partial: number;
  reproduced_failed: number;
  unique_environments: number;
}

interface VersionRow {
  id: string;
  version_label: string;
  status: string;
  released_at: number | null;
  eol_at: number | null;
}

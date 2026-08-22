import { Link } from "react-router";
import { Card, ConfidenceBadge, Icon, Page, Tag } from "@devyou/ui";
import { CACHE, type ConfidenceBand } from "@devyou/core";
import type { Route } from "./+types/playbooks";
import { cloudflareContext } from "../context/cloudflare";

/**
 * The browsable playbook index.
 *
 * Deliberately not the landing page — home.tsx is a search intake surface, per R-41's
 * warning against resembling a feed. This exists because not every reader arrives
 * with an error to paste; some are browsing what a technology has coverage for at all.
 *
 * Only a playbook's *current* revision is listed, and only when that revision is
 * `published` or `needs_reverification`. A `deprecated` or `superseded` current
 * revision stays reachable at its stable `/p/:slug` URL (plan §9) — it just is not
 * something this directory actively points a browsing reader toward.
 */

const LISTED_STATUSES = ["published", "needs_reverification"] as const;

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Playbooks — DEV.ITISYOU" },
    {
      name: "description",
      content:
        "Browse version-aware diagnostic playbooks. Every entry shows the reproduction counts behind its confidence band, never a bare percentage.",
    },
  ];
}

export function headers(_: Route.HeadersArgs) {
  // Identical for every reader — nothing on this page depends on a cookie or a query.
  return { "cache-control": CACHE.publicKnowledge };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const url = new URL(request.url);
  const techSlug = url.searchParams.get("tech");

  const playbookRows = techSlug
    ? await env.DB.prepare(
        `SELECT p.slug AS playbook_slug, r.id AS revision_id, r.title, r.summary, r.published_at
         FROM playbooks p
         JOIN playbook_revisions r ON r.id = p.current_revision_id
         JOIN revision_technologies rt ON rt.revision_id = r.id
         JOIN technologies t ON t.id = rt.technology_id
         WHERE r.status IN (?1, ?2) AND t.slug = ?3
         ORDER BY r.published_at DESC`,
      )
        .bind(...LISTED_STATUSES, techSlug)
        .all<PlaybookRow>()
    : await env.DB.prepare(
        `SELECT p.slug AS playbook_slug, r.id AS revision_id, r.title, r.summary, r.published_at
         FROM playbooks p
         JOIN playbook_revisions r ON r.id = p.current_revision_id
         WHERE r.status IN (?1, ?2)
         ORDER BY r.published_at DESC`,
      )
        .bind(...LISTED_STATUSES)
        .all<PlaybookRow>();

  const ids = playbookRows.results.map((row) => row.revision_id);
  const placeholders = placeholderList(ids.length);

  const [confidenceRows, technologyRows, filterRows] = await Promise.all([
    ids.length > 0
      ? env.DB.prepare(
          `SELECT revision_id, band, reproduced_passed, reproduced_partial, reproduced_failed,
                  unique_environments
           FROM revision_confidence WHERE revision_id IN (${placeholders})`,
        )
          .bind(...ids)
          .all<ConfidenceRow>()
      : { results: [] as ConfidenceRow[] },
    ids.length > 0
      ? env.DB.prepare(
          `SELECT rt.revision_id, t.slug, t.name, t.type
           FROM revision_technologies rt
           JOIN technologies t ON t.id = rt.technology_id
           WHERE rt.revision_id IN (${placeholders})
           ORDER BY t.name`,
        )
          .bind(...ids)
          .all<TechRow>()
      : { results: [] as TechRow[] },
    env.DB.prepare(
      `SELECT t.slug, t.name, COUNT(*) AS playbook_count
       FROM playbooks p
       JOIN playbook_revisions r ON r.id = p.current_revision_id
       JOIN revision_technologies rt ON rt.revision_id = r.id
       JOIN technologies t ON t.id = rt.technology_id
       WHERE r.status IN (?1, ?2)
       GROUP BY t.id
       ORDER BY playbook_count DESC, t.name
       LIMIT 24`,
    )
      .bind(...LISTED_STATUSES)
      .all<{ slug: string; name: string; playbook_count: number }>(),
  ]);

  const confidenceByRevision = new Map(confidenceRows.results.map((row) => [row.revision_id, row]));
  const technologiesByRevision = new Map<string, Array<{ slug: string; name: string; type: string }>>();
  for (const row of technologyRows.results) {
    const list = technologiesByRevision.get(row.revision_id) ?? [];
    list.push({ slug: row.slug, name: row.name, type: row.type });
    technologiesByRevision.set(row.revision_id, list);
  }

  const playbooks = playbookRows.results.map((row) => {
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
      technologies: technologiesByRevision.get(row.revision_id) ?? [],
    };
  });

  return {
    playbooks,
    activeTechSlug: techSlug,
    filterTechnologies: filterRows.results.map((row) => ({
      slug: row.slug,
      name: row.name,
      count: row.playbook_count,
    })),
  };
}

export default function Playbooks({ loaderData }: Route.ComponentProps) {
  const { playbooks, activeTechSlug, filterTechnologies } = loaderData;
  const activeFilterName = filterTechnologies.find((tech) => tech.slug === activeTechSlug)?.name;

  return (
    <Page className="gap-8">
      <header>
        <h1 className="mb-2 font-headline text-headline-lg text-on-surface">Playbooks</h1>
        <p className="max-w-2xl text-body-sm text-on-surface-variant">
          Every entry here is a current, published revision, shown with the reproduction counts
          behind its confidence band — never a bare percentage.
        </p>
      </header>

      {filterTechnologies.length > 0 && (
        <nav aria-label="Filter by technology" className="flex flex-wrap gap-2">
          {filterTechnologies.map((tech) => {
            const isActive = tech.slug === activeTechSlug;
            return (
              <Link
                key={tech.slug}
                to={isActive ? "/playbooks" : `/playbooks?tech=${encodeURIComponent(tech.slug)}`}
                aria-current={isActive ? "true" : undefined}
                className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-env-tag transition-colors ${
                  isActive
                    ? "border-evidence-blue text-evidence-blue"
                    : "border-outline-variant text-on-surface-variant hover:border-outline hover:text-on-surface"
                }`}
              >
                {isActive && <Icon name="check" size={12} />}
                {tech.name}
                <span className="opacity-70">({tech.count})</span>
              </Link>
            );
          })}
        </nav>
      )}

      {playbooks.length === 0 ? (
        <Card as="section" className="text-center">
          <Icon name="search" size={24} className="mx-auto mb-3 text-on-surface-variant" />
          <h2 className="mb-2 font-headline text-headline-md text-on-surface">
            {activeFilterName ? `Nothing filed for ${activeFilterName} yet` : "Nothing published yet"}
          </h2>
          {/*
            Plain, not apologetic. R-4's spirit extended to prose: a thin corpus stated
            honestly as a design choice is more trustworthy than one dressed up as a
            temporary gap.
          */}
          <p className="mx-auto mb-4 max-w-md text-body-sm text-on-surface-variant">
            Coverage here is deliberately narrow and deep, not broad and thin — a handful of
            thoroughly evidenced playbooks beats a directory that has heard of everything and
            tested nothing.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {activeTechSlug && (
              <Link to="/playbooks" className="text-body-sm text-evidence-blue underline">
                Clear filter
              </Link>
            )}
            <Link
              to="/contribute"
              className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 font-mono text-label-caps uppercase text-on-primary"
            >
              <Icon name="add" size={14} />
              Contribute one
            </Link>
          </div>
        </Card>
      ) : (
        <ol className="flex list-none flex-col gap-gutter">
          {playbooks.map((playbook) => (
            <li key={playbook.slug}>
              <Card as="article" interactive>
                <h2 className="mb-1 font-headline text-body-md font-semibold text-on-surface">
                  <Link to={`/p/${playbook.slug}`} className="hover:underline">
                    {playbook.title}
                  </Link>
                </h2>
                <p className="mb-3 text-body-sm text-on-surface-variant">{playbook.summary}</p>
                {playbook.technologies.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {playbook.technologies.slice(0, 4).map((technology) => (
                      <Tag key={technology.slug} tone={toneFor(technology.type)}>
                        {technology.name}
                      </Tag>
                    ))}
                  </div>
                )}
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
    </Page>
  );
}

function toneFor(type: string): "neutral" | "os" | "runtime" | "framework" {
  if (type === "os") return "os";
  if (type === "runtime" || type === "language") return "runtime";
  if (type === "framework" || type === "library") return "framework";
  return "neutral";
}

function placeholderList(count: number): string {
  return Array.from({ length: count }, (_, index) => `?${index + 1}`).join(", ");
}

interface PlaybookRow {
  playbook_slug: string;
  revision_id: string;
  title: string;
  summary: string;
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

interface TechRow {
  revision_id: string;
  slug: string;
  name: string;
  type: string;
}

import { Link } from "react-router";
import { Card, Icon, Tag } from "@devyou/ui";
import type { Route } from "./+types/p.$slug.history";
import { cloudflareContext } from "../context/cloudflare";

/**
 * Revision history.
 *
 * Every publicly readable revision of the playbook, newest first, each carrying its
 * own evidence count. The count is the point: it is not the same number on every
 * row, and it should not be — see the explanation below the heading.
 */

export function meta({ loaderData: data }: Route.MetaArgs) {
  if (!data) return [{ title: "Not found — DEV.ITISYOU" }];
  const latest = data.revisions[0];
  return [
    { title: latest ? `Revision history — ${latest.title} — DEV.ITISYOU` : "Revision history — DEV.ITISYOU" },
    {
      name: "description",
      content: "Every revision of this playbook, with the evidence recorded against each one.",
    },
  ];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  const playbook = await env.DB.prepare(
    `SELECT id, slug, current_revision_id FROM playbooks WHERE slug = ?1`,
  )
    .bind(params.slug)
    .first<{ id: string; slug: string; current_revision_id: string | null }>();

  if (!playbook) throw new Response(null, { status: 404 });

  /*
    Publicly readable statuses only — the same set `loadRevisionBySlug` gates on in
    `app/lib/playbook.server.ts`. A draft mid-edit is not history yet; it is work in
    progress that happens to share a playbook with published revisions.
  */
  const revisionRows = await env.DB.prepare(
    `SELECT r.id, r.revision_number, r.title, r.change_summary,
            r.published_at, r.superseded_at, r.deprecated_at,
            prof.handle AS author_handle, prof.display_name AS author_display_name,
            (SELECT COUNT(*) FROM evidence_records e
             WHERE e.revision_id = r.id AND e.suppressed_at IS NULL) AS evidence_count
     FROM playbook_revisions r
     LEFT JOIN profiles prof ON prof.user_id = r.created_by
     WHERE r.playbook_id = ?1
       AND r.status IN ('published', 'needs_reverification', 'superseded', 'deprecated')
     ORDER BY r.revision_number DESC`,
  )
    .bind(playbook.id)
    .all<RevisionRow>();

  if (revisionRows.results.length === 0) throw new Response(null, { status: 404 });

  return {
    slug: playbook.slug,
    revisions: revisionRows.results.map(
      (row): RevisionSummary => ({
        revisionNumber: row.revision_number,
        title: row.title,
        changeSummary: row.change_summary,
        publishedAt: row.published_at,
        supersededAt: row.superseded_at,
        deprecatedAt: row.deprecated_at,
        authorHandle: row.author_handle,
        authorDisplayName: row.author_display_name,
        evidenceCount: row.evidence_count,
        isCurrent: row.id === playbook.current_revision_id,
      }),
    ),
  };
}

export default function History({ loaderData }: Route.ComponentProps) {
  const { slug, revisions } = loaderData;

  return (
    <main id="main" className="mx-auto flex w-full max-w-[900px] flex-col gap-margin px-margin py-8">
      <nav aria-label="Breadcrumb" className="font-mono text-env-tag text-on-surface-variant">
        <Link to={`/p/${slug}`} className="hover:underline">
          Back to the playbook
        </Link>
      </nav>

      <header className="flex flex-col gap-3">
        <h1 className="font-headline text-headline-lg text-on-surface">Revision history</h1>
      </header>

      {/*
        The thing a reader is most likely to misread as a bug, explained before the
        list that would otherwise look broken. A revision starting at "0 evidence
        records" is not the count resetting by accident — it is the count being
        honest that nobody has run the new text yet.
      */}
      <Card as="section">
        <p className="text-body-sm text-on-surface-variant">
          Evidence is bound to the exact revision it was recorded against, never to the playbook as
          a whole. When a new revision is published, none of the previous revision&rsquo;s
          reproductions carry over — not because they were wrong, but because they proved something
          about text that this page no longer shows. So when you see a revision below open with no
          reproductions at all, that is not a gap in the record. It is the record correctly stating
          that this exact wording has not been tried yet, by anyone.
        </p>
      </Card>

      <ol className="flex list-none flex-col gap-gutter">
        {revisions.map((revision) => (
          <li key={revision.revisionNumber}>
            <Card as="article">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-headline text-body-md font-semibold text-on-surface">
                  <Link to={`/p/${slug}/r/${revision.revisionNumber}`} className="hover:underline">
                    Revision {revision.revisionNumber}
                  </Link>
                  {revision.isCurrent && (
                    <Tag className="ml-2" size="sm">
                      current
                    </Tag>
                  )}
                </h2>
                {revision.publishedAt && (
                  <time
                    dateTime={new Date(revision.publishedAt * 1000).toISOString()}
                    className="font-mono text-env-tag text-on-surface-variant"
                  >
                    {formatDate(revision.publishedAt)}
                  </time>
                )}
              </div>

              <p className="mt-1 text-body-sm text-on-surface">{revision.title}</p>

              {revision.changeSummary && (
                <p className="mt-2 text-body-sm text-on-surface-variant">{revision.changeSummary}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-env-tag text-on-surface-variant">
                {revision.authorHandle && (
                  <span>
                    by{" "}
                    <Link to={`/profile/${revision.authorHandle}`} className="underline">
                      {revision.authorDisplayName ?? revision.authorHandle}
                    </Link>
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Icon name="fingerprint" size={13} />
                  {revision.evidenceCount} evidence {revision.evidenceCount === 1 ? "record" : "records"}
                </span>
                {revision.supersededAt !== null && (
                  <span className="flex items-center gap-1 text-warning-amber">
                    <Icon name="history" size={13} />
                    superseded
                  </span>
                )}
                {revision.deprecatedAt !== null && (
                  <span className="flex items-center gap-1 text-destructive-red">
                    <Icon name="block" size={13} />
                    deprecated
                  </span>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </main>
  );
}

/* ------------------------------------------------------------------------- */

interface RevisionSummary {
  revisionNumber: number;
  title: string;
  changeSummary: string | null;
  publishedAt: number | null;
  supersededAt: number | null;
  deprecatedAt: number | null;
  authorHandle: string | null;
  authorDisplayName: string | null;
  evidenceCount: number;
  isCurrent: boolean;
}

interface RevisionRow {
  id: string;
  revision_number: number;
  title: string;
  change_summary: string | null;
  published_at: number | null;
  superseded_at: number | null;
  deprecated_at: number | null;
  author_handle: string | null;
  author_display_name: string | null;
  evidence_count: number;
}

function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

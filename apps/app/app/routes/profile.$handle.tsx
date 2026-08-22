import { Link } from "react-router";
import { Card, EvidenceChip, Icon, OutcomeChip } from "@devyou/ui";
import type { EvidenceResult, EvidenceType, ReproductionOutcome } from "@devyou/core";
import type { Route } from "./+types/profile.$handle";
import { cloudflareContext } from "../context/cloudflare";

/**
 * A contributor profile.
 *
 * Plan §9 asks for an evidence-focused profile, and the word doing the work is
 * *evidence*. What this page shows is a record of what somebody contributed —
 * revisions written, reproductions filed, references added. What it does not show,
 * anywhere, is a number that ranks them.
 *
 * That absence is deliberate and is the most important thing about this file. The
 * adoption research is unambiguous that a visible reputation score is what turned
 * the incumbent Q&A site into a status game, and once a score exists every
 * subsequent product decision is pulled toward protecting it. So: no points, no
 * badges, no streaks, no leaderboard position, no "top 3% this month".
 *
 * There is a second, less obvious rule here. **Failed reproductions are shown
 * exactly like successful ones.** A profile that quietly listed only the reports
 * where the fix worked would turn filing an honest failure into a personal cost,
 * and R-3 depends on failures being cheap to file. The headings below therefore say
 * "reproductions filed", never "successful reproductions", and no success rate is
 * computed from them — a success rate is a score wearing a different hat.
 */

const RECENT_LIMIT = 20;

export function meta({ loaderData: data }: Route.MetaArgs) {
  if (!data) return [{ title: "Not found — DEV.ITISYOU" }];
  return [
    { title: `${data.profile.displayName} — DEV.ITISYOU` },
    {
      name: "description",
      content: `Revisions, reproductions and references contributed by ${data.profile.displayName} on DEV.ITISYOU.`,
    },
    /*
      Indexable, unlike most account-adjacent pages. A contributor profile is public
      attribution for public work — the evidence it lists is already indexed on the
      playbook pages, and indexing the contribution while hiding who made it is the
      wrong way round.
    */
    { name: "robots", content: "index, follow" },
  ];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  const profile = await env.DB.prepare(
    `SELECT p.user_id, p.display_name, p.handle, p.bio, p.created_at, u.status
     FROM profiles p
     JOIN users u ON u.id = p.user_id
     WHERE p.handle = ?1`,
  )
    .bind(params.handle)
    .first<ProfileRow>();

  /*
    A suspended or deleted account 404s rather than rendering an empty shell. The
    evidence they filed stays on the playbook pages under the rules that apply to it
    — but a suspension should not leave behind a blank page that invites speculation
    about why it is blank.
  */
  if (!profile || profile.status !== "active") throw new Response(null, { status: 404 });

  const [revisionRows, reproductionRows, evidenceRows] = await Promise.all([
    env.DB.prepare(
      `SELECT r.id, r.title, r.revision_number, r.published_at, pb.slug
       FROM playbook_revisions r
       JOIN playbooks pb ON pb.id = r.playbook_id
       WHERE r.created_by = ?1 AND r.published_at IS NOT NULL
       ORDER BY r.published_at DESC
       LIMIT ?2`,
    )
      .bind(profile.user_id, RECENT_LIMIT)
      .all<RevisionRow>(),
    env.DB.prepare(
      `SELECT rr.id, rr.outcome, rr.created_at, es.label AS environment_label,
              r.title, r.revision_number, pb.slug
       FROM reproduction_reports rr
       JOIN playbook_revisions r ON r.id = rr.revision_id
       JOIN playbooks pb ON pb.id = r.playbook_id
       JOIN environment_snapshots es ON es.id = rr.environment_snapshot_id
       WHERE rr.actor_id = ?1
       ORDER BY rr.created_at DESC
       LIMIT ?2`,
    )
      .bind(profile.user_id, RECENT_LIMIT)
      .all<ReproductionRow>(),
    /*
      Every reproduction report also writes an `evidence_records` row of type
      `reproduction`, so that type is excluded here rather than listing the same act
      twice under two headings.
    */
    env.DB.prepare(
      `SELECT e.id, e.evidence_type, e.result, e.created_at,
              r.title, r.revision_number, pb.slug,
              sr.title AS source_title, sr.url AS source_url
       FROM evidence_records e
       JOIN playbook_revisions r ON r.id = e.revision_id
       JOIN playbooks pb ON pb.id = r.playbook_id
       LEFT JOIN source_references sr ON sr.id = e.source_reference_id
       WHERE e.actor_id = ?1
         AND e.suppressed_at IS NULL
         AND e.evidence_type != 'reproduction'
       ORDER BY e.created_at DESC
       LIMIT ?2`,
    )
      .bind(profile.user_id, RECENT_LIMIT)
      .all<ProfileEvidenceRow>(),
  ]);

  return {
    profile: {
      displayName: profile.display_name,
      handle: profile.handle,
      bio: profile.bio,
      /*
        Rounded to the month and phrased as "contributing since" rather than as a
        precise join date. Account age is an input to evidence weighting (R-9), and
        showing it to the day would make it the closest thing on this page to a
        seniority marker.
      */
      since: monthLabel(profile.created_at),
    },
    revisions: revisionRows.results.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      revisionNumber: row.revision_number,
      publishedAt: row.published_at,
    })),
    reproductions: reproductionRows.results.map((row) => ({
      id: row.id,
      outcome: row.outcome as ReproductionOutcome,
      createdAt: row.created_at,
      environmentLabel: row.environment_label,
      title: row.title,
      slug: row.slug,
      revisionNumber: row.revision_number,
    })),
    evidence: evidenceRows.results.map((row) => ({
      id: row.id,
      evidenceType: row.evidence_type as EvidenceType,
      result: row.result as EvidenceResult,
      createdAt: row.created_at,
      title: row.title,
      slug: row.slug,
      revisionNumber: row.revision_number,
      sourceTitle: row.source_title,
      sourceUrl: row.source_url,
    })),
  };
}

export default function Profile({ loaderData }: Route.ComponentProps) {
  const { profile, revisions, reproductions, evidence } = loaderData;
  const nothingYet = revisions.length === 0 && reproductions.length === 0 && evidence.length === 0;

  return (
    <main id="main" className="mx-auto flex w-full max-w-[900px] flex-col gap-margin px-margin py-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-headline text-headline-lg text-on-surface">{profile.displayName}</h1>
        <p className="font-mono text-env-tag text-on-surface-variant">
          @{profile.handle} · contributing since {profile.since}
        </p>
        {profile.bio && <p className="text-body-md text-on-surface-variant">{profile.bio}</p>}
      </header>

      <Card>
        <p className="flex items-start gap-2 text-body-sm text-on-surface-variant">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" />
          {/*
            Said out loud, on the page, because a reader arriving from a playbook will
            look for a score here — every site of this shape has one — and not finding
            it reads as "still loading" rather than as a decision.
          */}
          There is no score, rank or badge on this page, and there will not be one. What a
          contributor filed is shown; how they compare to anybody else is not measured. Reports
          saying the fix failed are listed here exactly like reports saying it worked.
        </p>
      </Card>

      {nothingYet && (
        <Card>
          <p className="text-body-sm text-on-surface-variant">
            Nothing published yet under this account.
          </p>
        </Card>
      )}

      {revisions.length > 0 && (
        <section aria-labelledby="revisions">
          <h2 id="revisions" className="mb-1 font-headline text-headline-md text-on-surface">
            Revisions written
          </h2>
          <p className="mb-gutter text-body-sm text-on-surface-variant">
            Each entry is one immutable revision. A later edit by somebody else creates a new
            revision and leaves this one — and its attribution — untouched.
          </p>
          <ul className="flex list-none flex-col gap-2">
            {revisions.map((revision) => (
              <li key={revision.id}>
                <Card as="article">
                  <Link
                    to={`/p/${revision.slug}/r/${revision.revisionNumber}`}
                    className="text-body-md text-on-surface hover:underline"
                  >
                    {revision.title}
                  </Link>
                  <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-env-tag text-on-surface-variant">
                    <span>revision {revision.revisionNumber}</span>
                    {revision.publishedAt !== null && (
                      <time dateTime={isoDate(revision.publishedAt)}>
                        {formatDate(revision.publishedAt)}
                      </time>
                    )}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reproductions.length > 0 && (
        <section aria-labelledby="reproductions">
          <h2 id="reproductions" className="mb-1 font-headline text-headline-md text-on-surface">
            Reproductions filed
          </h2>
          <p className="mb-gutter text-body-sm text-on-surface-variant">
            {reproductions.length === RECENT_LIMIT
              ? `The ${RECENT_LIMIT} most recent, newest first.`
              : "Newest first."}{" "}
            Worked, partial and failed alike.
          </p>
          <ul className="flex list-none flex-col gap-2">
            {reproductions.map((report) => (
              <li key={report.id}>
                <Card as="article" className="flex flex-wrap items-center gap-2">
                  <OutcomeChip outcome={report.outcome} />
                  <Link
                    to={`/p/${report.slug}/r/${report.revisionNumber}`}
                    className="text-body-sm text-on-surface hover:underline"
                  >
                    {report.title}
                  </Link>
                  <span className="font-mono text-env-tag text-on-surface-variant">
                    {report.environmentLabel}
                  </span>
                  <time
                    dateTime={isoDate(report.createdAt)}
                    className="font-mono text-env-tag text-on-surface-variant"
                  >
                    {formatDate(report.createdAt)}
                  </time>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {evidence.length > 0 && (
        <section aria-labelledby="evidence">
          <h2 id="evidence" className="mb-1 font-headline text-headline-md text-on-surface">
            Other evidence contributed
          </h2>
          <p className="mb-gutter text-body-sm text-on-surface-variant">
            References, attestations and automated runs.
          </p>
          <ul className="flex list-none flex-col gap-2">
            {evidence.map((item) => (
              <li key={item.id}>
                <Card as="article" className="flex flex-wrap items-center gap-2">
                  <EvidenceChip type={item.evidenceType} result={item.result} />
                  <Link
                    to={`/p/${item.slug}/r/${item.revisionNumber}`}
                    className="text-body-sm text-on-surface hover:underline"
                  >
                    {item.title}
                  </Link>
                  {item.sourceUrl && (
                    <a
                      href={item.sourceUrl}
                      rel="ugc nofollow noopener noreferrer"
                      className="text-body-sm text-evidence-blue underline"
                    >
                      {item.sourceTitle ?? item.sourceUrl}
                    </a>
                  )}
                  <time
                    dateTime={isoDate(item.createdAt)}
                    className="font-mono text-env-tag text-on-surface-variant"
                  >
                    {formatDate(item.createdAt)}
                  </time>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------------- */

interface ProfileRow {
  user_id: string;
  display_name: string;
  handle: string;
  bio: string | null;
  created_at: number;
  status: string;
}

interface RevisionRow {
  id: string;
  title: string;
  revision_number: number;
  published_at: number | null;
  slug: string;
}

interface ReproductionRow {
  id: string;
  outcome: string;
  created_at: number;
  environment_label: string;
  title: string;
  revision_number: number;
  slug: string;
}

interface ProfileEvidenceRow {
  id: string;
  evidence_type: string;
  result: string;
  created_at: number;
  title: string;
  revision_number: number;
  slug: string;
  source_title: string | null;
  source_url: string | null;
}

function isoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function monthLabel(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${MONTHS[date.getUTCMonth()] ?? ""} ${date.getUTCFullYear()}`.trim();
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

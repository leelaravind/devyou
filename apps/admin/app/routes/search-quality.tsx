import { Card } from "@devyou/ui";
import type { Route } from "./+types/search-quality";
import { requireAdmin } from "../lib/route.server";
import { Detail, EmptyState, SurfaceHeader, SurfaceLayout } from "../components/admin-forms";
import { rateOrDash } from "../lib/format";

/**
 * Search quality.
 *
 * Read-only, and it has to be: there is nothing here to act on directly, because the
 * remedy for a bad search result is a playbook, an alias or a signature — all of which are
 * elsewhere. What this surface does is tell you *which* of those to go and write.
 *
 * **The raw query is not stored and this page cannot show you one.** `search_events` keeps
 * the normalised fingerprint, the shape of the query, its token count and whether it found
 * anything — deliberately, because a search box that accepts a stack trace is precisely
 * where raw logs and credentials would end up in analytics by accident. Plan §17 forbids
 * that, and the restriction is enforced by the schema rather than by a retention policy
 * somebody has to remember.
 *
 * So the questions this page can answer are: what proportion of searches found nothing,
 * which recurring error fingerprints keep finding nothing, and are readers clicking the
 * first result or the eighth. Those are the three that actually drive corpus decisions,
 * and none of them needs the query text.
 *
 * The zero-result rate is suppressed below a sample of five, the same rule the public
 * confidence bands follow. "100% zero-result" over two searches is a lie told with
 * arithmetic whether or not a contributor is reading it.
 */

export function meta() {
  return [{ title: "Search quality — DevYou admin" }];
}

const WINDOW_DAYS = 7;

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = await requireAdmin(context, "search_quality:view");
  const since = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86_400;

  /*
    `Promise.all` rather than `db.batch`, because the four queries return four different
    row shapes and `batch` is generic over exactly one. Casting each result back to its
    real type to save three round trips would trade a compiler check for latency nobody
    will notice on a page loaded a few times a day.
  */
  const [totals, byShape, zeroSignatures, ranks] = await Promise.all([
    env.DB.prepare(
      `SELECT count(*) AS searches,
              sum(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) AS zero_results,
              sum(CASE WHEN clicked_rank IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
              sum(CASE WHEN had_environment_filter THEN 1 ELSE 0 END) AS filtered,
              avg(latency_ms) AS avg_latency
         FROM search_events WHERE created_at > ?1`,
    )
      .bind(since)
      .all<TotalsRow>(),

    env.DB.prepare(
      `SELECT query_shape,
              count(*) AS searches,
              sum(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) AS zero_results
         FROM search_events WHERE created_at > ?1
        GROUP BY query_shape ORDER BY searches DESC`,
    )
      .bind(since)
      .all<ShapeRow>(),

    /*
      The most valuable rows on the page: fingerprints that keep finding nothing.

      A signature hash appearing repeatedly with no results is a specific, real error that
      several people hit and the corpus does not cover — which is a playbook worth writing,
      identified without anybody having stored what those people typed.
    */
    env.DB.prepare(
      `SELECT signature_hash, count(*) AS occurrences, max(created_at) AS last_seen
         FROM search_events
        WHERE created_at > ?1 AND result_count = 0 AND signature_hash IS NOT NULL
        GROUP BY signature_hash
        HAVING occurrences > 1
        ORDER BY occurrences DESC LIMIT 25`,
    )
      .bind(since)
      .all<SignatureRow>(),

    /*
      Where the click landed, bucketed.

      Rank 1 versus rank 2-3 versus deeper is the whole of the relevance signal available
      without storing queries. A corpus where most clicks are below rank three has a
      ranking problem, not a coverage problem, and the two have opposite remedies.
    */
    env.DB.prepare(
      `SELECT CASE WHEN clicked_rank = 1 THEN 'first'
                   WHEN clicked_rank <= 3 THEN 'top three'
                   WHEN clicked_rank <= 10 THEN 'first page'
                   ELSE 'deeper' END AS bucket,
              count(*) AS clicks
         FROM search_events
        WHERE created_at > ?1 AND clicked_rank IS NOT NULL
        GROUP BY bucket ORDER BY clicks DESC`,
    )
      .bind(since)
      .all<RankRow>(),
  ]);

  const summary: TotalsRow = totals.results[0] ?? {
    searches: 0,
    zero_results: 0,
    clicked: 0,
    filtered: 0,
    avg_latency: null,
  };

  return {
    windowDays: WINDOW_DAYS,
    summary,
    byShape: byShape.results,
    zeroSignatures: zeroSignatures.results,
    ranks: ranks.results,
  };
}

export default function SearchQuality({ loaderData }: Route.ComponentProps) {
  const { windowDays, summary, byShape, zeroSignatures, ranks } = loaderData;

  return (
    <SurfaceLayout>
      <SurfaceHeader
        title="Search quality"
        description={`The last ${windowDays} days. Raw queries are never stored — what is kept is the normalised fingerprint, the shape and whether anything was found, which is everything these metrics need and nothing a stack trace could leak into.`}
      />

      <Card as="section" className="mb-8">
        <Detail label="Searches">{summary.searches}</Detail>
        <Detail label="Found nothing">
          {summary.zero_results} ({rateOrDash(summary.zero_results, summary.searches)})
        </Detail>
        <Detail label="Led to a click">
          {summary.clicked} ({rateOrDash(summary.clicked, summary.searches)})
        </Detail>
        <Detail label="Used an environment filter">
          {summary.filtered} ({rateOrDash(summary.filtered, summary.searches)})
        </Detail>
        <Detail label="Mean latency">
          {summary.avg_latency === null ? "—" : `${Math.round(summary.avg_latency)}ms`}
        </Detail>
      </Card>

      <section className="mb-8">
        <h2 className="font-headline text-headline-md text-on-surface mb-3">By query shape</h2>
        {byShape.length === 0 ? (
          <EmptyState>No searches recorded in this window.</EmptyState>
        ) : (
          <Card padded={false}>
            <table className="text-body-sm w-full">
              <thead>
                <tr className="border-outline-variant text-env-tag text-on-surface-variant border-b text-left font-mono uppercase">
                  <th className="p-3">Shape</th>
                  <th className="p-3">Searches</th>
                  <th className="p-3">Found nothing</th>
                  <th className="p-3">Rate</th>
                </tr>
              </thead>
              <tbody>
                {byShape.map((row) => (
                  <tr
                    key={row.query_shape}
                    className="border-outline-variant border-b last:border-0"
                  >
                    <td className="text-on-surface p-3 font-mono">{row.query_shape}</td>
                    <td className="text-on-surface-variant p-3">{row.searches}</td>
                    <td className="text-on-surface-variant p-3">{row.zero_results}</td>
                    <td className="text-on-surface p-3">
                      {rateOrDash(row.zero_results, row.searches)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section className="mb-8">
        <h2 className="font-headline text-headline-md text-on-surface mb-1">
          Recurring errors with no coverage
        </h2>
        <p className="text-body-sm text-on-surface-variant mb-3 max-w-3xl">
          A fingerprint several people searched for and nobody found. This is the coverage backlog,
          derived without a single stored query.
        </p>
        {zeroSignatures.length === 0 ? (
          <EmptyState>
            No error fingerprint has come up more than once with no results in this window.
          </EmptyState>
        ) : (
          <ul className="flex list-none flex-col gap-2">
            {zeroSignatures.map((row) => (
              <li
                key={row.signature_hash}
                className="gap-gutter border-outline-variant bg-surface-container flex items-center justify-between rounded border px-3 py-2"
              >
                <span className="text-env-tag text-on-surface font-mono break-all">
                  {row.signature_hash}
                </span>
                <span className="text-env-tag text-on-surface-variant shrink-0 font-mono">
                  {row.occurrences}×
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-headline text-headline-md text-on-surface mb-3">Where clicks land</h2>
        {ranks.length === 0 ? (
          <EmptyState>No clicks recorded in this window.</EmptyState>
        ) : (
          <ul className="gap-gutter flex list-none flex-wrap">
            {ranks.map((row) => (
              <li key={row.bucket}>
                <Card>
                  <span className="text-env-tag text-on-surface-variant block font-mono uppercase">
                    {row.bucket}
                  </span>
                  <span className="font-headline text-headline-md text-on-surface">
                    {row.clicks}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SurfaceLayout>
  );
}

interface TotalsRow {
  searches: number;
  zero_results: number;
  clicked: number;
  filtered: number;
  avg_latency: number | null;
}

interface ShapeRow {
  query_shape: string;
  searches: number;
  zero_results: number;
}

interface SignatureRow {
  signature_hash: string;
  occurrences: number;
  last_seen: number;
}

interface RankRow {
  bucket: string;
  clicks: number;
}

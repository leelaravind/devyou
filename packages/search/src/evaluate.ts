import type { QueryShape } from "./normalise.js";

/**
 * Search relevance benchmark — scoring.
 *
 * Plan §7: "No search architecture is considered accepted without this benchmark."
 * R-22 requires the labelled set to exist and be measured *before* committing to a
 * retrieval stack, and to include queries where semantic similarity is actively
 * wrong. This file is the scoring half of that gate: pure functions over a labelled
 * query set (`tests/search-eval/queries.json`) and whatever a retrieval stack
 * returned for each one.
 *
 * Nothing here loads a fixture, opens a database or reads a file. The runner that
 * does those things — executes the queries against a real or seeded index, collects
 * `EvalResult[]`, and calls `evaluate()` — is a separate, later piece of work. Kept
 * apart deliberately: a metric function that can be unit-tested with three lines of
 * literal data is a metric function whose arithmetic can be trusted.
 */

/** One labelled query. Mirrors the shape of an entry in `queries.json`, trimmed to
 *  only what scoring needs — the JSON carries additional fields (`category`,
 *  `expectedTechnologies`, `notes`) for humans and the corpus author, not for this
 *  file. */
export interface EvalQuery {
  id: string;
  /** The `QueryShape` `normaliseQuery` actually assigns this query's text — verified
   *  against the real classifier when the query set was written, not asserted by
   *  hand. Drives `byShape`. */
  shape: QueryShape;
  text: string;
  /** Kebab-case problem slugs that answer this query. Empty for a deliberate
   *  negative (R-22): a query the corpus should return nothing for. */
  relevantProblemSlugs: readonly string[];
}

/** What a retrieval stack produced for one query, in ranked order. */
export interface EvalResult {
  queryId: string;
  returnedSlugs: readonly string[];
}

/* ---------------------------------------------------------------------------
   Query/result pairing
   --------------------------------------------------------------------------- */

/**
 * Every metric below needs a query's `relevantProblemSlugs` alongside its result's
 * `returnedSlugs`, and the two arrives as separate arrays that a runner may not
 * have kept in the same order (or may have dropped a query from, on a partial
 * run). Missing a result is treated as an empty return rather than an error —
 * a retrieval stack that crashed on a query returned nothing for it, which is
 * exactly what a genuine zero-result response looks like to every metric here.
 */
function resultFor(query: EvalQuery, byId: ReadonlyMap<string, EvalResult>): EvalResult {
  return byId.get(query.id) ?? { queryId: query.id, returnedSlugs: [] };
}

function indexResults(results: readonly EvalResult[]): Map<string, EvalResult> {
  const byId = new Map<string, EvalResult>();
  for (const result of results) byId.set(result.queryId, result);
  return byId;
}

/**
 * Queries with at least one relevant slug — the ones a rank-quality metric (MRR,
 * hit rate) can meaningfully score. A deliberate negative (R-22) has no rank to
 * find: `reciprocalRank` against an empty relevant set is 0 by construction no
 * matter what came back, so folding negatives into MRR would silently lower the
 * score by however many negatives the query set happens to contain, for a reason
 * that has nothing to do with ranking quality. Negatives are scored instead by
 * `falsePositiveRate`, and separately by `zeroResultRate` once the caller excludes
 * them — that is the split `evaluate()` makes.
 */
function withRelevance(queries: readonly EvalQuery[]): EvalQuery[] {
  return queries.filter((query) => query.relevantProblemSlugs.length > 0);
}

/* ---------------------------------------------------------------------------
   Metrics
   --------------------------------------------------------------------------- */

/**
 * 1 / (rank of the first relevant slug in `returned`), or 0 if none of `relevant`
 * appears at all. Rank is 1-based, matching how MRR is defined everywhere else it
 * is used.
 */
export function reciprocalRank(returned: readonly string[], relevant: readonly string[]): number {
  if (relevant.length === 0) return 0;
  const relevantSet = new Set(relevant);
  for (const [index, slug] of returned.entries()) {
    if (relevantSet.has(slug)) return 1 / (index + 1);
  }
  return 0;
}

/**
 * Mean reciprocal rank, over queries that have at least one relevant slug.
 * See `withRelevance` for why deliberate negatives are excluded.
 */
export function meanReciprocalRank(
  results: readonly EvalResult[],
  queries: readonly EvalQuery[],
): number {
  const scored = withRelevance(queries);
  if (scored.length === 0) return 0;
  const byId = indexResults(results);
  const total = scored.reduce(
    (sum, query) => sum + reciprocalRank(resultFor(query, byId).returnedSlugs, query.relevantProblemSlugs),
    0,
  );
  return total / scored.length;
}

/**
 * Share of queries (again, excluding deliberate negatives) whose top `k` returned
 * slugs contain at least one relevant one.
 */
export function hitRateAt(
  k: number,
  results: readonly EvalResult[],
  queries: readonly EvalQuery[],
): number {
  const scored = withRelevance(queries);
  if (scored.length === 0) return 0;
  const byId = indexResults(results);
  let hits = 0;
  for (const query of scored) {
    const top = resultFor(query, byId).returnedSlugs.slice(0, k);
    const relevantSet = new Set(query.relevantProblemSlugs);
    if (top.some((slug) => relevantSet.has(slug))) hits += 1;
  }
  return hits / scored.length;
}

/**
 * Share of the given results that returned nothing at all.
 *
 * Deliberately naive — it has no idea which of `results` belong to deliberate
 * negatives, because it only receives results, not queries. `evaluate()` is the
 * one that decides which subset of results this should run over; the acceptance
 * target (`TARGETS.zeroResultRate`) applies to the subset with negatives excluded,
 * because a negative returning nothing is correct, not a failure to explain away.
 */
export function zeroResultRate(results: readonly EvalResult[]): number {
  if (results.length === 0) return 0;
  const empty = results.filter((result) => result.returnedSlugs.length === 0).length;
  return empty / results.length;
}

/**
 * Over the queries whose `relevantProblemSlugs` is empty — the deliberate
 * negatives — the share that returned anything at all. Every one of those returns
 * is a false positive: the benchmark asserted the corpus has nothing to say here,
 * so any result is wrong by definition.
 *
 * Returns 0 when the query set contains no negatives, rather than dividing by
 * zero — that state means this metric was not exercised, not that it passed.
 */
export function falsePositiveRate(
  results: readonly EvalResult[],
  queries: readonly EvalQuery[],
): number {
  const negatives = queries.filter((query) => query.relevantProblemSlugs.length === 0);
  if (negatives.length === 0) return 0;
  const byId = indexResults(results);
  const falsePositives = negatives.filter(
    (query) => resultFor(query, byId).returnedSlugs.length > 0,
  ).length;
  return falsePositives / negatives.length;
}

/* ---------------------------------------------------------------------------
   Report
   --------------------------------------------------------------------------- */

const ALL_SHAPES: readonly QueryShape[] = [
  "exact_error",
  "stack_trace",
  "log",
  "natural_language",
  "mixed",
];

export interface BenchmarkReport {
  total: number;
  mrr: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  /** Excludes deliberate negatives — see `zeroResultRate` and `falsePositiveRate`
   *  above for why a negative returning nothing is not counted here. */
  zeroResultRate: number;
  falsePositiveRate: number;
  /**
   * Per-shape breakdown.
   *
   * This is not a diagnostic nicety — it is the reason the aggregate numbers above
   * can be trusted at all. A query set weighted towards natural-language queries
   * (the easiest shape, and the one lexical search is weakest on per R-19) can post
   * a passing overall `hitAt3` while stack-trace retrieval — the shape R-18's
   * fingerprinting exists specifically to serve — is quietly broken. An aggregate
   * that hides that is worse than no benchmark, because it is a green light with a
   * failure underneath it. Always read this before trusting `hitAt3`/`mrr` above.
   *
   * `count` is every query of that shape in the set, including negatives; `mrr`
   * and `hitAt3` are computed the same way as the top-level figures, over the
   * subset of that shape with at least one relevant slug, and are 0 when that
   * subset is empty.
   */
  byShape: Record<QueryShape, { count: number; mrr: number; hitAt3: number }>;
  /**
   * Every query the benchmark considers a failure: a non-negative query where no
   * relevant slug appeared anywhere in the results, or a negative query that
   * returned something. Not "everything below target" — this is the raw list a
   * corpus author or search engineer reads to find out *what* to fix, which the
   * aggregate numbers cannot tell them.
   */
  failures: Array<{ queryId: string; text: string; expected: readonly string[]; got: readonly string[] }>;
}

export function evaluate(queries: readonly EvalQuery[], results: readonly EvalResult[]): BenchmarkReport {
  const byId = indexResults(results);
  const scored = withRelevance(queries);
  const negatives = queries.filter((query) => query.relevantProblemSlugs.length === 0);
  const scoredResults = scored.map((query) => resultFor(query, byId));

  const byShape = Object.fromEntries(
    ALL_SHAPES.map((shape) => {
      const queriesOfShape = queries.filter((query) => query.shape === shape);
      const scoredOfShape = withRelevance(queriesOfShape);
      return [
        shape,
        {
          count: queriesOfShape.length,
          mrr: meanReciprocalRank(results, scoredOfShape),
          hitAt3: hitRateAt(3, results, scoredOfShape),
        },
      ];
    }),
  ) as Record<QueryShape, { count: number; mrr: number; hitAt3: number }>;

  const failures: BenchmarkReport["failures"] = [];
  for (const query of queries) {
    const returned = resultFor(query, byId).returnedSlugs;
    const isNegative = query.relevantProblemSlugs.length === 0;
    const failed = isNegative ? returned.length > 0 : reciprocalRank(returned, query.relevantProblemSlugs) === 0;
    if (failed) {
      failures.push({
        queryId: query.id,
        text: query.text,
        expected: query.relevantProblemSlugs,
        got: returned,
      });
    }
  }

  return {
    total: queries.length,
    mrr: meanReciprocalRank(results, queries),
    hitAt1: hitRateAt(1, results, queries),
    hitAt3: hitRateAt(3, results, queries),
    hitAt5: hitRateAt(5, results, queries),
    zeroResultRate: zeroResultRate(scoredResults),
    falsePositiveRate: falsePositiveRate(results, negatives),
    byShape,
    failures,
  };
}

/* ---------------------------------------------------------------------------
   Acceptance targets
   --------------------------------------------------------------------------- */

/**
 * Acceptance thresholds for this benchmark.
 *
 * RESEARCH-CONSTRAINTS.md §2 is explicit that every number here is a *"provisional
 * success criterion for the experiment, not an industry benchmark"*, and that
 * framing has to survive into how these are read: passing this gate means "good
 * enough to build on, measured against a deliberately difficult set this project
 * wrote", not "matches what Google or Elastic would consider production quality".
 * That is also why the query set is small and hand-labelled rather than mined from
 * real traffic — there is no real traffic yet.
 */
export const TARGETS = {
  /**
   * MARKET / R-22: "search success on the deliberately difficult benchmark ≥ 70%
   * before relying on internal search". Hit@3 is used as "search success" — a
   * reader who finds the right playbook within the first three results has had a
   * successful search in the sense R-24 cares about (evaluable in under three
   * seconds); burying it at rank 4+ is not meaningfully different from not finding
   * it, for a reader who does not know it is there to keep scrolling for.
   */
  hitAt3: 0.7,
  /**
   * Not independently cited by research — set alongside `hitAt3` for this
   * benchmark specifically. The reasoning: if a system clears 70% hit@3, the
   * relevant result is usually present in the top three, and MRR rewards it being
   * *first* rather than third. 0.60 says "usually first, not usually third" is the
   * bar; a stack that hits `hitAt3` by consistently landing the right answer at
   * rank 3 would fail this, correctly, because rank 3 is a worse reading
   * experience than rank 1 even though both count as a "hit".
   */
  mrr: 0.6,
  /**
   * Not independently cited by research — the complement of `hitAt3` set for this
   * benchmark. Computed over non-negative queries only (see `BenchmarkReport`):
   * a genuine "nothing here covers that yet" on a deliberate negative is the
   * correct answer, not a zero-result failure, and is scored by
   * `falsePositiveRate` instead.
   */
  zeroResultRate: 0.15,
  /**
   * Not independently cited by research — set for this benchmark to bound the
   * opposite failure from `zeroResultRate`: confidently returning something for a
   * query the corpus has nothing to say about. 0.34 is loose on purpose. Only the
   * queries with `relevantProblemSlugs: []` count as negatives here — the three
   * expected-zero-result queries in `queries.json` (the adversarial queries each
   * have a real correct slug; they are not negatives). With a set that small,
   * each wrong answer is worth roughly a third, so a strict threshold would be
   * one unlucky query away from a spurious fail rather than a real signal.
   */
  falsePositiveRate: 0.34,
} as const;

/**
 * Whether a `BenchmarkReport` clears every target in `TARGETS`.
 *
 * Checks the aggregate figures only. `byShape` and `failures` are for a human to
 * read when this returns `ok: false` (or, per the comment on `byShape`, even when
 * it returns `ok: true` — passing in aggregate while one shape is broken is a
 * real failure mode this function cannot see).
 */
export function meetsTargets(report: BenchmarkReport): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  if (report.hitAt3 < TARGETS.hitAt3) {
    failures.push(`hitAt3 ${report.hitAt3.toFixed(3)} is below target ${TARGETS.hitAt3}`);
  }
  if (report.mrr < TARGETS.mrr) {
    failures.push(`mrr ${report.mrr.toFixed(3)} is below target ${TARGETS.mrr}`);
  }
  if (report.zeroResultRate > TARGETS.zeroResultRate) {
    failures.push(`zeroResultRate ${report.zeroResultRate.toFixed(3)} exceeds target ${TARGETS.zeroResultRate}`);
  }
  if (report.falsePositiveRate > TARGETS.falsePositiveRate) {
    failures.push(
      `falsePositiveRate ${report.falsePositiveRate.toFixed(3)} exceeds target ${TARGETS.falsePositiveRate}`,
    );
  }

  return { ok: failures.length === 0, failures };
}

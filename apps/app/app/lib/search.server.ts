import {
  ERROR_CODE_LOOKUP_SQL,
  LEXICAL_SEARCH_SQL,
  SIGNATURE_LOOKUP_SQL,
  adviseOnZeroResults,
  applyBoosts,
  buildMatchExpression,
  mergeStages,
  normaliseQuery,
  stagesFor,
  type NormalisedQuery,
  type SearchFilters,
  type SearchHit,
  type ZeroResultAdvice,
} from "@devyou/search";
import { matchEnvironment, type EnvironmentConstraint, type EnvironmentSnapshot } from "@devyou/domain";
import { newId } from "@devyou/core";

/**
 * Running a search against D1.
 *
 * The stage order lives in `@devyou/search`; this executes it. Two things are worth
 * knowing before changing anything here.
 *
 * **Exact stages short-circuit.** If a fingerprint or an error code matches, the
 * lexical stage still runs but its results are appended below, never interleaved.
 * That is R-19, and it is the difference between pasting `SQLITE_BUSY` and getting
 * the D1 locking playbook first versus getting whichever playbook happens to say
 * "sqlite" most often.
 *
 * **Telemetry never stores the query.** Plan §17 forbids raw stack traces and logs
 * reaching general analytics, and a search box that accepts a stack trace is exactly
 * where that would happen by accident. What is recorded is the fingerprint, the
 * shape and the result count — everything the zero-result and reformulation metrics
 * need, and nothing that could identify a person or leak their code.
 */

export interface SearchOutcome {
  query: NormalisedQuery;
  hits: EnrichedHit[];
  total: number;
  advice: ZeroResultAdvice | null;
  latencyMs: number;
}

export interface EnrichedHit extends SearchHit {
  band: string;
  reproducedPassed: number;
  reproducedFailed: number;
  reproducedPartial: number;
  uniqueEnvironments: number;
  technologies: Array<{ slug: string; name: string; type: string }>;
  versionLabels: string[];
  lastSuccessAt: number | null;
  environmentExplanation: string | null;
}

const DEFAULT_LIMIT = 20;

export async function runSearch(
  db: D1Database,
  rawQuery: string,
  filters: SearchFilters,
  options: { limit?: number; offset?: number; environment?: EnvironmentSnapshot | null } = {},
): Promise<SearchOutcome> {
  const startedAt = Date.now();
  const query = normaliseQuery(rawQuery);
  const limit = options.limit ?? DEFAULT_LIMIT;
  const offset = options.offset ?? 0;

  const stages = stagesFor(query.shape);
  const exact: SearchHit[] = [];

  if (stages.includes("signature") && query.signatureHash) {
    const rows = await db
      .prepare(SIGNATURE_LOOKUP_SQL)
      .bind(query.signatureHash, limit)
      .all<RawHit>();
    exact.push(...rows.results.map((row) => toHit(row, "exact_signature", 0)));
  }

  if (stages.includes("error_code") && query.errorCodes.length > 0) {
    /*
      Only the first code is looked up.

      A stack trace can contain three or four code-shaped tokens, and querying each
      is a round trip that mostly returns the same rows. The first is the one nearest
      the top of the paste, which is the one the reader is actually asking about.
    */
    const code = query.errorCodes[0] as string;
    const rows = await db.prepare(ERROR_CODE_LOOKUP_SQL).bind(code, limit).all<RawHit>();
    exact.push(...rows.results.map((row) => toHit(row, "error_code", 0.5)));
  }

  /*
    The scope gate.

    A prose query that names no technology this corpus covers gets nothing, and the
    zero-result page says why.

    This exists because the benchmark caught the alternative behaving badly: every
    deliberately-unanswerable query returned results. The lexical stage ORs its
    terms, so "how do I centre a div" matches a Postgres deadlock playbook on the
    strength of "do" and "how" — and scores it *better* than a genuine prose query
    about connection pooling scores its correct answer. No score threshold separates
    those two cases; the distributions overlap.

    What does separate them is scope. Coverage here is deliberately narrow and deep
    (plan §20), so "this query is about nothing we cover" is a true and useful
    answer, and the zero-result page is built to make it useful — it names what to
    try and offers to start a playbook. Returning the least-bad match instead
    teaches a reader that the search does not work, which is the more expensive
    mistake.

    Only applied to natural-language queries. Anything carrying an error code, an
    exception or a stack frame goes through regardless: an unrecognised error string
    is exactly the case where a weak lexical match might still be the right one.
  */
  if (
    query.shape === "natural_language" &&
    query.errorCodes.length === 0 &&
    query.exceptionTypes.length === 0 &&
    !(await mentionsCoveredTechnology(db, query.ftsTerms))
  ) {
    const latencyMs = Date.now() - startedAt;
    return {
      query,
      hits: [],
      total: 0,
      advice: adviseOnZeroResults(query, filters),
      latencyMs,
    };
  }

  let lexical: SearchHit[] = [];
  const match = buildMatchExpression(query);
  if (stages.includes("lexical") && match) {
    try {
      const rows = await db
        .prepare(LEXICAL_SEARCH_SQL)
        .bind(match, limit, offset)
        .all<RawHit & { score: number }>();
      lexical = rows.results.map((row) => toHit(row, "lexical", row.score));
    } catch (error) {
      /*
        A malformed MATCH expression is a bug in term building, not a reason to fail
        the request. The exact stages may already have found the answer, and a reader
        who pasted an error deserves those results rather than a 500.
      */
      console.error("fts_match_failed", {
        shape: query.shape,
        termCount: query.ftsTerms.length,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  const merged = mergeStages(exact, lexical, limit);
  const enriched = await enrich(db, merged, options.environment ?? null);

  const latencyMs = Date.now() - startedAt;

  return {
    query,
    hits: enriched,
    total: enriched.length,
    advice: enriched.length === 0 ? adviseOnZeroResults(query, filters) : null,
    latencyMs,
  };
}

interface RawHit {
  playbook_id: string;
  playbook_slug: string;
  revision_id: string;
  title: string;
  summary: string;
}

function toHit(row: RawHit, matchKind: SearchHit["matchKind"], score: number): SearchHit {
  return {
    playbookId: row.playbook_id,
    playbookSlug: row.playbook_slug,
    revisionId: row.revision_id,
    title: row.title,
    summary: row.summary,
    matchKind,
    score,
  };
}

/**
 * Attach the things a reader needs to triage a result in under three seconds (R-24).
 *
 * One query for the whole page rather than one per hit. Twenty hits would otherwise
 * be sixty round trips to D1, and on the hottest route in the product that is the
 * difference between a search that feels instant and one that does not.
 */
async function enrich(
  db: D1Database,
  hits: readonly SearchHit[],
  environment: EnvironmentSnapshot | null,
): Promise<EnrichedHit[]> {
  if (hits.length === 0) return [];

  const ids = hits.map((hit) => hit.revisionId);
  const placeholders = ids.map((_, index) => `?${index + 1}`).join(", ");

  const confidence = await db
    .prepare(
      `SELECT revision_id, band, reproduced_passed, reproduced_partial, reproduced_failed,
              unique_environments, last_success_at
       FROM revision_confidence WHERE revision_id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<{
      revision_id: string;
      band: string;
      reproduced_passed: number;
      reproduced_partial: number;
      reproduced_failed: number;
      unique_environments: number;
      last_success_at: number | null;
    }>();

  const technologies = await db
    .prepare(
      `SELECT rt.revision_id, t.slug, t.name, t.type
       FROM revision_technologies rt
       JOIN technologies t ON t.id = rt.technology_id
       WHERE rt.revision_id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<{ revision_id: string; slug: string; name: string; type: string }>();

  const constraints = await db
    .prepare(
      `SELECT c.revision_id, c.technology_id, t.name AS technology_name,
              c.min_semver, c.max_semver, c.max_inclusive, c.architecture, c.constraint_kind
       FROM revision_environment_constraints c
       JOIN technologies t ON t.id = c.technology_id
       WHERE c.revision_id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<{
      revision_id: string;
      technology_id: string;
      technology_name: string;
      min_semver: string | null;
      max_semver: string | null;
      max_inclusive: number;
      architecture: string | null;
      constraint_kind: string;
    }>();

  const confidenceBy = new Map(confidence.results.map((row) => [row.revision_id, row]));
  const technologiesBy = new Map<string, Array<{ slug: string; name: string; type: string }>>();
  for (const row of technologies.results) {
    const list = technologiesBy.get(row.revision_id) ?? [];
    list.push({ slug: row.slug, name: row.name, type: row.type });
    technologiesBy.set(row.revision_id, list);
  }
  const constraintsBy = new Map<string, EnvironmentConstraint[]>();
  for (const row of constraints.results) {
    const list = constraintsBy.get(row.revision_id) ?? [];
    list.push({
      technologyId: row.technology_id,
      technologyName: row.technology_name,
      minSemver: row.min_semver,
      maxSemver: row.max_semver,
      maxInclusive: row.max_inclusive === 1,
      architecture: row.architecture,
      constraintKind: row.constraint_kind as EnvironmentConstraint["constraintKind"],
    });
    constraintsBy.set(row.revision_id, list);
  }

  const enriched = hits.map((hit) => {
    const stats = confidenceBy.get(hit.revisionId);
    const band = stats?.band ?? "unverified";

    const revisionConstraints = constraintsBy.get(hit.revisionId) ?? [];
    const environmentMatch =
      environment && revisionConstraints.length > 0
        ? matchEnvironment(environment, revisionConstraints)
        : null;

    const boosted = applyBoosts(hit, {
      band,
      ...(environmentMatch ? { environmentVerdict: environmentMatch.verdict } : {}),
    });

    return {
      ...boosted,
      band,
      reproducedPassed: stats?.reproduced_passed ?? 0,
      reproducedPartial: stats?.reproduced_partial ?? 0,
      reproducedFailed: stats?.reproduced_failed ?? 0,
      uniqueEnvironments: stats?.unique_environments ?? 0,
      lastSuccessAt: stats?.last_success_at ?? null,
      technologies: technologiesBy.get(hit.revisionId) ?? [],
      versionLabels: [],
      environmentExplanation: environmentMatch?.explanation ?? null,
    } satisfies EnrichedHit;
  });

  /*
    Re-sorted after boosting, but exact matches keep their block.

    Sorting the whole list by boosted score would let a lexical hit with a strong
    band overtake an exact fingerprint match, which is precisely the failure the
    two-stage design exists to prevent.
  */
  const exactHits = enriched.filter((hit) => hit.matchKind !== "lexical");
  const lexicalHits = enriched.filter((hit) => hit.matchKind === "lexical");
  exactHits.sort((a, b) => a.score - b.score);
  lexicalHits.sort((a, b) => a.score - b.score);

  return [...exactHits, ...lexicalHits];
}

/**
 * Record a search, minus the search.
 *
 * Fire-and-forget through `ctx.waitUntil` at the call site: telemetry must never add
 * latency to, or fail, a reader's search.
 */
export async function recordSearchEvent(
  db: D1Database,
  outcome: SearchOutcome,
  context: { hadEnvironmentFilter: boolean; sessionBucket: string | null },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO search_events
         (id, signature_hash, query_shape, query_token_count, result_count,
          had_environment_filter, session_bucket, latency_ms, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      newId("searchEvent"),
      outcome.query.signatureHash,
      outcome.query.shape,
      outcome.query.ftsTerms.length,
      outcome.total,
      context.hadEnvironmentFilter ? 1 : 0,
      context.sessionBucket,
      outcome.latencyMs,
      Math.floor(Date.now() / 1000),
    )
    .run();
}

/**
 * Does the query name any technology this corpus actually covers?
 *
 * Matches the query's terms against `technologies.name`, `technologies.slug` and
 * `technology_aliases.alias` — the alias table is what makes this work, because it
 * carries the error tokens and binary names people actually type.
 *
 * One indexed lookup with an IN list, not a LIKE scan: this runs on the search path
 * and a scan over the alias table per query would be a cost paid on every search to
 * answer a question that is usually "no".
 */
async function mentionsCoveredTechnology(
  db: D1Database,
  terms: readonly string[],
): Promise<boolean> {
  const candidates = terms
    .map((term) => (term.startsWith('"') ? term.slice(1, -1) : term))
    .map((term) => term.toLowerCase())
    .filter((term) => term.length >= 2 && term.length <= 60)
    .slice(0, 24);

  if (candidates.length === 0) return false;

  /*
    The list is bound once, and the same numbered placeholders are reused in all
    three IN clauses.

    `?1…?N` refer to binding positions, not to occurrences, so repeating the
    placeholders costs nothing — but binding the values three times to match the
    three occurrences is an arity error. That mistake turned every natural-language
    search into a 500, and the benchmark reported it as a zero-result rate rather
    than as an outage, because an error page contains no result links either. Worth
    remembering: a metric that counts "found nothing" cannot tell you the page was
    broken.
  */
  const placeholders = candidates.map((_, index) => `?${index + 1}`).join(", ");

  const row = await db
    .prepare(
      `SELECT 1 AS hit FROM technologies
        WHERE lower(name) IN (${placeholders}) OR lower(slug) IN (${placeholders})
       UNION ALL
       SELECT 1 FROM technology_aliases WHERE lower(alias) IN (${placeholders})
       LIMIT 1`,
    )
    .bind(...candidates)
    .first<{ hit: number }>();

  return row !== null;
}

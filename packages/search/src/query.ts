import type { NormalisedQuery, QueryShape } from "./normalise.js";

/**
 * Retrieval and ranking.
 *
 * Two stages, in this order, and the order is the design:
 *
 * 1. **Exact signature lookup.** If the query carries an error fingerprint, that is
 *    matched against `problem_signatures` first. Results from this stage are not
 *    blended into the relevance score — they are placed above it.
 * 2. **Lexical FTS5**, with structured filters and ranking boosts.
 *
 * R-19 is the reason for the separation. A long, well-written summary elsewhere in
 * the corpus can out-score a short exact match on `SQLITE_BUSY` under any relevance
 * function, because relevance functions reward term density and an exact code is one
 * token. Someone who pasted an exact error and got a "related" playbook first would
 * conclude, correctly, that the search does not work.
 *
 * Plan §7 puts semantic retrieval behind a feature flag after a lexical benchmark
 * exists. Nothing in this file calls a model, and an exact-error search makes no AI
 * call at all (plan §11).
 */

export interface SearchFilters {
  /** Technology slugs. */
  technologies?: readonly string[];
  /** Normalised version, matched against a revision's declared range. */
  version?: string | null;
  osFamily?: string | null;
  /** Confidence bands to include. Absent means all. */
  bands?: readonly string[];
  /** Exclude deprecated and superseded revisions. Default true. */
  currentOnly?: boolean;
}

export interface SearchRequest {
  query: NormalisedQuery;
  filters: SearchFilters;
  limit: number;
  offset: number;
}

export interface SearchHit {
  playbookId: string;
  playbookSlug: string;
  revisionId: string;
  title: string;
  summary: string;
  /** Which stage produced it. Shown in the UI as "exact error match", because a
   *  reader deciding whether to trust a result deserves to know why it is there. */
  matchKind: "exact_signature" | "error_code" | "lexical";
  /** Lower is better, as FTS5 `rank` is. Normalised across stages by `mergeStages`. */
  score: number;
  environmentVerdict?: "matches" | "mismatch" | "unknown";
}

/* ---------------------------------------------------------------------------
   SQL
   --------------------------------------------------------------------------- */

/**
 * Stage 1 — exact fingerprint.
 *
 * A single indexed equality on `signature_hash`. No ranking function is involved:
 * either the fingerprint matches or it does not, and every row that matches is
 * equally exact.
 */
export const SIGNATURE_LOOKUP_SQL = `
  SELECT p.id            AS playbook_id,
         p.slug          AS playbook_slug,
         r.id            AS revision_id,
         r.title         AS title,
         r.summary       AS summary
  FROM problem_signatures s
  JOIN problems  pr ON pr.id = s.problem_id
  JOIN playbooks p  ON p.problem_id = pr.id
  JOIN playbook_revisions r ON r.id = p.current_revision_id
  WHERE s.signature_hash = ?1
    AND p.visibility = 'public'
    AND r.published_at IS NOT NULL
  LIMIT ?2
`;

/**
 * Stage 1b — error code, when there is no full fingerprint.
 *
 * A query of just `ECONNREFUSED` produces no frame sequence, so it has no
 * fingerprint. It is still an exact-error query and must not fall through to
 * relevance ranking, where every playbook that mentions the code in prose competes
 * with the ones that are about it.
 */
export const ERROR_CODE_LOOKUP_SQL = `
  SELECT p.id            AS playbook_id,
         p.slug          AS playbook_slug,
         r.id            AS revision_id,
         r.title         AS title,
         r.summary       AS summary
  FROM problem_signatures s
  JOIN problems  pr ON pr.id = s.problem_id
  JOIN playbooks p  ON p.problem_id = pr.id
  JOIN playbook_revisions r ON r.id = p.current_revision_id
  WHERE upper(s.error_code) = upper(?1)
    AND p.visibility = 'public'
    AND r.published_at IS NOT NULL
  LIMIT ?2
`;

/**
 * Stage 2 — lexical.
 *
 * `bm25()` with per-column weights rather than the default `rank`. The weights say
 * what the corpus is: an error string in `error_text` is a far stronger signal than
 * the same words appearing in a node body, because `error_text` only ever contains
 * text that came out of a machine.
 *
 * Column order matches the `playbook_fts` definition in the migration:
 * revision_id, playbook_id, title, summary, error_text, node_text, technology_text.
 * The two UNINDEXED columns still occupy weight positions, so their weights are 0.
 */
export const LEXICAL_SEARCH_SQL = `
  SELECT f.revision_id   AS revision_id,
         f.playbook_id   AS playbook_id,
         p.slug          AS playbook_slug,
         r.title         AS title,
         r.summary       AS summary,
         bm25(playbook_fts, 0.0, 0.0, 8.0, 3.0, 12.0, 1.0, 4.0) AS score
  FROM playbook_fts f
  JOIN playbooks p ON p.id = f.playbook_id
  JOIN playbook_revisions r ON r.id = f.revision_id
  WHERE playbook_fts MATCH ?1
    AND p.visibility = 'public'
    AND r.published_at IS NOT NULL
    AND r.id = p.current_revision_id
  ORDER BY score
  LIMIT ?2 OFFSET ?3
`;

/**
 * Build the FTS5 MATCH expression.
 *
 * Terms are OR-ed rather than AND-ed. A pasted stack trace produces twenty terms and
 * requiring all of them would return nothing — which is the single commonest way a
 * search over pasted text returns zero results and looks broken. bm25 does the
 * discrimination.
 *
 * Every term is already quoted or word-safe by `buildFtsTerms`, so nothing here can
 * inject FTS syntax. Belt and braces: anything still containing a quote is dropped
 * rather than escaped, because a term that needs escaping at this point is a term
 * that came from somewhere it should not have.
 */
export function buildMatchExpression(query: NormalisedQuery): string | null {
  const terms = query.ftsTerms.filter((term) => {
    const inner = term.startsWith('"') ? term.slice(1, -1) : term;
    return inner.length > 0 && !inner.includes('"');
  });
  return terms.length === 0 ? null : terms.join(" OR ");
}

/* ---------------------------------------------------------------------------
   Merging and boosts
   --------------------------------------------------------------------------- */

/**
 * Which stages to run, and in what order, for a given query shape.
 *
 * An `exact_error` query runs signature and code lookup first and only falls
 * through to lexical if those return nothing. A `natural_language` query skips the
 * exact stages entirely — there is no fingerprint to look up, and running the query
 * anyway is two round trips for a guaranteed empty result.
 */
export function stagesFor(shape: QueryShape): Array<"signature" | "error_code" | "lexical"> {
  switch (shape) {
    case "exact_error":
    case "stack_trace":
      return ["signature", "error_code", "lexical"];
    case "log":
    case "mixed":
      return ["signature", "error_code", "lexical"];
    case "natural_language":
      return ["lexical"];
  }
}

/**
 * Merge the stages into one ordered result set.
 *
 * Exact matches keep their position above lexical ones regardless of score. Their
 * relative order among themselves is by evidence strength, not by relevance — when
 * two playbooks both exactly match the error you pasted, the one more people have
 * reproduced is the more useful one to read first, and that is a claim relevance
 * ranking cannot make.
 */
export function mergeStages(
  exact: readonly SearchHit[],
  lexical: readonly SearchHit[],
  limit: number,
): SearchHit[] {
  const seen = new Set<string>();
  const merged: SearchHit[] = [];

  for (const hit of exact) {
    if (seen.has(hit.revisionId)) continue;
    seen.add(hit.revisionId);
    merged.push(hit);
  }
  for (const hit of lexical) {
    if (seen.has(hit.revisionId)) continue;
    seen.add(hit.revisionId);
    merged.push(hit);
  }
  return merged.slice(0, limit);
}

/**
 * Ranking boosts applied after retrieval.
 *
 * Kept small and few, and deliberately *not* including popularity. R-42 and the
 * adoption research both point at popularity ranking as the mechanism that turns a
 * knowledge base into a contest; and a playbook is useful because it applies to your
 * environment and has been reproduced, not because many people opened it.
 *
 * Values are multipliers on a score where lower is better, so a boost is < 1.
 */
export const BOOSTS = {
  /** The reader's declared environment satisfies the revision's constraints. */
  environmentMatches: 0.6,
  /** The revision explicitly does not apply here. Demoted, never hidden — R-29. */
  environmentMismatch: 2.5,
  /** Some constraint could not be checked. Neutral: absence of information is not
   *  evidence of anything, and penalising it would punish readers who declared
   *  nothing, who are the majority. */
  environmentUnknown: 1.0,
  strongEvidence: 0.8,
  moderateEvidence: 0.9,
  needsReverification: 1.4,
  /** Superseded and deprecated revisions are not returned by the current-only
   *  filter at all, so this applies only when a reader has asked to see them. */
  deprecated: 3.0,
} as const;

export function applyBoosts(
  hit: SearchHit,
  context: { band?: string; environmentVerdict?: "matches" | "mismatch" | "unknown" },
): SearchHit {
  let score = hit.score;

  switch (context.environmentVerdict) {
    case "matches":
      score *= BOOSTS.environmentMatches;
      break;
    case "mismatch":
      score *= BOOSTS.environmentMismatch;
      break;
    default:
      score *= BOOSTS.environmentUnknown;
  }

  if (context.band === "strong_evidence") score *= BOOSTS.strongEvidence;
  else if (context.band === "moderate_evidence") score *= BOOSTS.moderateEvidence;
  else if (context.band === "needs_reverification") score *= BOOSTS.needsReverification;
  else if (context.band === "deprecated") score *= BOOSTS.deprecated;

  const result: SearchHit = { ...hit, score };
  if (context.environmentVerdict) result.environmentVerdict = context.environmentVerdict;
  return result;
}

/* ---------------------------------------------------------------------------
   Zero results
   --------------------------------------------------------------------------- */

export interface ZeroResultAdvice {
  /** What to tell the reader. Never "no results" alone — a dead end is where a
   *  developer leaves and does not come back. */
  headline: string;
  suggestions: string[];
  /** Whether to offer the contribution path prominently. A pasted exact error with
   *  no match is the single best moment to ask for a playbook: the reader has the
   *  problem in front of them right now. */
  offerContribution: boolean;
}

export function adviseOnZeroResults(query: NormalisedQuery, filters: SearchFilters): ZeroResultAdvice {
  const suggestions: string[] = [];

  if (filters.technologies?.length || filters.version || filters.osFamily) {
    suggestions.push("Clear the environment filters — the playbook may exist for another version.");
  }
  if (query.shape === "stack_trace" || query.shape === "log") {
    suggestions.push("Try just the exception line, without the surrounding frames.");
  }
  if (query.errorCodes.length === 0 && query.shape === "natural_language") {
    suggestions.push("If you have the exact error text, paste that instead — it matches better than a description.");
  }
  if (query.errorCodes.length > 1) {
    suggestions.push(`Search for one code at a time: ${query.errorCodes.slice(0, 3).join(", ")}.`);
  }

  return {
    headline:
      query.errorCodes.length > 0
        ? `Nothing here covers ${query.errorCodes[0]} yet.`
        : "Nothing here covers that yet.",
    suggestions,
    offerContribution: query.shape !== "natural_language",
  };
}

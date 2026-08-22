import { ApiError, isPubliclyReadable, type PlaybookStatus } from "@devyou/core";
import {
  deriveConfidenceBand,
  explainConfidence,
  matchEnvironment,
  type EnvironmentConstraint,
  type EnvironmentSnapshot,
  type EvidenceTally,
  type GraphEdge,
  type GraphNode,
} from "@devyou/domain";

/**
 * Reading a playbook.
 *
 * Every function here resolves a **revision**, never a playbook. A playbook has no
 * content — it is an identity and a pointer — so "load the playbook" is not a
 * meaningful operation, and writing it that way would be the first step back toward
 * evidence that follows an edit.
 *
 * `loadRevisionBySlug` resolves the current revision; `loadRevisionByNumber`
 * resolves a specific historical one. Both return the same shape, so the page that
 * renders a current revision and the page that renders a superseded one are the same
 * page with a different banner. That is deliberate: plan §9 requires historical URLs
 * to keep working, and the cheapest way to guarantee that is for the historical path
 * to be the ordinary path.
 */

export interface RevisionView {
  playbookId: string;
  playbookSlug: string;
  problemId: string;
  problemSlug: string;
  problemTitle: string;
  revisionId: string;
  revisionNumber: number;
  title: string;
  summary: string;
  changeSummary: string | null;
  status: PlaybookStatus;
  publishedAt: number | null;
  supersededAt: number | null;
  deprecatedAt: number | null;
  deprecationReason: string | null;
  needsReverificationAt: number | null;
  needsReverificationReason: string | null;
  /** True when this is the revision `/p/:slug` currently resolves to. */
  isCurrent: boolean;
  currentRevisionNumber: number | null;
  authorHandle: string | null;
  authorDisplayName: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeBodies: Map<string, NodeDetail>;
  technologies: Array<{ slug: string; name: string; type: string }>;
  constraints: EnvironmentConstraint[];
  sources: Array<{ url: string; title: string; sourceType: string; publisher: string | null }>;
  symptoms: string[];
  tally: EvidenceTally;
}

export interface NodeDetail {
  body: string;
  commandText: string | null;
  commandLanguage: string | null;
  expectedOutput: string | null;
  safetyLevel: string;
  safetyEffect: string | null;
}

const REVISION_BY_SLUG = `
  SELECT r.id, r.playbook_id, r.revision_number, r.title, r.summary, r.change_summary,
         r.status, r.published_at, r.superseded_at, r.deprecated_at, r.deprecation_reason,
         r.needs_reverification_at, r.needs_reverification_reason,
         p.slug AS playbook_slug, p.current_revision_id,
         pr.id AS problem_id, pr.slug AS problem_slug, pr.canonical_title AS problem_title,
         cur.revision_number AS current_revision_number,
         prof.handle AS author_handle, prof.display_name AS author_display_name
  FROM playbooks p
  JOIN playbook_revisions r ON r.id = %REVISION%
  JOIN problems pr ON pr.id = p.problem_id
  LEFT JOIN playbook_revisions cur ON cur.id = p.current_revision_id
  LEFT JOIN profiles prof ON prof.user_id = r.created_by
  WHERE p.slug = ?1
`;

export async function loadRevisionBySlug(
  db: D1Database,
  slug: string,
): Promise<RevisionView | null> {
  return load(db, REVISION_BY_SLUG.replace("%REVISION%", "p.current_revision_id"), [slug]);
}

export async function loadRevisionByNumber(
  db: D1Database,
  slug: string,
  revisionNumber: number,
): Promise<RevisionView | null> {
  const sql = `${REVISION_BY_SLUG.replace(
    "%REVISION%",
    "(SELECT id FROM playbook_revisions WHERE playbook_id = p.id AND revision_number = ?2)",
  )}`;
  return load(db, sql, [slug, revisionNumber]);
}

async function load(
  db: D1Database,
  sql: string,
  bindings: unknown[],
): Promise<RevisionView | null> {
  const head = await db
    .prepare(sql)
    .bind(...(bindings as never[]))
    .first<HeadRow>();

  if (!head) return null;

  /*
    Draft and quarantined revisions are 404, not 403.

    A 403 confirms the revision exists, which turns the public route into an
    existence oracle for unpublished work — an author's in-progress correction to a
    security playbook is exactly the thing somebody would probe for.
  */
  if (!isPubliclyReadable(head.status as PlaybookStatus) || head.published_at === null) {
    return null;
  }

  const [nodes, edges, technologies, constraints, sources, symptoms, evidence] = await Promise.all([
    db
      .prepare(
        `SELECT id, node_type, title, body, command_text, command_language, expected_output,
                safety_level, safety_effect, display_order
         FROM diagnostic_nodes WHERE revision_id = ?1 ORDER BY display_order`,
      )
      .bind(head.id)
      .all<NodeRow>(),
    db
      .prepare(
        `SELECT id, from_node_id, to_node_id, condition_type, condition_label, priority
         FROM diagnostic_edges WHERE revision_id = ?1 ORDER BY priority`,
      )
      .bind(head.id)
      .all<EdgeRow>(),
    db
      .prepare(
        `SELECT t.slug, t.name, t.type FROM revision_technologies rt
         JOIN technologies t ON t.id = rt.technology_id
         WHERE rt.revision_id = ?1 ORDER BY rt.is_primary DESC, t.name`,
      )
      .bind(head.id)
      .all<{ slug: string; name: string; type: string }>(),
    db
      .prepare(
        `SELECT c.technology_id, t.name AS technology_name, c.min_semver, c.max_semver,
                c.max_inclusive, c.architecture, c.constraint_kind
         FROM revision_environment_constraints c
         JOIN technologies t ON t.id = c.technology_id
         WHERE c.revision_id = ?1`,
      )
      .bind(head.id)
      .all<ConstraintRow>(),
    db
      .prepare(
        `SELECT s.url, s.title, s.source_type, s.publisher FROM revision_source_references rs
         JOIN source_references s ON s.id = rs.source_reference_id
         WHERE rs.revision_id = ?1`,
      )
      .bind(head.id)
      .all<{ url: string; title: string; source_type: string; publisher: string | null }>(),
    db
      .prepare(`SELECT description FROM symptoms WHERE problem_id = ?1 ORDER BY display_order`)
      .bind(head.problem_id)
      .all<{ description: string }>(),
    db
      .prepare(
        `SELECT band, reproduced_passed, reproduced_partial, reproduced_failed,
                independent_confirmations, unique_environments, ci_executions,
                maintainer_attestations, official_references, last_success_at, last_failure_at
         FROM revision_confidence WHERE revision_id = ?1`,
      )
      .bind(head.id)
      .first<ConfidenceRow>(),
  ]);

  const nodeBodies = new Map<string, NodeDetail>();
  for (const node of nodes.results) {
    nodeBodies.set(node.id, {
      body: node.body,
      commandText: node.command_text,
      commandLanguage: node.command_language,
      expectedOutput: node.expected_output,
      safetyLevel: node.safety_level,
      safetyEffect: node.safety_effect,
    });
  }

  return {
    playbookId: head.playbook_id,
    playbookSlug: head.playbook_slug,
    problemId: head.problem_id,
    problemSlug: head.problem_slug,
    problemTitle: head.problem_title,
    revisionId: head.id,
    revisionNumber: head.revision_number,
    title: head.title,
    summary: head.summary,
    changeSummary: head.change_summary,
    status: head.status as PlaybookStatus,
    publishedAt: head.published_at,
    supersededAt: head.superseded_at,
    deprecatedAt: head.deprecated_at,
    deprecationReason: head.deprecation_reason,
    needsReverificationAt: head.needs_reverification_at,
    needsReverificationReason: head.needs_reverification_reason,
    isCurrent: head.current_revision_id === head.id,
    currentRevisionNumber: head.current_revision_number,
    authorHandle: head.author_handle,
    authorDisplayName: head.author_display_name,
    nodes: nodes.results.map((node) => ({
      id: node.id,
      nodeType: node.node_type as GraphNode["nodeType"],
      title: node.title,
      commandText: node.command_text,
      safetyLevel: node.safety_level as GraphNode["safetyLevel"],
      safetyEffect: node.safety_effect,
    })),
    edges: edges.results.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.from_node_id,
      toNodeId: edge.to_node_id,
      conditionType: edge.condition_type as GraphEdge["conditionType"],
    })),
    nodeBodies,
    technologies: technologies.results,
    constraints: constraints.results.map((row) => ({
      technologyId: row.technology_id,
      technologyName: row.technology_name,
      minSemver: row.min_semver,
      maxSemver: row.max_semver,
      maxInclusive: row.max_inclusive === 1,
      architecture: row.architecture,
      constraintKind: row.constraint_kind as EnvironmentConstraint["constraintKind"],
    })),
    sources: sources.results.map((row) => ({
      url: row.url,
      title: row.title,
      sourceType: row.source_type,
      publisher: row.publisher,
    })),
    symptoms: symptoms.results.map((row) => row.description),
    tally: toTally(evidence),
  };
}

/**
 * The confidence band and its explanation, for a loaded revision.
 *
 * Derived here rather than trusted from `revision_confidence.band`. The cached band
 * is a performance artefact; deriving it at render from the same counts the page is
 * about to display means the badge and the numbers under it can never disagree — and
 * a badge that contradicts its own evidence is worse than no badge.
 */
export function confidenceFor(revision: RevisionView) {
  const lifecycle = {
    deprecatedAt: revision.deprecatedAt,
    supersededAt: revision.supersededAt,
    needsReverificationAt: revision.needsReverificationAt,
  };
  return {
    band: deriveConfidenceBand(revision.tally, lifecycle),
    explanation: explainConfidence(revision.tally, lifecycle),
  };
}

export function applicabilityFor(
  revision: RevisionView,
  environment: EnvironmentSnapshot | null,
) {
  if (!environment || revision.constraints.length === 0) return null;
  return matchEnvironment(environment, revision.constraints);
}

export function requireRevision(revision: RevisionView | null): RevisionView {
  if (!revision) throw new ApiError("NOT_FOUND");
  return revision;
}

/* ------------------------------------------------------------------------- */

interface HeadRow {
  id: string;
  playbook_id: string;
  revision_number: number;
  title: string;
  summary: string;
  change_summary: string | null;
  status: string;
  published_at: number | null;
  superseded_at: number | null;
  deprecated_at: number | null;
  deprecation_reason: string | null;
  needs_reverification_at: number | null;
  needs_reverification_reason: string | null;
  playbook_slug: string;
  current_revision_id: string | null;
  problem_id: string;
  problem_slug: string;
  problem_title: string;
  current_revision_number: number | null;
  author_handle: string | null;
  author_display_name: string | null;
}

interface NodeRow {
  id: string;
  node_type: string;
  title: string;
  body: string;
  command_text: string | null;
  command_language: string | null;
  expected_output: string | null;
  safety_level: string;
  safety_effect: string | null;
  display_order: number;
}

interface EdgeRow {
  id: string;
  from_node_id: string;
  to_node_id: string;
  condition_type: string;
  condition_label: string | null;
  priority: number;
}

interface ConstraintRow {
  technology_id: string;
  technology_name: string;
  min_semver: string | null;
  max_semver: string | null;
  max_inclusive: number;
  architecture: string | null;
  constraint_kind: string;
}

interface ConfidenceRow {
  band: string;
  reproduced_passed: number;
  reproduced_partial: number;
  reproduced_failed: number;
  independent_confirmations: number;
  unique_environments: number;
  ci_executions: number;
  maintainer_attestations: number;
  official_references: number;
  last_success_at: number | null;
  last_failure_at: number | null;
}

function toTally(row: ConfidenceRow | null): EvidenceTally {
  return {
    reproducedPassed: row?.reproduced_passed ?? 0,
    reproducedPartial: row?.reproduced_partial ?? 0,
    reproducedFailed: row?.reproduced_failed ?? 0,
    uniqueEnvironments: row?.unique_environments ?? 0,
    independentConfirmations: row?.independent_confirmations ?? 0,
    ciExecutions: row?.ci_executions ?? 0,
    maintainerAttestations: row?.maintainer_attestations ?? 0,
    officialReferences: row?.official_references ?? 0,
    // Every published revision has author documentation by definition — publishing
    // is the author asserting they wrote and tested it.
    authorDocumented: true,
    lastSuccessAt: row?.last_success_at ?? null,
    lastFailureAt: row?.last_failure_at ?? null,
  };
}

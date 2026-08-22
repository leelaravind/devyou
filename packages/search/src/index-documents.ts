/**
 * Assembling the searchable document for a revision.
 *
 * Which text goes into which FTS column is a ranking decision, not a schema one —
 * `LEXICAL_SEARCH_SQL` weights `error_text` at 12 and `node_text` at 1, so putting a
 * string in the wrong column changes results more than any later tuning would.
 *
 * Reindexing happens on publish and on a taxonomy change. It is a full rebuild of
 * one revision's row rather than an incremental update: a revision is immutable, so
 * its document can only be wrong if it was never written, and a rebuild is a delete
 * plus an insert either way.
 */

export interface IndexableRevision {
  revisionId: string;
  playbookId: string;
  title: string;
  summary: string;
  problemTitle: string;
  problemSummary: string;
  /** Exact error strings and normalised messages from `problem_signatures`. */
  errorStrings: readonly string[];
  symptoms: readonly string[];
  nodes: ReadonlyArray<{ title: string; body: string; expectedOutput: string | null }>;
  technologies: ReadonlyArray<{ name: string; aliases: readonly string[] }>;
  versionLabels: readonly string[];
}

export interface SearchDocument {
  revisionId: string;
  playbookId: string;
  title: string;
  summary: string;
  errorText: string;
  nodeText: string;
  technologyText: string;
}

export function buildSearchDocument(revision: IndexableRevision): SearchDocument {
  /*
    `error_text` carries only machine-produced strings.

    Prose about an error goes in `summary` or `node_text`. Mixing the two would
    dilute the column that the ranking trusts most — the point of weighting it at 12
    is that a match there is almost always the thing the reader pasted.
  */
  const errorText = [
    ...revision.errorStrings,
    ...revision.nodes.map((node) => node.expectedOutput ?? ""),
  ]
    .filter(Boolean)
    .join("\n");

  const nodeText = revision.nodes
    .flatMap((node) => [node.title, node.body])
    .filter(Boolean)
    .join("\n");

  /*
    Aliases are indexed alongside names, and that is most of the value of the
    taxonomy. Nobody searches for "PostgreSQL"; they paste `SQLSTATE 40001`, and the
    only reason that resolves to a Postgres playbook is that the alias is in here.
  */
  const technologyText = revision.technologies
    .flatMap((technology) => [technology.name, ...technology.aliases])
    .concat(revision.versionLabels)
    .join(" ");

  return {
    revisionId: revision.revisionId,
    playbookId: revision.playbookId,
    title: [revision.title, revision.problemTitle].filter(Boolean).join(" — "),
    summary: [revision.summary, revision.problemSummary, ...revision.symptoms]
      .filter(Boolean)
      .join("\n"),
    errorText,
    nodeText,
    technologyText,
  };
}

export const DELETE_DOCUMENT_SQL = `DELETE FROM playbook_fts WHERE revision_id = ?1`;

export const INSERT_DOCUMENT_SQL = `
  INSERT INTO playbook_fts (revision_id, playbook_id, title, summary, error_text, node_text, technology_text)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
`;

export const DELETE_SIGNATURE_DOCUMENT_SQL = `DELETE FROM signature_fts WHERE signature_id = ?1`;

export const INSERT_SIGNATURE_DOCUMENT_SQL = `
  INSERT INTO signature_fts (signature_id, problem_id, error_code, normalized_message)
  VALUES (?1, ?2, ?3, ?4)
`;

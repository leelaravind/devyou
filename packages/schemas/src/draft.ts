import { z } from "zod";
import {
  BRANCH_CONDITIONS,
  NODE_TYPES,
  PROVENANCE,
  SAFETY_LEVELS,
  SOURCE_TYPES,
} from "@devyou/core";

/**
 * The draft document.
 *
 * One schema for the whole of a contribution between capture and publication —
 * what the AI proposes, what the author edits, and what the publish batch reads.
 * It is stored as JSON in `contribution_drafts.structured_json` and validated on
 * every read, because a column holding JSON is a column that will eventually hold
 * something written by an older version of this code.
 *
 * Two properties are load-bearing.
 *
 * **It is not the published shape.** Nodes carry a `key` local to the draft, not a
 * `diagnostic_nodes.id`, and edges refer to those keys. Nothing here can name a row
 * in a published revision, so no amount of editing a draft can reach one — which is
 * the same guarantee the cross-revision edge trigger gives, arriving earlier.
 *
 * **It carries no provenance.** Which fields the model inferred is recorded in
 * `draft_field_provenance`, a table the publish gate reads. Keeping it out of the
 * document means a contributor cannot clear a confirmation requirement by editing
 * the JSON, and the gate cannot be satisfied by the same thing it is checking.
 */

/** A node's identity inside a draft. Stable across edits so an edge survives its
 *  endpoints being retitled, reordered, or having a sibling deleted. */
export const DraftNodeKey = z
  .string()
  .regex(/^n[0-9]{1,4}$/, "a node key looks like n1, n2, n3");

export const DraftNode = z.object({
  key: DraftNodeKey,
  nodeType: z.enum(NODE_TYPES),
  title: z.string().max(200),
  body: z.string().max(4000),
  commandText: z.string().max(2000).nullable(),
  commandLanguage: z.string().max(40).nullable(),
  expectedOutput: z.string().max(2000).nullable(),
  /**
   * The author's classification, which is a floor and never a ceiling.
   *
   * The deterministic classifier in `@devyou/security` runs over the same command
   * at the publish gate and the more severe of the two wins. Storing the author's
   * answer separately is what lets the editor show them that they were overruled,
   * rather than silently rewriting a field they chose.
   */
  safetyLevel: z.enum(SAFETY_LEVELS),
  safetyEffect: z.string().max(500).nullable(),
});
export type DraftNode = z.infer<typeof DraftNode>;

export const DraftEdge = z.object({
  fromKey: DraftNodeKey,
  toKey: DraftNodeKey,
  condition: z.enum(BRANCH_CONDITIONS),
  label: z.string().max(120).nullable(),
});
export type DraftEdge = z.infer<typeof DraftEdge>;

export const DraftConstraint = z.object({
  technologySlug: z.string().max(80),
  minSemver: z.string().max(40).nullable(),
  maxSemver: z.string().max(40).nullable(),
  maxInclusive: z.boolean(),
  architecture: z.string().max(40).nullable(),
  kind: z.enum(["required", "known_affected", "known_unaffected"]),
});
export type DraftConstraint = z.infer<typeof DraftConstraint>;

export const DraftSource = z.object({
  url: z.string().max(500),
  title: z.string().max(200),
  sourceType: z.enum(SOURCE_TYPES),
});
export type DraftSource = z.infer<typeof DraftSource>;

export const DraftDocument = z.object({
  title: z.string().max(200),
  summary: z.string().max(1000),
  /** Required by the publish gate on a revision of an existing playbook, and
   *  meaningless on a first revision. Empty rather than absent, so the shape does
   *  not change between the two cases. */
  changeSummary: z.string().max(1000),
  problemTitle: z.string().max(200),
  problemSummary: z.string().max(1000),
  symptoms: z.array(z.string().max(300)).max(10),
  errorSignatures: z
    .array(
      z.object({
        errorCode: z.string().max(80).nullable(),
        normalisedMessage: z.string().max(500),
      }),
    )
    .max(8),
  /** Slugs of existing `technologies` rows only. A contributor cannot mint
   *  taxonomy — `taxonomy:create` is an administrative capability, and a
   *  free-text technology would file the playbook where nobody searches. */
  technologySlugs: z.array(z.string().max(80)).max(12),
  constraints: z.array(DraftConstraint).max(12),
  nodes: z.array(DraftNode).max(40),
  edges: z.array(DraftEdge).max(80),
  sources: z.array(DraftSource).max(10),
  /** What the model could not determine, kept verbatim and shown to the author.
   *  A structuring that quietly fills its own gaps produces a playbook whose holes
   *  nobody knows about. */
  gaps: z.array(z.string().max(300)).max(12),
  /** Instruction-shaped text the model found in the submission, reported as
   *  content. Shown on the review screen so the author sees what a reviewer will. */
  suspiciousContent: z.array(z.string().max(300)).max(10),
});
export type DraftDocument = z.infer<typeof DraftDocument>;

/**
 * A blank document.
 *
 * Exists because the review screen must work when there is no AI proposal at all —
 * an unconfigured provider, an exhausted budget, a refusal, or a contributor who
 * would rather write it themselves. Structuring is assistance; a pipeline that
 * stops without it would have made the model load-bearing.
 */
export function emptyDraftDocument(): DraftDocument {
  return {
    title: "",
    summary: "",
    changeSummary: "",
    problemTitle: "",
    problemSummary: "",
    symptoms: [],
    errorSignatures: [],
    technologySlugs: [],
    constraints: [],
    nodes: [
      {
        key: "n1",
        nodeType: "start",
        title: "",
        body: "",
        commandText: null,
        commandLanguage: null,
        expectedOutput: null,
        safetyLevel: "informational",
        safetyEffect: null,
      },
    ],
    edges: [],
    sources: [],
    gaps: [],
    suspiciousContent: [],
  };
}

/** The next unused node key in a document. Never reuses a deleted one: an edge
 *  left pointing at a removed node must fail validation loudly rather than
 *  silently reattach to whatever took its place. */
export function nextNodeKey(document: DraftDocument): string {
  let highest = 0;
  for (const node of document.nodes) {
    const value = Number.parseInt(node.key.slice(1), 10);
    if (Number.isFinite(value) && value > highest) highest = value;
  }
  return `n${highest + 1}`;
}

/* ---------------------------------------------------------------------------
   Provenance
   --------------------------------------------------------------------------- */

export const DraftFieldProvenance = z.object({
  /** JSON pointer into the document, e.g. `/nodes/2/expectedOutput`. */
  fieldPath: z.string().max(200),
  provenance: z.enum(PROVENANCE),
  /** What the model proposed, kept even after the author corrects it. It is the
   *  record of what the structuring got wrong, which is the only way to tell
   *  whether it is improving. */
  originalValue: z.string().max(4000).nullable(),
  /** The model's one-sentence reason, shown beside the field on the review screen.
   *  A confirmation checkbox next to an inference the author cannot evaluate is a
   *  checkbox people tick. */
  basis: z.string().max(300).nullable(),
});
export type DraftFieldProvenance = z.infer<typeof DraftFieldProvenance>;

/**
 * Read a field out of a document by the pointer stored against its provenance.
 *
 * Deliberately narrow: it resolves `/field` and `/nodes/<index>/field` and nothing
 * else, because those are the only shapes anything writes. A general JSON-pointer
 * evaluator would happily walk a path a hostile `structured_json` invented.
 */
export function readFieldPath(document: DraftDocument, fieldPath: string): string | null {
  const parts = fieldPath.split("/").filter((part) => part !== "");

  if (parts.length === 1) {
    const value = (document as unknown as Record<string, unknown>)[parts[0] as string];
    return typeof value === "string" ? value : null;
  }

  if (parts.length === 3 && parts[0] === "nodes") {
    const node = document.nodes[Number.parseInt(parts[1] as string, 10)];
    if (!node) return null;
    const value = (node as unknown as Record<string, unknown>)[parts[2] as string];
    return typeof value === "string" ? value : null;
  }

  return null;
}

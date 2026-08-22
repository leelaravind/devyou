import type { BranchCondition } from "@devyou/core";
import { BRANCH_CONDITIONS } from "@devyou/core";
import type { GraphEdge, GraphNode } from "@devyou/domain";

/**
 * The diagnostic path, encoded in the URL.
 *
 * The session engine in `@devyou/domain` is pure and takes an explicit state value.
 * This is where that state lives for an anonymous reader: in the query string, as
 * `?steps=n1.passed~n2.failed`.
 *
 * Four things fall out of that choice, and together they are why it beats a
 * server-side session row:
 *
 * - **It works with JavaScript disabled.** Each answer is a plain link or form
 *   submission to a new URL. Plan §16 and the Phase 12 gate require the knowledge
 *   path to work without client JS, and a diagnosis that needs JS to advance is a
 *   diagnosis half the crawlers and every text browser cannot follow.
 * - **It is shareable.** "Here is where I got to" is a URL you can paste into an
 *   incident channel. That is the atomic unit of sharing the adoption research
 *   identifies as most valuable, and a server-side session id would not be it.
 * - **It requires no identity.** Plan §0.7: reading needs no account, and an
 *   anonymous reader should not be issued a tracking cookie merely for answering a
 *   question.
 * - **Backtracking is truncation.** R-28 wants a reader to revisit an earlier step
 *   and invalidate everything after it. Here that is `steps.slice(0, index)` — there
 *   is no downstream state to forget, because the URL never held any.
 *
 * The cost is a URL that grows with the path. A twelve-step diagnosis is roughly 150
 * characters, which is well inside every limit that matters.
 */

export interface PathStep {
  nodeId: string;
  condition: BranchCondition;
}

const STEP_SEPARATOR = "~";
const FIELD_SEPARATOR = ".";

/** Beyond this the path is not a diagnosis, it is somebody generating a URL. */
const MAX_STEPS = 40;

export function encodePath(steps: readonly PathStep[]): string {
  return steps
    .slice(0, MAX_STEPS)
    .map((step) => `${step.nodeId}${FIELD_SEPARATOR}${step.condition}`)
    .join(STEP_SEPARATOR);
}

/**
 * Decode, and validate against the graph as we go.
 *
 * Every step is checked against the edges of *this* revision: the node must exist,
 * the condition must be one it offers, and the step must follow from the previous
 * one. A path that stops validating is truncated at that point rather than rejected,
 * because the commonest cause is not an attack — it is a link shared before the
 * playbook was revised, and truncating leaves the reader at the last step that still
 * means something instead of at an error page.
 */
export function decodePath(
  encoded: string | null,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): { steps: PathStep[]; truncated: boolean } {
  if (!encoded) return { steps: [], truncated: false };

  const start = nodes.find((node) => node.nodeType === "start");
  if (!start) return { steps: [], truncated: false };

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const steps: PathStep[] = [];
  let current = start.id;

  const raw = encoded.split(STEP_SEPARATOR).slice(0, MAX_STEPS);

  for (const entry of raw) {
    const separator = entry.lastIndexOf(FIELD_SEPARATOR);
    if (separator <= 0) return { steps, truncated: true };

    const nodeId = entry.slice(0, separator);
    const condition = entry.slice(separator + 1);

    if (nodeId !== current) return { steps, truncated: true };
    if (!byId.has(nodeId)) return { steps, truncated: true };
    if (!(BRANCH_CONDITIONS as readonly string[]).includes(condition)) {
      return { steps, truncated: true };
    }

    const edge = edges.find(
      (candidate) => candidate.fromNodeId === nodeId && candidate.conditionType === condition,
    );
    if (!edge) return { steps, truncated: true };

    steps.push({ nodeId, condition: condition as BranchCondition });
    current = edge.toNodeId;
  }

  return { steps, truncated: false };
}

/** Where the reader is now, after following the decoded path. */
export function currentNodeId(
  steps: readonly PathStep[],
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): string | null {
  const start = nodes.find((node) => node.nodeType === "start");
  if (!start) return null;

  let current = start.id;
  for (const step of steps) {
    const edge = edges.find(
      (candidate) => candidate.fromNodeId === step.nodeId && candidate.conditionType === step.condition,
    );
    if (!edge) return current;
    current = edge.toNodeId;
  }
  return current;
}

/** The nodes visited, in order, including the current one. */
export function visitedNodeIds(
  steps: readonly PathStep[],
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): string[] {
  const start = nodes.find((node) => node.nodeType === "start");
  if (!start) return [];

  const visited = [start.id];
  let current = start.id;

  for (const step of steps) {
    const edge = edges.find(
      (candidate) => candidate.fromNodeId === step.nodeId && candidate.conditionType === step.condition,
    );
    if (!edge) break;
    visited.push(edge.toNodeId);
    current = edge.toNodeId;
  }

  void current;
  return visited;
}

/** Truncate to just before the given node — the backtracking operation. */
export function backtrackPath(steps: readonly PathStep[], nodeId: string): PathStep[] {
  const index = steps.findIndex((step) => step.nodeId === nodeId);
  return index === -1 ? [...steps] : steps.slice(0, index);
}

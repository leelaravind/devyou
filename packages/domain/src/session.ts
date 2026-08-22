import type { BranchCondition, NodeType } from "@devyou/core";
import { ApiError } from "@devyou/core";
import type { GraphEdge, GraphNode } from "./graph.js";

/**
 * The diagnostic session engine.
 *
 * A session records where a reader is and what they observed. It does not touch the
 * playbook, and reaching a root cause creates no evidence — plan §8 is explicit
 * about both, and the second one is the more important: an automatic "this worked"
 * from arriving at a conclusion would manufacture exactly the evidence the product
 * says it never manufactures. Only an explicit submitted report becomes evidence.
 *
 * Pure functions over an explicit state value. No I/O, so every rule below is
 * testable without a database, and the persistence layer is a thin translation.
 */

export interface SessionStep {
  nodeId: string;
  observedCondition: BranchCondition | null;
  stepIndex: number;
  observedAt: number;
  invalidatedAt: number | null;
}

export interface SessionState {
  revisionId: string;
  activeNodeId: string;
  steps: SessionStep[];
  outcomeNodeId: string | null;
  completedAt: number | null;
}

export interface RevisionGraph {
  revisionId: string;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

const TERMINAL_TYPES: ReadonlySet<NodeType> = new Set(["root_cause", "fix", "terminal"]);

export function startSession(graph: RevisionGraph, now: number): SessionState {
  const start = graph.nodes.find((node) => node.nodeType === "start");
  if (!start) {
    throw new ApiError("UNPROCESSABLE", {
      publicMessage: "This playbook has no starting point.",
      internalDetail: `revision ${graph.revisionId} has no start node`,
    });
  }
  return {
    revisionId: graph.revisionId,
    activeNodeId: start.id,
    steps: [
      { nodeId: start.id, observedCondition: null, stepIndex: 0, observedAt: now, invalidatedAt: null },
    ],
    outcomeNodeId: null,
    completedAt: null,
  };
}

/**
 * Record what the reader observed, and move.
 *
 * The validation here is the engine invariant from plan §8: a branch result is
 * checked against the outcomes the *current node in this revision* actually offers.
 * A result that no edge accepts is rejected rather than quietly ignored — silently
 * dropping it would leave the reader looking at a step that did not advance, with
 * no explanation.
 */
export function observe(
  state: SessionState,
  graph: RevisionGraph,
  condition: BranchCondition,
  now: number,
): SessionState {
  assertSameRevision(state, graph);

  const current = graph.nodes.find((node) => node.id === state.activeNodeId);
  if (!current) {
    throw new ApiError("CONFLICT", {
      publicMessage: "This diagnostic session no longer matches the playbook.",
      internalDetail: `active node ${state.activeNodeId} absent from revision ${graph.revisionId}`,
    });
  }

  const options = graph.edges.filter((edge) => edge.fromNodeId === current.id);
  const chosen = options.find((edge) => edge.conditionType === condition);

  if (!chosen) {
    throw new ApiError("BAD_REQUEST", {
      publicMessage: `"${condition}" is not one of the outcomes this step offers.`,
      internalDetail: `node ${current.id} offers [${options.map((edge) => edge.conditionType).join(", ")}]`,
    });
  }

  const steps = state.steps.map((step) =>
    step.nodeId === current.id && step.invalidatedAt === null
      ? { ...step, observedCondition: condition, observedAt: now }
      : step,
  );

  const next = graph.nodes.find((node) => node.id === chosen.toNodeId);
  const isTerminal = next !== undefined && TERMINAL_TYPES.has(next.nodeType);

  steps.push({
    nodeId: chosen.toNodeId,
    observedCondition: null,
    stepIndex: nextIndex(steps),
    observedAt: now,
    invalidatedAt: null,
  });

  return {
    ...state,
    activeNodeId: chosen.toNodeId,
    steps,
    outcomeNodeId: isTerminal ? chosen.toNodeId : null,
    /*
      `completedAt` marks the end of the *diagnosis*, not a successful fix.

      Worth being precise about, because the difference is the product's whole
      argument: the reader has reached a conclusion the playbook offers. Whether it
      worked on their machine is unknown until they say so.
    */
    completedAt: isTerminal ? now : null,
  };
}

/**
 * Go back to an earlier step and invalidate everything after it.
 *
 * R-28 requires this without resetting the whole session, and plan §8 requires that
 * backtracking invalidates all downstream outcomes.
 *
 * Steps are marked invalidated rather than removed. Keeping them is what lets the
 * UI say "you changed your answer at step 2, so steps 3-5 no longer apply" instead
 * of silently losing three steps of the reader's work.
 */
export function backtrackTo(state: SessionState, nodeId: string, now: number): SessionState {
  const target = state.steps.find((step) => step.nodeId === nodeId && step.invalidatedAt === null);
  if (!target) {
    throw new ApiError("BAD_REQUEST", {
      publicMessage: "That step is not part of the path you took.",
      internalDetail: `node ${nodeId} not an active step in this session`,
    });
  }

  const steps = state.steps.map((step) => {
    if (step.invalidatedAt !== null) return step;
    if (step.stepIndex > target.stepIndex) return { ...step, invalidatedAt: now };
    if (step.stepIndex === target.stepIndex) return { ...step, observedCondition: null };
    return step;
  });

  return {
    ...state,
    activeNodeId: nodeId,
    steps,
    // The conclusion was reached through steps that no longer apply, so it is not a
    // conclusion any more.
    outcomeNodeId: null,
    completedAt: null,
  };
}

/** The path currently in effect, in order. Invalidated steps are excluded. */
export function activePath(state: SessionState): SessionStep[] {
  return state.steps
    .filter((step) => step.invalidatedAt === null)
    .sort((a, b) => a.stepIndex - b.stepIndex);
}

/** Every step, including invalidated ones — for the "you changed your answer" view. */
export function fullHistory(state: SessionState): SessionStep[] {
  return [...state.steps].sort((a, b) => a.stepIndex - b.stepIndex);
}

export interface BranchOption {
  condition: BranchCondition;
  label: string;
  toNodeId: string;
}

export function optionsAt(graph: RevisionGraph, nodeId: string): BranchOption[] {
  return graph.edges
    .filter((edge) => edge.fromNodeId === nodeId)
    .map((edge) => ({
      condition: edge.conditionType,
      label: edge.conditionType,
      toNodeId: edge.toNodeId,
    }));
}

/**
 * A session may only ever traverse one revision.
 *
 * The database will not store a cross-revision edge, and this refuses to walk one
 * even if a graph were assembled wrongly in memory. Both guards exist because the
 * failure they prevent — a reader following a step from text that was never tested
 * — is indistinguishable from correct behaviour on screen.
 */
function assertSameRevision(state: SessionState, graph: RevisionGraph): void {
  if (state.revisionId !== graph.revisionId) {
    throw new ApiError("CONFLICT", {
      publicMessage: "This playbook has changed since you started. Start again on the new version.",
      internalDetail: `session revision ${state.revisionId} vs graph ${graph.revisionId}`,
    });
  }
}

function nextIndex(steps: readonly SessionStep[]): number {
  return steps.reduce((max, step) => Math.max(max, step.stepIndex), -1) + 1;
}

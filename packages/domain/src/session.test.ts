import { describe, expect, it } from "vitest";
import type { BranchCondition, NodeType } from "@devyou/core";
import { ApiError } from "@devyou/core";
import type { GraphEdge, GraphNode } from "./graph.js";
import {
  activePath,
  backtrackTo,
  fullHistory,
  observe,
  startSession,
  type RevisionGraph,
} from "./session.js";

function node(id: string, nodeType: NodeType, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    nodeType,
    title: id,
    commandText: null,
    safetyLevel: "informational",
    safetyEffect: null,
    ...overrides,
  };
}

function edge(id: string, fromNodeId: string, toNodeId: string, conditionType: BranchCondition): GraphEdge {
  return { id, fromNodeId, toNodeId, conditionType };
}

/**
 * s -> t1 -> t2 -> t3 -> rc, each hop taken on "passed". Three test nodes deep so
 * backtracking has more than one invalidated step to exercise.
 */
function buildGraph(revisionId = "rev-1"): RevisionGraph {
  const nodes = [
    node("s", "start"),
    node("t1", "test"),
    node("t2", "test"),
    node("t3", "test"),
    node("rc", "root_cause"),
  ];
  const edges = [
    edge("e0", "s", "t1", "passed"),
    edge("e1a", "t1", "t2", "passed"),
    edge("e1b", "t1", "rc", "failed"),
    edge("e2a", "t2", "t3", "passed"),
    edge("e2b", "t2", "rc", "failed"),
    edge("e3a", "t3", "rc", "passed"),
    edge("e3b", "t3", "rc", "failed"),
  ];
  return { revisionId, nodes, edges };
}

describe("startSession", () => {
  it("throws when the graph has no start node", () => {
    const graph: RevisionGraph = { revisionId: "rev-1", nodes: [node("t", "test")], edges: [] };
    expect(() => startSession(graph, 1_000)).toThrow(ApiError);
  });
});

describe("observe", () => {
  it("throws BAD_REQUEST when the current node does not offer the given condition", () => {
    const graph = buildGraph();
    const state = startSession(graph, 1_000);

    // s only has a "passed" edge.
    let caught: unknown;
    try {
      observe(state, graph, "failed", 1_001);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("BAD_REQUEST");
  });

  it("advances activeNodeId and appends a step", () => {
    const graph = buildGraph();
    const state = startSession(graph, 1_000);

    const next = observe(state, graph, "passed", 1_001);

    expect(next.activeNodeId).toBe("t1");
    expect(next.steps).toHaveLength(2);
    expect(next.steps[1]?.nodeId).toBe("t1");
    expect(next.steps[0]?.observedCondition).toBe("passed");
  });

  it("sets outcomeNodeId and completedAt on reaching a root_cause", () => {
    const graph = buildGraph();
    let state = startSession(graph, 1_000);
    state = observe(state, graph, "passed", 1_001); // s -> t1
    state = observe(state, graph, "passed", 1_002); // t1 -> t2
    state = observe(state, graph, "passed", 1_003); // t2 -> t3
    state = observe(state, graph, "passed", 1_004); // t3 -> rc

    expect(state.outcomeNodeId).toBe("rc");
    expect(state.completedAt).toBe(1_004);
  });

  /*
    The most important test in this file.

    Plan §8 is explicit that arriving at a conclusion must never itself create
    evidence — only an explicitly submitted report does. SessionState is the only
    thing `observe` returns, so the guarantee is checkable structurally: the state
    reached by walking to a root cause must contain nothing beyond the session's own
    bookkeeping fields. If a field that could be read as evidence (a result, a
    verdict, a report id) ever appears here, that guarantee has been broken.
  */
  it("produces no evidence when a session reaches a conclusion", () => {
    const graph = buildGraph();
    let state = startSession(graph, 1_000);
    state = observe(state, graph, "passed", 1_001);
    state = observe(state, graph, "passed", 1_002);
    state = observe(state, graph, "passed", 1_003);
    state = observe(state, graph, "passed", 1_004);

    expect(state.outcomeNodeId).toBe("rc");
    expect(Object.keys(state).sort()).toEqual(
      ["activeNodeId", "completedAt", "outcomeNodeId", "revisionId", "steps"].sort(),
    );
  });
});

describe("backtrackTo", () => {
  function completedState() {
    const graph = buildGraph();
    let state = startSession(graph, 1_000);
    state = observe(state, graph, "passed", 1_001); // s -> t1 (step 1)
    state = observe(state, graph, "passed", 1_002); // t1 -> t2 (step 2)
    state = observe(state, graph, "passed", 1_003); // t2 -> t3 (step 3)
    state = observe(state, graph, "passed", 1_004); // t3 -> rc (step 4)
    return { graph, state };
  }

  it("invalidates every later step, clears outcomeNodeId and completedAt, and leaves earlier steps untouched", () => {
    const { state } = completedState();

    const back = backtrackTo(state, "t1", 2_000);

    expect(back.activeNodeId).toBe("t1");
    expect(back.outcomeNodeId).toBeNull();
    expect(back.completedAt).toBeNull();

    const t2Step = back.steps.find((step) => step.nodeId === "t2");
    const t3Step = back.steps.find((step) => step.nodeId === "t3");
    const rcStep = back.steps.find((step) => step.nodeId === "rc");
    expect(t2Step?.invalidatedAt).toBe(2_000);
    expect(t3Step?.invalidatedAt).toBe(2_000);
    expect(rcStep?.invalidatedAt).toBe(2_000);

    // The step being returned to is untouched apart from its own recorded answer,
    // which is cleared because the reader is about to answer it again.
    const t1Step = back.steps.find((step) => step.nodeId === "t1");
    expect(t1Step?.invalidatedAt).toBeNull();
    expect(t1Step?.observedCondition).toBeNull();

    // The step before the target is left completely alone.
    const sStep = back.steps.find((step) => step.nodeId === "s");
    expect(sStep?.invalidatedAt).toBeNull();
    expect(sStep?.observedCondition).toBe("passed");
  });

  it("excludes invalidated steps from activePath but keeps them in fullHistory", () => {
    const { state } = completedState();

    const back = backtrackTo(state, "t1", 2_000);

    expect(activePath(back).map((step) => step.nodeId)).toEqual(["s", "t1"]);
    expect(fullHistory(back).map((step) => step.nodeId)).toEqual(["s", "t1", "t2", "t3", "rc"]);
  });

  it("throws when the target node is not on the active path", () => {
    const { state } = completedState();
    const back = backtrackTo(state, "t1", 2_000);

    // t2 was just invalidated by the backtrack above, so it is no longer active.
    expect(() => backtrackTo(back, "t2", 3_000)).toThrow(ApiError);
  });
});

describe("revision guard", () => {
  /*
    A session may only ever traverse the revision it started on. Without this check,
    a stale client could apply a step from a graph that was never validated together
    with the session's earlier steps — indistinguishable on screen from a correct
    path, but not one anybody tested.
  */
  it("throws CONFLICT when observe is given a graph from a different revision", () => {
    const graph = buildGraph("rev-1");
    const state = startSession(graph, 1_000);
    const otherGraph = buildGraph("rev-2");

    let caught: unknown;
    try {
      observe(state, otherGraph, "passed", 1_001);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("CONFLICT");
  });
});

import { describe, expect, it } from "vitest";
import type { BranchCondition, NodeType } from "@devyou/core";
import { validateGraph, type GraphEdge, type GraphNode } from "./graph.js";

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

function edge(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  conditionType: BranchCondition,
  overrides: Partial<GraphEdge> = {},
): GraphEdge {
  return { id, fromNodeId, toNodeId, conditionType, ...overrides };
}

function errorCodes(problems: ReturnType<typeof validateGraph>["problems"]): string[] {
  return problems.filter((problem) => problem.severity === "error").map((problem) => problem.code);
}

describe("validateGraph", () => {
  it("accepts a minimal graph with a start, a test, and both outcomes reaching a root cause", () => {
    const nodes = [
      node("s", "start"),
      node("t", "test"),
      node("rc_pass", "root_cause"),
      node("rc_fail", "root_cause"),
    ];
    const edges = [
      edge("e1", "s", "t", "passed"),
      edge("e2", "t", "rc_pass", "passed"),
      edge("e3", "t", "rc_fail", "failed"),
    ];

    const result = validateGraph(nodes, edges);

    expect(result.ok).toBe(true);
    expect(errorCodes(result.problems)).toHaveLength(0);
  });

  it("fails with no_start when there is no start node", () => {
    const nodes = [node("t", "test"), node("rc", "root_cause")];
    const edges = [edge("e1", "t", "rc", "passed"), edge("e2", "t", "rc", "failed")];

    const result = validateGraph(nodes, edges);

    expect(result.ok).toBe(false);
    expect(errorCodes(result.problems)).toContain("no_start");
  });

  it("fails with multiple_starts when there is more than one start node", () => {
    const nodes = [node("s1", "start"), node("s2", "start"), node("rc", "root_cause")];
    const edges = [edge("e1", "s1", "rc", "passed"), edge("e2", "s2", "rc", "passed")];

    const result = validateGraph(nodes, edges);

    expect(result.ok).toBe(false);
    expect(errorCodes(result.problems)).toContain("multiple_starts");
  });

  it("fails with missing_branch when a test has no route for the passed outcome", () => {
    const nodes = [node("s", "start"), node("t", "test"), node("rc", "root_cause")];
    const edges = [edge("e1", "s", "t", "passed"), edge("e2", "t", "rc", "failed")];

    const result = validateGraph(nodes, edges);

    expect(result.ok).toBe(false);
    expect(errorCodes(result.problems)).toContain("missing_branch");
  });

  it("fails with missing_branch when a test has no route for the failed outcome", () => {
    const nodes = [node("s", "start"), node("t", "test"), node("rc", "root_cause")];
    const edges = [edge("e1", "s", "t", "passed"), edge("e2", "t", "rc", "passed")];

    const result = validateGraph(nodes, edges);

    expect(result.ok).toBe(false);
    expect(errorCodes(result.problems)).toContain("missing_branch");
  });

  it("warns rather than errors when a test has no route for the unknown outcome", () => {
    // A missing `unknown` route is deliberately a warning (R-27): the fallback can
    // legitimately reuse the `failed` edge, so forcing an extra edge would only
    // punish authors who already handled the case. It must not flip `ok` to false.
    const nodes = [
      node("s", "start"),
      node("t", "test"),
      node("rc_pass", "root_cause"),
      node("rc_fail", "root_cause"),
    ];
    const edges = [
      edge("e1", "s", "t", "passed"),
      edge("e2", "t", "rc_pass", "passed"),
      edge("e3", "t", "rc_fail", "failed"),
    ];

    const result = validateGraph(nodes, edges);

    expect(result.ok).toBe(true);
    const warning = result.problems.find((problem) => problem.code === "no_unknown_route");
    expect(warning?.severity).toBe("warning");
  });

  it("fails with unreachable when a node cannot be reached from the start", () => {
    const nodes = [
      node("s", "start"),
      node("t", "test"),
      node("rc_pass", "root_cause"),
      node("rc_fail", "root_cause"),
      node("orphan", "observation"),
    ];
    const edges = [
      edge("e1", "s", "t", "passed"),
      edge("e2", "t", "rc_pass", "passed"),
      edge("e3", "t", "rc_fail", "failed"),
      // orphan has an outgoing edge (so it isn't flagged as a dead end) but nothing
      // ever points to it.
      edge("e4", "orphan", "rc_pass", "passed"),
    ];

    const result = validateGraph(nodes, edges);

    expect(result.ok).toBe(false);
    const problem = result.problems.find((p) => p.code === "unreachable");
    expect(problem?.nodeId).toBe("orphan");
  });

  it("fails with no_conclusion when every path loops between tests and never reaches a conclusion", () => {
    const nodes = [node("s", "start"), node("t1", "test"), node("t2", "test")];
    const edges = [
      edge("e1", "s", "t1", "passed"),
      edge("e2", "t1", "t2", "passed"),
      edge("e3", "t1", "t2", "failed"),
      edge("e4", "t2", "t1", "passed"),
      edge("e5", "t2", "t1", "failed"),
    ];

    const result = validateGraph(nodes, edges);

    expect(result.ok).toBe(false);
    expect(errorCodes(result.problems)).toContain("no_conclusion");
  });

  it("fails with edge_dangling when an edge points at a node that is not in the node list", () => {
    const nodes = [node("s", "start"), node("t", "test"), node("rc", "root_cause")];
    const edges = [
      edge("e1", "s", "t", "passed"),
      edge("e2", "t", "rc", "passed"),
      edge("e3", "t", "ghost", "failed"),
    ];

    const result = validateGraph(nodes, edges);

    expect(result.ok).toBe(false);
    const problem = result.problems.find((p) => p.code === "edge_dangling");
    expect(problem?.edgeId).toBe("e3");
  });

  it("fails with unexplained_effect when a non-informational command has no stated safety effect", () => {
    const nodes = [
      node("s", "start"),
      node("t", "test", {
        commandText: "rm -rf ./build",
        safetyLevel: "destructive",
        safetyEffect: null,
      }),
      node("rc", "root_cause"),
    ];
    const edges = [
      edge("e1", "s", "t", "passed"),
      edge("e2", "t", "rc", "passed"),
      edge("e3", "t", "rc", "failed"),
    ];

    const result = validateGraph(nodes, edges);

    expect(result.ok).toBe(false);
    const problem = result.problems.find((p) => p.code === "unexplained_effect");
    expect(problem?.nodeId).toBe("t");
  });

  it("warns on a cycle but still publishes when a conclusion remains reachable", () => {
    // t1 <-> t2 is a genuine cycle, but t1's failed edge and t2's passed edge both
    // escape to the root cause, so the graph is still publishable. The warning
    // exists to make an author look, not to block them (a cycle with no escape is
    // instead caught by no_conclusion above).
    const nodes = [node("s", "start"), node("t1", "test"), node("t2", "test"), node("rc", "root_cause")];
    const edges = [
      edge("e1", "s", "t1", "passed"),
      edge("e2", "t1", "t2", "passed"),
      edge("e3", "t1", "rc", "failed"),
      edge("e4", "t2", "rc", "passed"),
      edge("e5", "t2", "t1", "failed"),
    ];

    const result = validateGraph(nodes, edges);

    expect(result.ok).toBe(true);
    const warning = result.problems.find((problem) => problem.code === "cycle");
    expect(warning?.severity).toBe("warning");
  });
});

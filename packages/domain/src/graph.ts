import type { BranchCondition, NodeType, SafetyLevel } from "@devyou/core";
import { BRANCH_CONDITIONS } from "@devyou/core";

/**
 * Diagnostic graph validation.
 *
 * Runs before a draft may be published. Everything it rejects is something that
 * would strand a reader mid-diagnosis — a test with no branch for the outcome they
 * saw, a path that leads nowhere, a node whose command nobody classified.
 *
 * The database enforces the two structural rules that must never be violable at all
 * (edges stay within one revision; a published graph is frozen). This validates the
 * rules that are about *usefulness*, which a trigger cannot express.
 */

export interface GraphNode {
  id: string;
  nodeType: NodeType;
  title: string;
  commandText: string | null;
  safetyLevel: SafetyLevel;
  safetyEffect: string | null;
}

export interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  conditionType: BranchCondition;
}

export interface GraphProblem {
  /** `error` blocks publication. `warning` does not — it is shown to the author,
   *  who may know something the validator does not. */
  severity: "error" | "warning";
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

const TERMINAL_TYPES: ReadonlySet<NodeType> = new Set(["root_cause", "fix", "terminal"]);

/**
 * Node types a reader can be asked to respond to. Only these need outgoing edges.
 *
 * `verification` is here, and it was initially in neither set — which made it the
 * one node type that could silently be a dead end. That is the worst place for the
 * gap to be: a verification node asks "did the fix work?", so a reader who answers
 * "no" is somebody the playbook has just failed, and they are exactly who most needs
 * a next step.
 */
const BRANCHING_TYPES: ReadonlySet<NodeType> = new Set([
  "start",
  "test",
  "observation",
  "verification",
]);

/** Node types that must offer both a pass and a fail route. */
const REQUIRES_PASS_AND_FAIL: ReadonlySet<NodeType> = new Set(["test", "verification"]);

export interface ValidationResult {
  ok: boolean;
  problems: GraphProblem[];
}

export function validateGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): ValidationResult {
  const problems: GraphProblem[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();

  for (const edge of edges) {
    if (!byId.has(edge.fromNodeId) || !byId.has(edge.toNodeId)) {
      problems.push({
        severity: "error",
        code: "edge_dangling",
        edgeId: edge.id,
        message: "An edge points at a node that is not part of this revision.",
      });
      continue;
    }
    (outgoing.get(edge.fromNodeId) ?? outgoing.set(edge.fromNodeId, []).get(edge.fromNodeId)!).push(edge);
    (incoming.get(edge.toNodeId) ?? incoming.set(edge.toNodeId, []).get(edge.toNodeId)!).push(edge);
  }

  /* ---- exactly one start ------------------------------------------------- */

  const starts = nodes.filter((node) => node.nodeType === "start");
  if (starts.length === 0) {
    problems.push({
      severity: "error",
      code: "no_start",
      message: "There is no start node, so a reader has nowhere to begin.",
    });
  } else if (starts.length > 1) {
    problems.push({
      severity: "error",
      code: "multiple_starts",
      message: `There are ${starts.length} start nodes. A diagnosis has one entry point.`,
    });
  }

  /* ---- every branching node offers a route for every outcome ------------- */

  for (const node of nodes) {
    const out = outgoing.get(node.id) ?? [];

    if (BRANCHING_TYPES.has(node.nodeType)) {
      if (out.length === 0) {
        problems.push({
          severity: "error",
          code: "branch_dead_end",
          nodeId: node.id,
          message: `"${node.title}" asks the reader to do something but has no next step for any outcome.`,
        });
        continue;
      }

      const covered = new Set(out.map((edge) => edge.conditionType));

      /*
        `passed` and `failed` are both required on a test.

        A test with only a pass branch is the commonest way a playbook strands
        somebody: it works for the author, so the failure path was never written,
        and the reader who most needs help is the one who hits it.
      */
      if (REQUIRES_PASS_AND_FAIL.has(node.nodeType)) {
        for (const required of ["passed", "failed"] as const) {
          if (!covered.has(required)) {
            problems.push({
              severity: "error",
              code: "missing_branch",
              nodeId: node.id,
              message: `"${node.title}" has no route for the "${required}" outcome.`,
            });
          }
        }

        /*
          A missing `unknown` route is a warning, not an error.

          R-27 requires somewhere to go when a reader cannot tell what happened, and
          the fallback can legitimately be the same node as `failed`. Making it an
          error would force authors to draw an edge they have already covered; making
          it silent would let the case be forgotten. A warning is the honest middle.
        */
        if (!covered.has("unknown")) {
          problems.push({
            severity: "warning",
            code: "no_unknown_route",
            nodeId: node.id,
            message: `"${node.title}" has no route for "I can't tell". Readers who are unsure will be stuck.`,
          });
        }
      }

      for (const edge of out) {
        if (!(BRANCH_CONDITIONS as readonly string[]).includes(edge.conditionType)) {
          problems.push({
            severity: "error",
            code: "unknown_condition",
            edgeId: edge.id,
            message: `"${edge.conditionType}" is not a recognised branch outcome.`,
          });
        }
      }
    }

    if (TERMINAL_TYPES.has(node.nodeType) && out.length > 0 && node.nodeType !== "fix") {
      problems.push({
        severity: "warning",
        code: "terminal_has_exit",
        nodeId: node.id,
        message: `"${node.title}" is a conclusion but continues to another step.`,
      });
    }

    /* ---- command safety ------------------------------------------------- */

    if (node.commandText !== null && node.commandText.trim() !== "") {
      if (node.safetyLevel !== "informational" && !node.safetyEffect) {
        problems.push({
          severity: "error",
          code: "unexplained_effect",
          nodeId: node.id,
          message: `"${node.title}" runs a ${node.safetyLevel.replace("_", " ")} command but does not say what it changes.`,
        });
      }
    }
  }

  /* ---- reachability ------------------------------------------------------ */

  const start = starts[0];
  if (start) {
    const reachable = reachableFrom(start.id, outgoing);

    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        problems.push({
          severity: "error",
          code: "unreachable",
          nodeId: node.id,
          message: `"${node.title}" cannot be reached from the start.`,
        });
      }
    }

    /*
      At least one conclusion must be reachable.

      A graph of tests that never reaches a root cause or a fix is a questionnaire.
      This is the single check that most directly encodes what the product is for.
    */
    const reachesConclusion = nodes.some(
      (node) => reachable.has(node.id) && TERMINAL_TYPES.has(node.nodeType),
    );
    if (!reachesConclusion) {
      problems.push({
        severity: "error",
        code: "no_conclusion",
        message: "No root cause or fix can be reached. A diagnosis has to end somewhere.",
      });
    }
  }

  /* ---- cycles ------------------------------------------------------------ */

  /*
    Cycles are a warning, not an error.

    Loops are legitimate here — "restart the service and re-run the check" is a real
    diagnostic step. What is not legitimate is a loop with no exit, which is caught
    by the reachability check above: a cycle that cannot reach a conclusion fails
    `no_conclusion`. So the warning exists to make an author look, not to stop them.
  */
  for (const cycle of findCycles(nodes, outgoing)) {
    problems.push({
      severity: "warning",
      code: "cycle",
      nodeId: cycle,
      message: "This step can be reached again from itself. Make sure there is a way out.",
    });
  }

  return { ok: !problems.some((problem) => problem.severity === "error"), problems };
}

function reachableFrom(startId: string, outgoing: Map<string, GraphEdge[]>): Set<string> {
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const edge of outgoing.get(current) ?? []) {
      if (!seen.has(edge.toNodeId)) {
        seen.add(edge.toNodeId);
        queue.push(edge.toNodeId);
      }
    }
  }
  return seen;
}

/** Node ids that participate in a cycle. Iterative rather than recursive — a
 *  malformed graph should produce a validation error, not a stack overflow. */
function findCycles(nodes: readonly GraphNode[], outgoing: Map<string, GraphEdge[]>): string[] {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>(nodes.map((node) => [node.id, WHITE]));
  const found: string[] = [];

  for (const node of nodes) {
    if (colour.get(node.id) !== WHITE) continue;

    const stack: Array<{ id: string; index: number }> = [{ id: node.id, index: 0 }];
    colour.set(node.id, GREY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { id: string; index: number };
      const edges = outgoing.get(frame.id) ?? [];

      if (frame.index >= edges.length) {
        colour.set(frame.id, BLACK);
        stack.pop();
        continue;
      }

      const next = edges[frame.index] as GraphEdge;
      frame.index += 1;
      const state = colour.get(next.toNodeId);

      if (state === GREY) {
        if (!found.includes(next.toNodeId)) found.push(next.toNodeId);
      } else if (state === WHITE) {
        colour.set(next.toNodeId, GREY);
        stack.push({ id: next.toNodeId, index: 0 });
      }
    }
  }

  return found;
}

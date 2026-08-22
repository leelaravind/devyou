import { Link, useSearchParams } from "react-router";
import {
  Card,
  CodeBlock,
  DiagnosticNode,
  DiagnosticTree,
  Icon,
  SplitView,
  Tag,
  type NodeStatus,
} from "@devyou/ui";
import { BRANCH_CONDITION_LABELS, type BranchCondition, type SafetyLevel } from "@devyou/core";
import type { Route } from "./+types/p.$slug.diagnose";
import { cloudflareContext } from "../context/cloudflare";
import { applicabilityFor, loadRevisionBySlug, type RevisionView } from "../lib/playbook.server";
import { readEnvironmentCookie } from "../lib/environment.server";
import {
  backtrackPath,
  currentNodeId,
  decodePath,
  encodePath,
  visitedNodeIds,
  type PathStep,
} from "../lib/session-path";

/**
 * The interactive diagnostic session.
 *
 * One test at a time, and the whole state is in the URL — see `session-path.ts` for
 * why. Every control on this page is a plain link, so the flow works with JavaScript
 * disabled and every intermediate state is shareable.
 *
 * The layout is the split view the UX research asks for (R-25): the Map on the left
 * — the steps taken, where you are, what is left — and the Territory on the right,
 * holding only the active step's command, expected output and warnings. Below 1024px
 * they stack, with the Territory first, because on a phone the active step is the
 * work and the map is orientation.
 *
 * **Reaching a root cause creates no evidence.** Plan §8. Nothing on this page
 * writes to the database at all; the reproduction report is a separate, explicit
 * submission.
 */

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [
    { title: data ? `Diagnosing: ${data.revision.title} — DEV.ITISYOU` : "Diagnose" },
    /*
      A session URL is a position in someone's diagnosis, not a document. Indexing
      the states would fill the index with thousands of near-duplicate pages that
      all point at one playbook, and `/p/:slug` is that playbook.
    */
    { name: "robots", content: "noindex, follow" },
  ];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const revision = await loadRevisionBySlug(env.DB, params.slug);
  if (!revision) throw new Response(null, { status: 404 });

  const url = new URL(request.url);
  const { steps, truncated } = decodePath(url.searchParams.get("steps"), revision.nodes, revision.edges);
  const activeId = currentNodeId(steps, revision.nodes, revision.edges);
  const environment = readEnvironmentCookie(request);

  return {
    revision,
    steps,
    truncated,
    activeId,
    applicability: applicabilityFor(revision, environment),
  };
}

export default function Diagnose({ loaderData }: Route.ComponentProps) {
  const { revision, steps, truncated, activeId } = loaderData;
  const [params] = useSearchParams();

  const visited = visitedNodeIds(steps, revision.nodes, revision.edges);
  const active = revision.nodes.find((node) => node.id === activeId) ?? null;
  const isTerminal =
    active !== null && ["root_cause", "fix", "terminal"].includes(active.nodeType);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-outline-variant bg-surface-container-low px-margin py-3">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-gutter">
          <div className="min-w-0">
            <Link
              to={`/p/${revision.playbookSlug}`}
              className="flex items-center gap-1 font-mono text-env-tag text-on-surface-variant hover:text-on-surface"
            >
              <Icon name="arrow_back" size={13} />
              Back to the playbook
            </Link>
            <h1 className="truncate font-headline text-headline-md text-on-surface">
              {revision.title}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {revision.technologies.slice(0, 3).map((technology) => (
              <Tag key={technology.slug}>{technology.name}</Tag>
            ))}
            <span className="font-mono text-env-tag text-on-surface-variant">
              revision {revision.revisionNumber}
            </span>
          </div>
        </div>
      </header>

      {truncated && (
        <div className="flex items-start gap-2 border-b border-warning-amber bg-surface-container-low px-margin py-2 text-body-sm text-warning-amber">
          <Icon name="warning" size={15} className="mt-0.5 shrink-0" />
          <p>
            Part of that path no longer matches this playbook, so it stops at the last step that
            still does. This usually means the link was shared before the playbook was revised.
          </p>
        </div>
      )}

      <SplitView
        mapLabel="Steps taken"
        territoryLabel="Current step"
        map={
          <Map
            revision={revision}
            steps={steps}
            visited={visited}
            activeId={activeId}
            search={params.toString()}
          />
        }
        territory={
          active ? (
            <Territory
              revision={revision}
              node={active}
              steps={steps}
              isTerminal={isTerminal}
              applicability={loaderData.applicability}
            />
          ) : (
            <p className="text-body-md text-on-surface-variant">
              This playbook has no starting point.
            </p>
          )
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function Map({
  revision,
  steps,
  visited,
  activeId,
}: {
  revision: RevisionView;
  steps: readonly PathStep[];
  visited: readonly string[];
  activeId: string | null;
  search: string;
}) {
  const remaining = revision.nodes.filter((node) => !visited.includes(node.id));

  return (
    <div>
      <h2 className="mb-gutter font-headline text-headline-md text-on-surface">Diagnostic tree</h2>

      <DiagnosticTree label="Steps you have taken">
        {visited.map((nodeId) => {
          const node = revision.nodes.find((candidate) => candidate.id === nodeId);
          if (!node) return null;
          const step = steps.find((candidate) => candidate.nodeId === nodeId);
          const detail = revision.nodeBodies.get(node.id);

          return (
            <DiagnosticNode
              key={nodeId}
              title={node.title}
              summary={
                step
                  ? `You reported: ${BRANCH_CONDITION_LABELS[step.condition]}`
                  : (detail?.body.split("\n")[0] ?? undefined)
              }
              status={statusFor(node.id, activeId, step?.condition)}
              {...(step
                ? {
                    onRevisit: undefined,
                  }
                : {})}
            >
              {step && (
                /*
                  Backtracking is a link, not a button with a handler.

                  It has to work without JavaScript, and the destination is simply
                  the same page with a shorter path — which is also why it needs no
                  confirmation dialogue: nothing is destroyed, and the browser's back
                  button restores the longer path exactly.
                */
                <Link
                  to={`?steps=${encodePath(backtrackPath(steps, nodeId))}`}
                  className="mt-1 flex items-center gap-1 font-mono text-env-tag text-evidence-blue hover:underline"
                >
                  <Icon name="history" size={12} />
                  Change this answer — clears every later step
                </Link>
              )}
            </DiagnosticNode>
          );
        })}
      </DiagnosticTree>

      {remaining.length > 0 && (
        <details className="mt-margin">
          {/*
            The rest of the tree, behind a disclosure.

            R-26: showing a fifty-node tree at once "induces cognitive paralysis".
            The path taken is always visible; everything else is one click away and
            still in the HTML, so a screen reader and a crawler both reach it.
          */}
          <summary className="cursor-pointer font-mono text-label-caps uppercase text-on-surface-variant">
            View the whole map ({remaining.length} more step
            {remaining.length === 1 ? "" : "s"})
          </summary>
          <ul className="mt-2 flex list-none flex-col gap-1 text-body-sm text-on-surface-variant">
            {remaining.map((node) => (
              <li key={node.id} className="flex items-start gap-2 opacity-70">
                <Icon name="chevron_right" size={13} className="mt-0.5 shrink-0" />
                {node.title}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Territory({
  revision,
  node,
  steps,
  isTerminal,
  applicability,
}: {
  revision: RevisionView;
  node: RevisionView["nodes"][number];
  steps: readonly PathStep[];
  isTerminal: boolean;
  applicability: ReturnType<typeof applicabilityFor>;
}) {
  const detail = revision.nodeBodies.get(node.id);
  const options = revision.edges.filter((edge) => edge.fromNodeId === node.id);

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-margin">
      {applicability && applicability.verdict === "mismatch" && (
        <div className="flex items-start gap-2 rounded border border-warning-amber bg-surface-container-low p-3 text-body-sm text-warning-amber">
          <Icon name="warning" size={15} className="mt-0.5 shrink-0" />
          <p>{applicability.explanation} You can still work through it, but expect differences.</p>
        </div>
      )}

      <div>
        <p className="mb-1 flex items-center gap-2 font-mono text-label-caps uppercase text-on-surface-variant">
          <Icon name={isTerminal ? "lightbulb" : "science"} size={14} />
          {isTerminal ? "Conclusion" : "What to test"}
        </p>
        <h2 className="font-headline text-headline-md text-on-surface">{node.title}</h2>
      </div>

      {detail?.body && (
        <p className="whitespace-pre-wrap text-body-md text-on-surface-variant">{detail.body}</p>
      )}

      {detail?.commandText && (
        <CodeBlock
          code={detail.commandText}
          language={detail.commandLanguage ?? "sh"}
          safety={detail.safetyLevel as SafetyLevel}
          {...(detail.safetyEffect ? { effect: detail.safetyEffect } : {})}
        />
      )}

      {detail?.expectedOutput && (
        <div>
          <p className="mb-1 font-mono text-label-caps uppercase text-on-surface-variant">
            Expected result
          </p>
          <pre
            tabIndex={0}
            className="dv-scroll-thin overflow-x-auto rounded border border-dashed border-outline-variant bg-surface-container-lowest p-3 text-code-block whitespace-pre text-on-surface-variant"
          >
            <code className="font-mono">{detail.expectedOutput}</code>
          </pre>
        </div>
      )}

      {options.length > 0 ? (
        <section aria-labelledby="what-happened">
          <h3
            id="what-happened"
            className="mb-2 font-headline text-body-md font-semibold text-on-surface"
          >
            What happened?
          </h3>
          <div
            /*
              `aria-live` so a screen-reader user hears the new step after choosing an
              outcome. Plan §18 asks for live regions on branch changes; the page is a
              full navigation, so this announces the newly rendered step.
            */
            aria-live="polite"
            className="grid gap-2 sm:grid-cols-2"
          >
            {options.map((edge) => (
              <Link
                key={edge.id}
                to={`?steps=${encodePath([...steps, { nodeId: node.id, condition: edge.conditionType }])}`}
                className={`flex items-center gap-2 rounded border p-3 text-body-md transition-colors ${outcomeClass(edge.conditionType)}`}
              >
                <Icon name={outcomeIcon(edge.conditionType)} size={16} />
                {edge.conditionType === "unknown"
                  ? "I can't tell"
                  : BRANCH_CONDITION_LABELS[edge.conditionType]}
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <TerminalActions revision={revision} node={node} steps={steps} />
      )}
    </div>
  );
}

/**
 * What to offer at the end of a path.
 *
 * The reproduction prompt appears here and only here, and it is a link to an
 * explicit form — not a one-click "it worked". R-31 wants the whole flow inside
 * 10-30 seconds, which the form achieves by prefilling the environment; what it must
 * not do is record an outcome the reader never stated.
 */
function TerminalActions({
  revision,
  node,
  steps,
}: {
  revision: RevisionView;
  node: RevisionView["nodes"][number];
  steps: readonly PathStep[];
}) {
  const reachedParam = `?revision=${revision.revisionId}&node=${node.id}&steps=${encodePath(steps)}`;

  return (
    <Card as="section">
      <h3 className="mb-1 font-headline text-body-md font-semibold text-on-surface">
        Did this work for you?
      </h3>
      <p className="mb-3 text-body-sm text-on-surface-variant">
        Whatever the answer. A failure recorded against your exact versions is worth more to the
        next person than a success against versions they do not have.
      </p>

      <div className="flex flex-wrap gap-2">
        <Link
          to={`/p/${revision.playbookSlug}/report${reachedParam}&outcome=worked`}
          className="inline-flex items-center gap-2 rounded border border-status-ci-verified/60 px-4 py-2 font-mono text-label-caps uppercase text-status-ci-verified hover:bg-surface-container-highest"
        >
          <Icon name="check_circle" size={14} />
          Worked
        </Link>
        <Link
          to={`/p/${revision.playbookSlug}/report${reachedParam}&outcome=partial`}
          className="inline-flex items-center gap-2 rounded border border-warning-amber/60 px-4 py-2 font-mono text-label-caps uppercase text-warning-amber hover:bg-surface-container-highest"
        >
          <Icon name="warning" size={14} />
          Partly
        </Link>
        <Link
          to={`/p/${revision.playbookSlug}/report${reachedParam}&outcome=failed`}
          className="inline-flex items-center gap-2 rounded border border-destructive-red/60 px-4 py-2 font-mono text-label-caps uppercase text-destructive-red hover:bg-surface-container-highest"
        >
          <Icon name="error" size={14} />
          Failed
        </Link>
      </div>

      {/*
        The dead-end escape hatch, on every terminal node.

        R-27: "every terminal dead-end offers 'none of these worked → contribute a
        new branch'". Without it, the reader the playbook failed has nowhere to go,
        and the knowledge of *why* it failed leaves with them.
      */}
      <p className="mt-4 border-t border-outline-variant pt-3 text-body-sm text-on-surface-variant">
        None of this matched what you saw?{" "}
        <Link
          to={`/p/${revision.playbookSlug}/propose?node=${node.id}`}
          className="text-evidence-blue underline"
        >
          Propose a missing branch or test
        </Link>
        .
      </p>
    </Card>
  );
}

function statusFor(
  nodeId: string,
  activeId: string | null,
  condition: BranchCondition | undefined,
): NodeStatus {
  if (nodeId === activeId) return "active";
  if (condition === "passed") return "passed";
  if (condition === "failed") return "failed";
  if (condition === "different_output") return "partial";
  if (condition === "skip") return "skipped";
  return "pending";
}

function outcomeClass(condition: BranchCondition): string {
  switch (condition) {
    case "passed":
      return "border-status-ci-verified/50 text-status-ci-verified hover:bg-surface-container-highest";
    case "failed":
      return "border-destructive-red/50 text-destructive-red hover:bg-surface-container-highest";
    case "different_output":
      return "border-warning-amber/50 text-warning-amber hover:bg-surface-container-highest";
    default:
      return "border-outline-variant text-on-surface-variant hover:bg-surface-container-highest";
  }
}

function outcomeIcon(
  condition: BranchCondition,
): "check_circle" | "error" | "warning" | "help" | "chevron_right" {
  switch (condition) {
    case "passed":
      return "check_circle";
    case "failed":
      return "error";
    case "different_output":
      return "warning";
    case "unknown":
      return "help";
    default:
      return "chevron_right";
  }
}

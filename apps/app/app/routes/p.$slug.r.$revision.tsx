import { Link } from "react-router";
import { Card, CodeBlock, ConfidenceBadge, Icon, Tag } from "@devyou/ui";
import type { SafetyLevel } from "@devyou/core";
import { parseMarkdown, type MdNode } from "@devyou/security";
import type { Route } from "./+types/p.$slug.r.$revision";
import { cloudflareContext } from "../context/cloudflare";
import {
  applicabilityFor,
  confidenceFor,
  loadRevisionByNumber,
  type RevisionView,
} from "../lib/playbook.server";
import { readEnvironmentCookie } from "../lib/environment.server";

/**
 * A historical revision, at its permanent URL.
 *
 * Plan §9 requires `/p/:slug/r/:number` to keep resolving for as long as the
 * revision exists, including after it is superseded or deprecated — a 404 here
 * would destroy the evidence trail that justified the change. This page is close to
 * `p.$slug.tsx` on purpose: `loadRevisionByNumber` returns the same `RevisionView`
 * shape `loadRevisionBySlug` does, scoped to this exact revision, so its confidence
 * band, tally and evidence link all belong to *this* text, never to whatever the
 * playbook currently says.
 *
 * `p.$slug.tsx`'s markup is not imported here because none of it is exported —
 * only its `meta`, `loader` and default component are, and rightly so, since it is
 * the canonical page and its internals are not a public API. What follows is a
 * deliberately leaner re-rendering of the same content, plus the banner and
 * indexing rules a historical page needs and the current one does not.
 */

export function meta({ loaderData: data }: Route.MetaArgs) {
  if (!data) return [{ title: "Not found — DEV.ITISYOU" }];

  const { revision, publicUrl } = data;
  const ownUrl = `${publicUrl}/p/${revision.playbookSlug}/r/${revision.revisionNumber}`;
  const currentUrl = `${publicUrl}/p/${revision.playbookSlug}`;

  return [
    { title: `${revision.title} (revision ${revision.revisionNumber}) — DEV.ITISYOU` },
    { name: "description", content: truncate(revision.summary, 155) },
    /*
      Canonical points at the current revision's URL whenever this is not it. The
      historical page stays crawlable and linkable — plan §9 — but its text is close
      enough to the current revision's that a search engine should treat the current
      URL as the page of record rather than indexing every past wording separately.
    */
    { tagName: "link", rel: "canonical", href: revision.isCurrent ? ownUrl : currentUrl },
    ...(revision.isCurrent ? [] : [{ name: "robots", content: "noindex, follow" }]),
  ];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  /*
    A non-numeric revision is a 404, not a crash. `Number("")` and `Number(" ")` are
    both falsy-adjacent surprises, which is why the check is `Number.isInteger` and
    an explicit lower bound rather than a truthiness test.
  */
  const revisionNumber = Number(params.revision);
  if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
    throw new Response(null, { status: 404 });
  }

  const { env } = context.get(cloudflareContext);
  const revision = await loadRevisionByNumber(env.DB, params.slug, revisionNumber);
  if (!revision) throw new Response(null, { status: 404 });

  const environment = readEnvironmentCookie(request);
  const { band, explanation } = confidenceFor(revision);

  return {
    revision,
    band,
    explanation,
    applicability: applicabilityFor(revision, environment),
    publicUrl: env.PUBLIC_APP_URL,
  };
}

export default function HistoricalRevision({ loaderData }: Route.ComponentProps) {
  const { revision, band, explanation, applicability } = loaderData;
  const ordered = orderedNodes(revision);

  return (
    <main id="main" className="mx-auto flex w-full max-w-[900px] flex-col gap-margin px-margin py-8">
      <nav aria-label="Breadcrumb" className="font-mono text-env-tag text-on-surface-variant">
        <Link to={`/p/${revision.playbookSlug}`} className="hover:underline">
          {truncate(revision.title, 60)}
        </Link>{" "}
        /{" "}
        <Link to={`/p/${revision.playbookSlug}/history`} className="hover:underline">
          History
        </Link>{" "}
        / <span className="text-on-surface">Revision {revision.revisionNumber}</span>
      </nav>

      <RevisionBanner revision={revision} />

      <header className="flex flex-col gap-3">
        <h1 className="font-headline text-headline-lg text-on-surface">{revision.title}</h1>
        <p className="text-body-md text-on-surface-variant">{revision.summary}</p>

        <div className="flex flex-wrap items-center gap-2">
          {revision.technologies.map((technology) => (
            <Link key={technology.slug} to={`/t/${technology.slug}`}>
              <Tag tone={toneFor(technology.type)}>{technology.name}</Tag>
            </Link>
          ))}
        </div>

        <ConfidenceBadge
          band={band}
          counts={{
            reproducedPassed: revision.tally.reproducedPassed,
            reproducedFailed: revision.tally.reproducedFailed,
            reproducedPartial: revision.tally.reproducedPartial,
            uniqueEnvironments: revision.tally.uniqueEnvironments,
          }}
          explainHref="#why-this-confidence"
        />

        <div className="flex flex-wrap items-center gap-3 font-mono text-env-tag text-on-surface-variant">
          <span>Revision {revision.revisionNumber}</span>
          {revision.publishedAt && (
            <span>
              published{" "}
              <time dateTime={new Date(revision.publishedAt * 1000).toISOString()}>
                {formatDate(revision.publishedAt)}
              </time>
            </span>
          )}
          {revision.authorHandle && (
            <span>
              by{" "}
              <Link to={`/profile/${revision.authorHandle}`} className="underline">
                {revision.authorDisplayName ?? revision.authorHandle}
              </Link>
            </span>
          )}
        </div>
      </header>

      <Applicability revision={revision} applicability={applicability} />

      {revision.symptoms.length > 0 && (
        <section aria-labelledby="symptoms">
          <h2 id="symptoms" className="mb-2 font-headline text-headline-md text-on-surface">
            Symptoms
          </h2>
          <ul className="flex list-none flex-col gap-1 text-body-sm text-on-surface-variant">
            {revision.symptoms.map((symptom) => (
              <li key={symptom} className="flex items-start gap-2">
                <Icon name="chevron_right" size={14} className="mt-0.5 shrink-0" />
                {symptom}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="steps">
        <h2 id="steps" className="mb-1 font-headline text-headline-md text-on-surface">
          The diagnostic path
        </h2>
        <p className="mb-gutter text-body-sm text-on-surface-variant">
          {ordered.length} step{ordered.length === 1 ? "" : "s"}, exactly as this revision published
          them.
        </p>

        <ol className="flex list-none flex-col gap-gutter">
          {ordered.map((node, index) => (
            <li key={node.id}>
              <StepCard revision={revision} node={node} index={index} ordered={ordered} />
            </li>
          ))}
        </ol>
      </section>

      {revision.sources.length > 0 && (
        <section aria-labelledby="sources">
          <h2 id="sources" className="mb-2 font-headline text-headline-md text-on-surface">
            Sources
          </h2>
          <ul className="flex list-none flex-col gap-1 text-body-sm">
            {revision.sources.map((source) => (
              <li key={source.url} className="flex items-start gap-2">
                <Icon name="link" size={14} className="mt-0.5 shrink-0 text-on-surface-variant" />
                <a
                  href={source.url}
                  rel="ugc nofollow noopener noreferrer"
                  className="text-evidence-blue underline"
                >
                  {source.title}
                </a>
                {source.publisher && (
                  <span className="text-on-surface-variant">— {source.publisher}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card as="section" id="why-this-confidence">
        <h2 className="mb-2 font-headline text-body-md font-semibold text-on-surface">
          Why this confidence?
        </h2>
        <ul className="mb-3 flex list-none flex-col gap-1 text-body-sm text-on-surface-variant">
          {explanation.reasons.map((reason) => (
            <li key={reason} className="flex items-start gap-2">
              <Icon name="chevron_right" size={13} className="mt-0.5 shrink-0" />
              {reason}
            </li>
          ))}
        </ul>
        {explanation.whatWouldStrengthenIt.length > 0 && (
          <p className="text-body-sm text-on-surface-variant">
            <strong className="text-on-surface">What would strengthen it:</strong>{" "}
            {explanation.whatWouldStrengthenIt.join(" ")}
          </p>
        )}
        <p className="mt-3 border-t border-outline-variant pt-3 text-body-sm text-on-surface-variant">
          This counts only what was recorded against revision {revision.revisionNumber} itself.
          Nothing reported against another revision is included here — see the{" "}
          <Link to={`/p/${revision.playbookSlug}/history`} className="underline">
            revision history
          </Link>{" "}
          for why.
        </p>
      </Card>
    </main>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * The banner every historical revision gets, current or not.
 *
 * Loud, and not a redirect — a superseded or deprecated revision stays at its own
 * URL because evidence points at it (plan §9). A reader who lands here from an old
 * link is told plainly which revision this is and where the current one lives,
 * above everything else on the page.
 */
function RevisionBanner({ revision }: { revision: RevisionView }) {
  const lifecycle = revision.deprecatedAt !== null ? "deprecated" : revision.supersededAt !== null ? "superseded" : "none";

  const toneClass =
    lifecycle === "deprecated"
      ? "border-destructive-red text-destructive-red"
      : lifecycle === "superseded"
        ? "border-warning-amber text-warning-amber"
        : "border-outline-variant text-on-surface-variant";

  const icon = lifecycle === "deprecated" ? "block" : lifecycle === "superseded" ? "history" : "description";

  return (
    <div className={`flex items-start gap-2 rounded border bg-surface-container-low p-3 text-body-sm ${toneClass}`}>
      <Icon name={icon} size={16} className="mt-0.5 shrink-0" />
      <p>
        <strong>
          Revision {revision.revisionNumber}
          {revision.isCurrent ? " — the current text." : "."}
        </strong>{" "}
        {lifecycle === "deprecated" &&
          `${revision.deprecationReason ?? "This approach is no longer recommended."} `}
        {lifecycle === "superseded" && "A newer revision has replaced this one. "}
        {!revision.isCurrent && (
          <>
            <Link to={`/p/${revision.playbookSlug}`} className="underline">
              Read the current revision
              {revision.currentRevisionNumber !== null ? ` (${revision.currentRevisionNumber})` : ""}
            </Link>
            .{" "}
          </>
        )}
        The evidence on this page is this revision&rsquo;s own — it has not been carried forward
        from, or to, any other revision.
      </p>
    </div>
  );
}

function Applicability({
  revision,
  applicability,
}: {
  revision: RevisionView;
  applicability: ReturnType<typeof applicabilityFor>;
}) {
  if (revision.constraints.length === 0) return null;

  return (
    <Card as="section">
      <h2 className="mb-2 flex items-center gap-2 font-headline text-body-md font-semibold text-on-surface">
        <Icon name="hub" size={16} className="text-evidence-blue" />
        Where this applies
      </h2>

      <ul className="mb-2 flex list-none flex-wrap gap-2">
        {revision.constraints.map((constraint) => (
          <li key={`${constraint.technologyId}-${constraint.constraintKind}`}>
            <span
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-env-tag ${
                constraint.constraintKind === "known_unaffected"
                  ? "border-outline-variant text-on-surface-variant line-through"
                  : "border-outline-variant text-on-surface"
              }`}
            >
              {constraint.technologyName}
              {formatRange(constraint.minSemver, constraint.maxSemver, constraint.maxInclusive)}
            </span>
          </li>
        ))}
      </ul>

      {applicability ? (
        <p
          className={`flex items-start gap-2 text-body-sm ${
            applicability.verdict === "matches"
              ? "text-status-ci-verified"
              : applicability.verdict === "mismatch"
                ? "text-warning-amber"
                : "text-on-surface-variant"
          }`}
        >
          <Icon
            name={
              applicability.verdict === "matches"
                ? "check_circle"
                : applicability.verdict === "mismatch"
                  ? "warning"
                  : "help"
            }
            size={14}
            className="mt-0.5 shrink-0"
          />
          {applicability.explanation}
        </p>
      ) : (
        <p className="text-body-sm text-on-surface-variant">
          <Link to="/environment" className="text-evidence-blue underline">
            Tell us your versions
          </Link>{" "}
          and this page will say whether it applies to you.
        </p>
      )}
    </Card>
  );
}

const NODE_TYPE_LABEL: Record<string, string> = {
  start: "Start",
  test: "Test",
  observation: "Observation",
  root_cause: "Root cause",
  fix: "Fix",
  verification: "Verify the fix",
  terminal: "End",
};

function StepCard({
  revision,
  node,
  index,
  ordered,
}: {
  revision: RevisionView;
  node: RevisionView["nodes"][number];
  index: number;
  ordered: RevisionView["nodes"];
}) {
  const detail = revision.nodeBodies.get(node.id);
  const outgoing = revision.edges.filter((edge) => edge.fromNodeId === node.id);

  return (
    <Card as="article" className="scroll-mt-24" padded>
      <h3 className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-label-caps uppercase text-on-surface-variant">
          Step {index + 1} · {NODE_TYPE_LABEL[node.nodeType] ?? node.nodeType}
        </span>
        <span className="font-headline text-body-md font-semibold text-on-surface">
          {node.title}
        </span>
      </h3>

      {detail?.body && <Markdown source={detail.body} />}

      {detail?.commandText && (
        <div className="mt-3">
          <CodeBlock
            code={detail.commandText}
            language={detail.commandLanguage ?? "sh"}
            safety={detail.safetyLevel as SafetyLevel}
            {...(detail.safetyEffect ? { effect: detail.safetyEffect } : {})}
          />
        </div>
      )}

      {detail?.expectedOutput && (
        <div className="mt-3">
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

      {outgoing.length > 0 && (
        <div className="mt-3 border-t border-outline-variant pt-2">
          <p className="mb-1 font-mono text-label-caps uppercase text-on-surface-variant">
            What happens next
          </p>
          <ul className="flex list-none flex-col gap-1 text-body-sm text-on-surface-variant">
            {outgoing.map((edge) => {
              const targetIndex = ordered.findIndex((candidate) => candidate.id === edge.toNodeId);
              const target = ordered[targetIndex];
              return (
                <li key={edge.id} className="flex items-start gap-2">
                  <Icon name="chevron_right" size={13} className="mt-0.5 shrink-0" />
                  <span>
                    <strong className="text-on-surface">
                      {edge.conditionType.replace("_", " ")}
                    </strong>{" "}
                    → {target ? `step ${targetIndex + 1}, ${target.title}` : "end"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** Render a Markdown subset from the sanitising parser. Same rationale as
 *  `p.$slug.tsx`: the parser returns an AST, so there is nowhere for
 *  `dangerouslySetInnerHTML` to enter, on a historical revision any more than a
 *  current one. */
function Markdown({ source }: { source: string }) {
  return <div className="flex flex-col gap-2">{parseMarkdown(source).map(renderNode)}</div>;
}

function renderNode(node: MdNode, index: number): React.ReactNode {
  switch (node.type) {
    case "paragraph":
      return (
        <p key={index} className="text-body-sm text-on-surface-variant">
          {node.children.map(renderNode)}
        </p>
      );
    case "heading":
      return (
        <p key={index} className="font-headline text-body-md font-semibold text-on-surface">
          {node.children.map(renderNode)}
        </p>
      );
    case "code_block":
      return (
        <pre
          key={index}
          tabIndex={0}
          className="dv-scroll-thin overflow-x-auto rounded border border-outline-variant bg-surface-container-lowest p-3 text-code-block whitespace-pre"
        >
          <code className="font-mono text-on-surface">{node.code}</code>
        </pre>
      );
    case "inline_code":
      return (
        <code
          key={index}
          className="rounded bg-surface-variant px-1 font-mono text-code-block text-on-surface"
        >
          {node.code}
        </code>
      );
    case "list":
      return (
        <ul key={index} className="ml-4 flex list-disc flex-col gap-1 text-body-sm text-on-surface-variant">
          {node.items.map(renderNode)}
        </ul>
      );
    case "list_item":
      return <li key={index}>{node.children.map(renderNode)}</li>;
    case "link":
      return node.verdict.safe ? (
        <a
          key={index}
          href={node.href}
          rel="ugc nofollow noopener noreferrer"
          className="text-evidence-blue underline"
        >
          {node.children.map(renderNode)}
        </a>
      ) : (
        <span key={index} className="text-on-surface-variant">
          {node.children.map(renderNode)} <span className="font-mono text-env-tag">({node.href})</span>
        </span>
      );
    case "strong":
      return (
        <strong key={index} className="text-on-surface">
          {node.children.map(renderNode)}
        </strong>
      );
    case "em":
      return <em key={index}>{node.children.map(renderNode)}</em>;
    case "blockquote":
      return (
        <blockquote
          key={index}
          className="border-l-2 border-outline-variant pl-3 text-body-sm text-on-surface-variant"
        >
          {node.children.map(renderNode)}
        </blockquote>
      );
    case "text":
      return <span key={index}>{node.value}</span>;
  }
}

/** Same breadth-first reading order as `p.$slug.tsx` — see that file's comment for
 *  why orphans are appended rather than dropped. */
function orderedNodes(revision: RevisionView): RevisionView["nodes"] {
  const start = revision.nodes.find((node) => node.nodeType === "start");
  if (!start) return revision.nodes;

  const seen = new Set<string>([start.id]);
  const order = [start];
  const queue = [start.id];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of revision.edges.filter((candidate) => candidate.fromNodeId === current)) {
      if (seen.has(edge.toNodeId)) continue;
      const next = revision.nodes.find((node) => node.id === edge.toNodeId);
      if (!next) continue;
      seen.add(next.id);
      order.push(next);
      queue.push(next.id);
    }
  }

  return [...order, ...revision.nodes.filter((node) => !seen.has(node.id))];
}

function formatRange(min: string | null, max: string | null, inclusive: boolean): string {
  const readable = (value: string) =>
    value
      .split(".")
      .map((part) => String(Number(part)))
      .join(".");
  if (min && max) return ` ${readable(min)}–${inclusive ? "" : "<"}${readable(max)}`;
  if (min) return ` ≥${readable(min)}`;
  if (max) return ` ${inclusive ? "≤" : "<"}${readable(max)}`;
  return "";
}

function toneFor(type: string): "neutral" | "os" | "runtime" | "framework" {
  if (type === "os") return "os";
  if (type === "runtime" || type === "language") return "runtime";
  if (type === "framework" || type === "library") return "framework";
  return "neutral";
}

function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

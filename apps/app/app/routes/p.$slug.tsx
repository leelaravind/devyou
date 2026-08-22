import { Link } from "react-router";
import { Card, CodeBlock, ConfidenceBadge, Icon, Tag } from "@devyou/ui";
import type { SafetyLevel } from "@devyou/core";
import { parseMarkdown, type MdNode } from "@devyou/security";
import type { Route } from "./+types/p.$slug";
import { cloudflareContext } from "../context/cloudflare";
import {
  applicabilityFor,
  confidenceFor,
  loadRevisionBySlug,
  type RevisionView,
} from "../lib/playbook.server";
import { readEnvironmentCookie } from "../lib/environment.server";

/**
 * The canonical playbook page.
 *
 * Everything a reader needs is in the server-rendered HTML: the applicability, the
 * evidence summary, and **the full text of every diagnostic step in order**. Plan
 * §16 requires it for crawlers, §18 requires it as the accessible alternative to the
 * graphical tree, and the Phase 12 gate tests it with JavaScript disabled.
 *
 * The interactive session at `/p/:slug/diagnose` is an enhancement on top of this,
 * not a replacement for it. If the JavaScript never loads, the reader still has the
 * whole playbook — they simply have to decide which branch applies themselves.
 */

export function meta({ loaderData: data }: Route.MetaArgs) {
  if (!data) return [{ title: "Not found — DEV.ITISYOU" }];

  const { revision, band } = data;
  const canonical = `${data.publicUrl}/p/${revision.playbookSlug}`;

  return [
    { title: `${revision.title} — DEV.ITISYOU` },
    { name: "description", content: truncate(revision.summary, 155) },
    { tagName: "link", rel: "canonical", href: canonical },
    { property: "og:title", content: revision.title },
    { property: "og:description", content: truncate(revision.summary, 200) },
    { property: "og:type", content: "article" },
    { property: "og:url", content: canonical },
    /*
      `TechArticle`, not `QAPage` or `HowTo`.

      Plan §16 warns against misusing QAPage, and it would be a misuse: this is not a
      question with answers, and marking it up as one invites a rich result that
      misrepresents the page. `HowTo` is closer but asserts a linear procedure, which
      is exactly what a branching diagnostic is not.
    */
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        headline: revision.title,
        description: revision.summary,
        url: canonical,
        datePublished: revision.publishedAt
          ? new Date(revision.publishedAt * 1000).toISOString()
          : undefined,
        author: revision.authorDisplayName
          ? { "@type": "Person", name: revision.authorDisplayName }
          : undefined,
        about: revision.technologies.map((technology) => ({
          "@type": "Thing",
          name: technology.name,
        })),
        version: String(revision.revisionNumber),
      },
    },
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Playbooks", item: `${data.publicUrl}/playbooks` },
          ...revision.technologies.slice(0, 1).map((technology, index) => ({
            "@type": "ListItem" as const,
            position: 2 + index,
            name: technology.name,
            item: `${data.publicUrl}/t/${technology.slug}`,
          })),
          { "@type": "ListItem", position: 3, name: revision.title, item: canonical },
        ],
      },
    },
    ...(band === "deprecated" ? [{ name: "robots", content: "noindex, follow" }] : []),
  ];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const revision = await loadRevisionBySlug(env.DB, params.slug);

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

export default function Playbook({ loaderData }: Route.ComponentProps) {
  const { revision, band, explanation, applicability } = loaderData;
  const ordered = orderedNodes(revision);

  return (
    <main id="main" className="mx-auto flex w-full max-w-[900px] flex-col gap-margin px-margin py-8">
      <Breadcrumbs revision={revision} />

      <LifecycleBanner revision={revision} />

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
          explainHref={`/p/${revision.playbookSlug}/evidence`}
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
          {revision.tally.lastSuccessAt && (
            <span>
              last reproduced{" "}
              <time dateTime={new Date(revision.tally.lastSuccessAt * 1000).toISOString()}>
                {formatDate(revision.tally.lastSuccessAt)}
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
          <Link to={`/p/${revision.playbookSlug}/history`} className="underline">
            revision history
          </Link>
        </div>
      </header>

      <Applicability revision={revision} applicability={applicability} />

      <div className="flex flex-wrap gap-2">
        <Link
          to={`/p/${revision.playbookSlug}/diagnose`}
          className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 font-mono text-label-caps uppercase text-on-primary"
        >
          <Icon name="science" size={14} />
          Run the diagnosis
        </Link>
        <Link
          to={`/p/${revision.playbookSlug}/evidence`}
          className="inline-flex items-center gap-2 rounded border border-outline-variant px-4 py-2 font-mono text-label-caps uppercase text-on-surface-variant hover:bg-surface-container-highest"
        >
          <Icon name="fingerprint" size={14} />
          Evidence and compatibility
        </Link>
      </div>

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

      {/*
        The whole diagnostic path, in the HTML.

        Not a summary and not a teaser. This section is what a crawler indexes, what
        a screen reader reads, and what somebody with JavaScript disabled uses. The
        branches are stated as prose ("If this passed, go to step 4") so the graph
        survives being flattened into a list.
      */}
      <section aria-labelledby="steps">
        <h2 id="steps" className="mb-1 font-headline text-headline-md text-on-surface">
          The diagnostic path
        </h2>
        <p className="mb-gutter text-body-sm text-on-surface-variant">
          {ordered.length} step{ordered.length === 1 ? "" : "s"}. Every step is written out below
          in full — the interactive version simply follows the branches for you.
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

      <Card as="section">
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
      </Card>
    </main>
  );
}

/* ------------------------------------------------------------------------- */

function Breadcrumbs({ revision }: { revision: RevisionView }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex list-none flex-wrap items-center gap-1 font-mono text-env-tag text-on-surface-variant">
        <li>
          <Link to="/playbooks" className="hover:underline">
            Playbooks
          </Link>
        </li>
        {revision.technologies[0] && (
          <>
            <li aria-hidden>/</li>
            <li>
              <Link to={`/t/${revision.technologies[0].slug}`} className="hover:underline">
                {revision.technologies[0].name}
              </Link>
            </li>
          </>
        )}
        <li aria-hidden>/</li>
        <li aria-current="page" className="text-on-surface">
          {truncate(revision.title, 60)}
        </li>
      </ol>
    </nav>
  );
}

/**
 * The lifecycle banner.
 *
 * Deliberately loud, and deliberately not a redirect. A superseded revision stays at
 * its own URL because evidence points at it — but a reader who arrived from a
 * two-year-old Stack Overflow comment must be told, above the content, that a newer
 * version exists.
 */
function LifecycleBanner({ revision }: { revision: RevisionView }) {
  if (revision.deprecatedAt !== null) {
    return (
      <div className="flex items-start gap-2 rounded border border-destructive-red bg-surface-container-low p-3 text-body-sm text-destructive-red">
        <Icon name="block" size={16} className="mt-0.5 shrink-0" />
        <p>
          <strong>Deprecated.</strong>{" "}
          {revision.deprecationReason ?? "This approach is no longer recommended."} The evidence
          below is kept as history — it describes what was true, not what is.
        </p>
      </div>
    );
  }

  if (revision.supersededAt !== null) {
    return (
      <div className="flex items-start gap-2 rounded border border-warning-amber bg-surface-container-low p-3 text-body-sm text-warning-amber">
        <Icon name="history" size={16} className="mt-0.5 shrink-0" />
        <p>
          <strong>Superseded.</strong> A newer revision of this playbook exists.{" "}
          <Link to={`/p/${revision.playbookSlug}`} className="underline">
            Read revision {revision.currentRevisionNumber}
          </Link>
          . Evidence on this page describes this text only and has not been carried forward.
        </p>
      </div>
    );
  }

  if (revision.needsReverificationAt !== null) {
    return (
      <div className="flex items-start gap-2 rounded border border-warning-amber bg-surface-container-low p-3 text-body-sm text-warning-amber">
        <Icon name="schedule" size={16} className="mt-0.5 shrink-0" />
        <p>
          <strong>Needs reverification.</strong>{" "}
          {revision.needsReverificationReason ??
            "Nobody has confirmed this recently, or things have moved on since it was written."}{" "}
          If you try it, telling us what happened is the most useful thing you can do here.
        </p>
      </div>
    );
  }

  return null;
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

/**
 * Render a Markdown subset from the sanitising parser.
 *
 * The parser returns an AST rather than an HTML string, so there is no point in this
 * codebase where playbook prose could become markup. `dangerouslySetInnerHTML` is a
 * lint error precisely so this stays true.
 */
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
        // An unsafe link is shown as text with its URL, never as a link. Hiding it
        // entirely would silently alter what the contributor wrote.
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

/**
 * A reading order for a branching graph.
 *
 * Breadth-first from the start node, which keeps a test and its immediate outcomes
 * adjacent. Any node the traversal misses is appended, so a graph that somehow
 * contains an orphan still renders every step rather than silently dropping one —
 * the validator rejects orphans at publication, but a page that hides content
 * because of a data problem is worse than one that shows it out of order.
 */
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

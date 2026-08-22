import { Form, Link, useSearchParams } from "react-router";
import { Card, Icon, Tag, Textarea, Button } from "@devyou/ui";
import type { Route } from "./+types/search";
import { cloudflareContext } from "../context/cloudflare";
import { runSearch, recordSearchEvent, type EnrichedHit } from "../lib/search.server";
import { readEnvironmentCookie } from "../lib/environment.server";

export function meta({ location }: Route.MetaArgs) {
  const query = new URLSearchParams(location.search).get("q") ?? "";
  const title = query ? `${truncate(query, 60)} — DEV.ITISYOU` : "Search — DEV.ITISYOU";
  return [
    { title },
    /*
      Search result pages are noindex.

      Plan §16 wants the *knowledge* indexed, not the queries. An indexable search
      page with a user-supplied query in its title is a doorway page, and a corpus
      of them is the fastest way to be treated as spam by the search engines whose
      traffic this product depends on.
    */
    { name: "robots", content: "noindex, follow" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";

  if (query.trim() === "") {
    return { query: "", hits: [], advice: null, environmentLabel: null, total: 0 };
  }

  const environment = readEnvironmentCookie(request);
  const filters = {
    technologies: url.searchParams.getAll("tech"),
    osFamily: url.searchParams.get("os"),
    version: url.searchParams.get("version"),
    currentOnly: url.searchParams.get("include") !== "all",
  };

  const outcome = await runSearch(env.DB, query, filters, { environment });

  /*
    Telemetry after the response is prepared, never before it.

    `waitUntil` so a slow insert cannot add latency to a search, and so a failure to
    record an event cannot fail the search itself. Measuring the product must not
    degrade it.
  */
  ctx.waitUntil(
    recordSearchEvent(env.DB, outcome, {
      hadEnvironmentFilter: environment !== null,
      sessionBucket: null,
    }).catch(() => undefined),
  );

  return {
    query,
    hits: outcome.hits,
    advice: outcome.advice,
    total: outcome.total,
    environmentLabel: environment?.osFamily
      ? [environment.osFamily, environment.osVersion].filter(Boolean).join(" ")
      : null,
  };
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { query, hits, advice, total, environmentLabel } = loaderData;
  const [params] = useSearchParams();

  return (
    <main id="main" className="mx-auto flex w-full max-w-[1280px] flex-col gap-margin px-margin py-8">
      <Form method="get" role="search" className="flex flex-col gap-2">
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <Textarea
          id="q"
          name="q"
          mono
          rows={query.includes("\n") ? 6 : 2}
          defaultValue={query}
          placeholder="Paste an error, stack trace, log, or describe what's broken..."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" iconLeft="search">
            Search
          </Button>
          {environmentLabel ? (
            <span className="flex items-center gap-1 font-mono text-env-tag text-on-surface-variant">
              <Icon name="hub" size={13} />
              Matching against {environmentLabel}
              <Link to="/environment" className="ml-1 text-evidence-blue underline">
                change
              </Link>
            </span>
          ) : (
            <Link
              to="/environment"
              className="flex items-center gap-1 font-mono text-env-tag text-evidence-blue underline"
            >
              <Icon name="hub" size={13} />
              Tell us your environment to filter these
            </Link>
          )}
        </div>
      </Form>

      {query.trim() !== "" && (
        <p className="font-mono text-env-tag uppercase text-on-surface-variant">
          {total === 0
            ? "No diagnostic paths matched"
            : `Showing ${total} relevant diagnostic path${total === 1 ? "" : "s"}`}
        </p>
      )}

      <ol className="flex list-none flex-col gap-gutter">
        {hits.map((hit, index) => (
          <li key={hit.revisionId}>
            <ResultCard hit={hit} isTop={index === 0} />
          </li>
        ))}
      </ol>

      {advice && <NoResults advice={advice} query={query} />}

      {query.trim() !== "" && hits.length > 0 && (
        <Card className="text-center" as="section">
          <h2 className="mb-2 font-headline text-headline-md text-on-surface">
            Didn&rsquo;t find your exact scenario?
          </h2>
          <p className="mx-auto mb-4 max-w-xl text-body-sm text-on-surface-variant">
            Coverage here is deliberately narrow and deep. If you work this one out, writing it
            down is what makes it findable for the next person.
          </p>
          <Link
            to={`/contribute?q=${encodeURIComponent(query.slice(0, 500))}`}
            className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 font-mono text-label-caps uppercase text-on-primary"
          >
            <Icon name="add" size={14} />
            Contribute this problem
          </Link>
        </Card>
      )}

      {params.get("include") !== "all" && hits.length > 0 && (
        <p className="text-center text-body-sm text-on-surface-variant">
          <Link to={`/search?q=${encodeURIComponent(query)}&include=all`} className="underline">
            Also show superseded and deprecated playbooks
          </Link>
          {" — "}kept readable so the evidence trail survives.
        </p>
      )}
    </main>
  );
}

const MATCH_LABEL: Record<EnrichedHit["matchKind"], { label: string; icon: "verified" | "search" }> =
  {
    exact_signature: { label: "Exact error match", icon: "verified" },
    error_code: { label: "Error code match", icon: "verified" },
    lexical: { label: "Related", icon: "search" },
  };

const BAND_LABEL: Record<string, string> = {
  unverified: "Documented",
  limited_evidence: "Limited evidence",
  moderate_evidence: "Moderate evidence",
  strong_evidence: "Strong evidence",
  needs_reverification: "Needs reverification",
  deprecated: "Deprecated",
};

function ResultCard({ hit, isTop }: { hit: EnrichedHit; isTop: boolean }) {
  const match = MATCH_LABEL[hit.matchKind];
  const totalReports = hit.reproducedPassed + hit.reproducedPartial + hit.reproducedFailed;

  return (
    <Card
      as="article"
      interactive
      className={isTop && hit.matchKind !== "lexical" ? "border-l-2 border-l-evidence-blue" : ""}
    >
      <div className="mb-1 flex flex-wrap items-start gap-2">
        <h2 className="font-headline text-body-md font-semibold text-on-surface">
          <Link to={`/p/${hit.playbookSlug}`} className="hover:underline">
            {hit.title}
          </Link>
        </h2>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-label-caps uppercase ${
            hit.matchKind === "lexical"
              ? "border-outline-variant text-on-surface-variant"
              : "border-evidence-blue/50 text-evidence-blue"
          }`}
        >
          <Icon name={match.icon} size={12} />
          {match.label}
        </span>
      </div>

      <p className="mb-3 text-body-sm text-on-surface-variant">{truncate(hit.summary, 200)}</p>

      <div className="flex flex-wrap items-center gap-2">
        {hit.environmentExplanation && (
          <span
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-env-tag ${
              hit.environmentVerdict === "matches"
                ? "border-status-ci-verified/50 text-status-ci-verified"
                : hit.environmentVerdict === "mismatch"
                  ? "border-warning-amber/50 text-warning-amber"
                  : "border-outline-variant text-on-surface-variant"
            }`}
          >
            <Icon
              name={
                hit.environmentVerdict === "matches"
                  ? "check_circle"
                  : hit.environmentVerdict === "mismatch"
                    ? "warning"
                    : "help"
              }
              size={12}
            />
            {hit.environmentExplanation}
          </span>
        )}

        {hit.technologies.slice(0, 4).map((technology) => (
          <Tag key={technology.slug} tone={toneFor(technology.type)}>
            {technology.name}
          </Tag>
        ))}

        {/*
          Counts, never a percentage.

          R-4: below five reports a rate is arithmetic dressed as knowledge. On a
          triage card the honest form is also the shorter one.
        */}
        <span className="ml-auto flex items-center gap-3 font-mono text-env-tag text-on-surface-variant">
          <span className="flex items-center gap-1">
            <Icon name="fingerprint" size={12} />
            {totalReports === 0
              ? "no reproductions"
              : `${hit.reproducedPassed}/${totalReports} reproduced`}
          </span>
          {hit.reproducedFailed > 0 && (
            <span className="flex items-center gap-1 text-destructive-red">
              <Icon name="error" size={12} />
              {hit.reproducedFailed} failed
            </span>
          )}
          <span className="flex items-center gap-1">
            <Icon name="shield" size={12} />
            {BAND_LABEL[hit.band] ?? hit.band}
          </span>
        </span>
      </div>
    </Card>
  );
}

function NoResults({
  advice,
  query,
}: {
  advice: NonNullable<Awaited<ReturnType<typeof loader>>["advice"]>;
  query: string;
}) {
  return (
    <Card as="section" className="text-center">
      <Icon name="search" size={28} className="mx-auto mb-3 text-on-surface-variant" />
      <h2 className="mb-2 font-headline text-headline-md text-on-surface">{advice.headline}</h2>

      {advice.suggestions.length > 0 && (
        <ul className="mx-auto mb-4 flex max-w-xl list-none flex-col gap-1 text-body-sm text-on-surface-variant">
          {advice.suggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      )}

      {advice.offerContribution && (
        <>
          <p className="mx-auto mb-4 max-w-xl text-body-sm text-on-surface-variant">
            You have the problem in front of you right now, which is the only moment anybody ever
            has the details. That is worth more than a polished write-up later.
          </p>
          <Link
            to={`/contribute?q=${encodeURIComponent(query.slice(0, 500))}`}
            className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 font-mono text-label-caps uppercase text-on-primary"
          >
            <Icon name="add" size={14} />
            Start a playbook from this
          </Link>
        </>
      )}
    </Card>
  );
}

function toneFor(type: string): "neutral" | "os" | "runtime" | "framework" {
  if (type === "os") return "os";
  if (type === "runtime" || type === "language") return "runtime";
  if (type === "framework" || type === "library") return "framework";
  return "neutral";
}

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

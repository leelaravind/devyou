import { Omnibox, Card, Tag, Icon, Page } from "@devyou/ui";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "DEV.ITISYOU — diagnose engineering problems with evidence, not guesses" },
    {
      name: "description",
      content:
        "Paste an error or stack trace and follow a version-aware diagnostic playbook to the root cause. Every fix carries the evidence that it worked, bound to the exact revision that was tested.",
    },
    { property: "og:title", content: "DEV.ITISYOU" },
    {
      property: "og:description",
      content: "Structured, evidence-backed engineering troubleshooting playbooks.",
    },
    { property: "og:type", content: "website" },
  ];
}

/**
 * The landing page.
 *
 * It is a search intake surface, not a feed. R-41 names the three archetypes this
 * page must not resemble — a social feed, a generic AI chatbot, and a static
 * documentation wiki — and the omnibox above the fold with no stream beneath it is
 * how that is avoided structurally rather than by restraint.
 */
export default function Home() {
  return (
    <Page className="gap-24">
      <section className="mx-auto flex w-full max-w-4xl flex-col items-center text-center">
        <h1 className="mb-4 font-headline text-headline-lg text-on-surface">Don't guess. Test.</h1>
        <p className="mb-8 max-w-2xl text-body-md text-on-surface-variant">
          Paste your error, stack trace, logs, or describe the problem. Follow a diagnostic path
          that was tested on a stated version — and see who reproduced it, where, and when it last
          worked.
        </p>
        <Omnibox autoFocus />
      </section>

      <section aria-labelledby="how" className="w-full">
        <h2 id="how" className="sr-only">
          How it works
        </h2>
        <ol className="grid list-none gap-margin border-t border-outline-variant pt-12 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex flex-col items-center text-center">
              <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-outline-variant bg-surface-container text-evidence-blue">
                <Icon name={step.icon} />
              </span>
              <h3 className="mb-2 font-headline text-body-md font-semibold text-on-surface">
                {index + 1}. {step.title}
              </h3>
              <p className="max-w-xs text-body-sm text-on-surface-variant">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="difference" className="w-full">
        <h2
          id="difference"
          className="mb-8 text-center font-headline text-headline-md text-on-surface"
        >
          What makes an answer here different
        </h2>

        <div className="grid gap-gutter md:grid-cols-3">
          {DIFFERENCES.map((item) => (
            <Card key={item.title} as="article">
              <h3 className="mb-2 flex items-center gap-2 font-headline text-body-md font-semibold text-on-surface">
                <Icon name={item.icon} size={16} className="text-evidence-blue" />
                {item.title}
              </h3>
              <p className="text-body-sm text-on-surface-variant">{item.body}</p>
            </Card>
          ))}
        </div>

        {/*
          Stated plainly rather than as a badge.

          The adoption research is blunt that developers distrust trust badges and
          have learned to discount them. Saying what the platform will not do is a
          stronger signal than a shield icon, and it is checkable.
        */}
        <Card className="mt-margin" as="section">
          <h3 className="mb-3 font-mono text-label-caps uppercase text-on-surface-variant">
            What this site will not do
          </h3>
          <ul className="grid list-none gap-2 text-body-sm text-on-surface-variant md:grid-cols-2">
            {LIMITS.map((limit) => (
              <li key={limit} className="flex items-start gap-2">
                <Icon name="close" size={14} className="mt-0.5 shrink-0 text-destructive-red" />
                {limit}
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section aria-labelledby="domains" className="w-full">
        <h2 id="domains" className="mb-2 font-headline text-headline-md text-on-surface">
          Where the coverage is deep
        </h2>
        <p className="mb-gutter text-body-sm text-on-surface-variant">
          Narrow and deep beats broad and thin. These are the areas with real playbooks today.
        </p>
        <div className="flex flex-wrap gap-2">
          {SEED_DOMAINS.map((domain) => (
            <Tag key={domain.label} tone={domain.tone}>
              {domain.label}
            </Tag>
          ))}
        </div>
      </section>
    </Page>
  );
}

const STEPS = [
  {
    icon: "search" as const,
    title: "Find",
    body: "Paste the error exactly as you got it. Exact error codes and stack frames are matched first, then your versions narrow it.",
  },
  {
    icon: "science" as const,
    title: "Test",
    body: "One diagnostic test at a time. Report what you actually observed — including “I can’t tell” — and the path branches accordingly.",
  },
  {
    icon: "shield" as const,
    title: "Evidence",
    body: "Every fix shows who reproduced it, on which versions, and when it last worked. Failed attempts are shown too.",
  },
];

const DIFFERENCES = [
  {
    icon: "fingerprint" as const,
    title: "Evidence, not a badge",
    body: "There is no “verified” tick. Confidence is derived from reproduction records and always shows the counts behind it.",
  },
  {
    icon: "history" as const,
    title: "Evidence sticks to the revision",
    body: "Editing a playbook creates a new revision. Old evidence stays with the text it actually tested — it never silently transfers.",
  },
  {
    icon: "error" as const,
    title: "Failures are kept",
    body: "A fix that failed on Node 22 is recorded as exactly that, not buried as a downvote. Disagreement is segmented by environment.",
  },
];

const LIMITS = [
  "Run any code for you, or from you.",
  "Let AI decide that a fix works.",
  "Show a success percentage from three reports.",
  "Ask you to sign in to read or search.",
  "Rank by popularity or reputation points.",
  "Hide a fix that stopped working.",
];

const SEED_DOMAINS = [
  { label: "Cloudflare Workers", tone: "framework" as const },
  { label: "Cloudflare D1", tone: "framework" as const },
  { label: "PostgreSQL", tone: "runtime" as const },
  { label: "Docker", tone: "os" as const },
  { label: "Kubernetes", tone: "os" as const },
  { label: "Node.js", tone: "runtime" as const },
];

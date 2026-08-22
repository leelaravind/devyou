import { Link } from "react-router";
import { Card, Icon } from "@devyou/ui";

/**
 * About.
 *
 * Short on purpose. An about page that explains a product's philosophy at length is
 * usually compensating for a product that does not demonstrate it, and everything
 * worth claiming here is checkable elsewhere on the site — so this page mostly points
 * at where to check.
 *
 * The rule for anything written here: no promise that the code does not already keep.
 */

export function meta() {
  return [
    { title: "About — DEV.ITISYOU" },
    {
      name: "description",
      content:
        "DEV.ITISYOU is a troubleshooting knowledge base where every fix carries the evidence behind it, " +
        "tied to the exact revision that was tested.",
    },
  ];
}

export default function About() {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-[720px] flex-col gap-margin px-margin py-12"
    >
      <header className="flex flex-col gap-3">
        <h1 className="font-headline text-headline-lg text-on-surface">About</h1>
        <p className="text-body-md text-on-surface-variant">
          A troubleshooting knowledge base where a fix comes with the evidence behind it, and where
          that evidence belongs to the exact version of the fix that was tested.
        </p>
      </header>

      <section aria-labelledby="problem">
        <h2 id="problem" className="mb-2 font-headline text-headline-md text-on-surface">
          The problem this exists for
        </h2>
        <p className="mb-3 text-body-md text-on-surface-variant">
          Search an error message and you get answers that were true four years ago, on a version
          you are not running, with a top comment saying it stopped working. There is usually no way
          to tell which of five suggestions applies to you, and no way to find out what happened
          when other people tried.
        </p>
        <p className="text-body-md text-on-surface-variant">
          The information mostly exists. What is missing is any record of whether it worked, for
          whom, on what.
        </p>
      </section>

      <section aria-labelledby="different">
        <h2 id="different" className="mb-2 font-headline text-headline-md text-on-surface">
          What is different here
        </h2>
        <ul className="flex list-none flex-col gap-3">
          {POINTS.map((point) => (
            <li key={point.title}>
              <Card as="article">
                <h3 className="mb-1 font-headline text-body-md font-semibold text-on-surface">
                  {point.title}
                </h3>
                <p className="text-body-sm text-on-surface-variant">{point.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="not">
        <h2 id="not" className="mb-2 font-headline text-headline-md text-on-surface">
          What this is not
        </h2>
        <ul className="flex list-none flex-col gap-2 text-body-md text-on-surface-variant">
          {[
            "A Q&A site. Nobody asks a question here and waits. The unit is a diagnostic procedure, not a thread.",
            "A feed. There is nothing to scroll and no reason to come back except a problem.",
            "A reputation game. There are no points, no badges, no ranks and no leaderboard, and that absence is deliberate.",
            "A chatbot. Nothing here generates an answer for you; the AI structures what people submit and never decides what is true.",
            "A code runner. Every command on this site is text you read and choose to run yourself, in your own shell.",
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Icon name="close" size={14} className="mt-1 shrink-0 text-on-surface-variant" />
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="network">
        <h2 id="network" className="mb-2 font-headline text-headline-md text-on-surface">
          Part of the ITISYOU network
        </h2>
        <p className="text-body-md text-on-surface-variant">
          DEV.ITISYOU is one of several independent products under{" "}
          <a href="https://itisyou.app" className="text-evidence-blue underline">
            itisyou.app
          </a>
          . They share conventions and infrastructure conventions, not data: this product has its
          own database, its own accounts and its own storage, and nothing here is joined to anything
          there.
        </p>
      </section>

      <p className="text-body-md text-on-surface-variant">
        The mechanics are set out in full on{" "}
        <Link to="/how-verification-works" className="text-evidence-blue underline">
          how verification works
        </Link>
        .
      </p>
    </main>
  );
}

const POINTS = [
  {
    title: "Evidence, not a badge",
    body:
      "There is no “verified” flag in this system and nobody can set one. Confidence is derived from what people reported after trying the procedure — including what failed — by a published rule.",
  },
  {
    title: "Evidence belongs to a version",
    body:
      "Editing a playbook creates a new revision that starts with no evidence. Nobody can build up credibility on one procedure and then swap in another, because the database cannot express it.",
  },
  {
    title: "Failures are kept",
    body:
      "A report that the fix did not work is stored, shown next to the successes, and counted. It cannot be edited or deleted afterwards by anybody, including us.",
  },
  {
    title: "Your environment is part of the answer",
    body:
      "Reports are recorded against the setup they ran on and shown segmented by it. When two environments disagree, that disagreement is the finding rather than something to average away.",
  },
  {
    title: "Reading needs no account",
    body:
      "Search, read and run a diagnosis without signing in — and report a result without signing in too. Signing in changes what a report counts toward, never whether you can file it.",
  },
] as const;

import { Link } from "react-router";
import { Card, ConfidenceBandChip, Icon } from "@devyou/ui";
import { MIN_SAMPLE_FOR_PERCENTAGE, type ConfidenceBand } from "@devyou/core";
import { THRESHOLDS } from "@devyou/domain";

/**
 * How verification works.
 *
 * The page every confidence badge on the site links to, and the one that has to be
 * right for the rest of the product to mean anything. Its job is to let a sceptical
 * reader check the claim rather than take it.
 *
 * Two rules govern what may go on this page:
 *
 * **The thresholds are imported, not typed out.** `THRESHOLDS` is the same object
 * `deriveConfidenceBand` uses. A page explaining the rules that drifts from the rules
 * is worse than no page — it converts a reader who was willing to verify into one who
 * has been told something false. If a number here needs changing, it changes in the
 * domain package and both move together.
 *
 * **Nothing here may be aspirational.** No "we plan to", no "coming soon". A reader
 * arrives here suspicious of a claim; a roadmap in the middle of an explanation reads
 * as an admission that the claim is not yet true.
 */

export function meta() {
  return [
    { title: "How verification works — DEV.ITISYOU" },
    {
      name: "description",
      content:
        "Confidence on DEV.ITISYOU is derived from evidence tied to a specific revision — reproductions, " +
        "failures, references — never from a badge somebody set. Here are the exact rules.",
    },
  ];
}

export default function HowVerificationWorks() {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-[760px] flex-col gap-margin px-margin py-12"
    >
      <header className="flex flex-col gap-3">
        <h1 className="font-headline text-headline-lg text-on-surface">How verification works</h1>
        <p className="text-body-md text-on-surface-variant">
          Every playbook on this site carries a confidence band. This page says exactly how that
          band is arrived at, so you can disagree with it.
        </p>
      </header>

      <Card>
        <h2 className="mb-2 font-headline text-body-md font-semibold text-on-surface">
          The short version
        </h2>
        <p className="text-body-sm text-on-surface-variant">
          There is no &ldquo;verified&rdquo; flag anywhere in this system. Nobody can set one,
          including us. A confidence band is <em>derived</em> from the evidence recorded against one
          exact, immutable revision, by a rule that is written down below and applied the same way
          every time.
        </p>
      </Card>

      <section aria-labelledby="revisions">
        <h2 id="revisions" className="mb-2 font-headline text-headline-md text-on-surface">
          Evidence belongs to a revision, not to a playbook
        </h2>
        <p className="mb-3 text-body-md text-on-surface-variant">
          When somebody publishes an edit, it does not overwrite what was there. It creates a new
          revision, and the new revision starts with <strong>no evidence at all</strong>.
        </p>
        <p className="mb-3 text-body-md text-on-surface-variant">
          This is the single most important rule here, and it is the one most sites get wrong. If
          evidence followed the page instead of the version, anybody could accumulate reproductions
          on a correct procedure and then edit it into something else while keeping the badge. Here
          that is not a policy that could be relaxed — the database physically cannot express it.
          An evidence record points at a revision id and has no column for a playbook.
        </p>
        <p className="text-body-md text-on-surface-variant">
          Published revisions never change afterwards, for the same reason. You can read any
          previous revision, and the evidence you see on it is the evidence that revision actually
          earned.
        </p>
      </section>

      <section aria-labelledby="evidence-kinds">
        <h2 id="evidence-kinds" className="mb-2 font-headline text-headline-md text-on-surface">
          The kinds of evidence, and why they are not ranked
        </h2>
        <p className="mb-3 text-body-md text-on-surface-variant">
          These are different claims about different things. A CI run and three people reporting
          success in three real environments answer different questions, and averaging them into
          one score would lose the distinction that makes either useful.
        </p>
        <dl className="flex flex-col gap-3 text-body-sm">
          {EVIDENCE_EXPLANATIONS.map((entry) => (
            <div key={entry.term}>
              <dt className="font-mono text-env-tag uppercase text-on-surface">{entry.term}</dt>
              <dd className="text-on-surface-variant">{entry.definition}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="bands">
        <h2 id="bands" className="mb-2 font-headline text-headline-md text-on-surface">
          How the band is derived
        </h2>
        <p className="mb-4 text-body-md text-on-surface-variant">
          It is a decision procedure, not a weighted score — the conditions are checked in order
          and the first one that matches wins. A weighted score would let a large amount of weak
          evidence add up to a strong claim, which is precisely the failure this design exists to
          avoid.
        </p>

        <ol className="flex list-none flex-col gap-3">
          <li>
            <BandRow band="deprecated">
              Set by a maintainer because the procedure no longer applies. Lifecycle overrides
              evidence entirely: a deprecated playbook with fifty successful reproductions is still
              deprecated, because those reproductions happened before whatever changed.
            </BandRow>
          </li>
          <li>
            <BandRow band="needs_reverification">
              At least {THRESHOLDS.FAILURE_RATIO_MIN_SAMPLE} reports, of which at least a third
              failed. Recent failures pull a revision back regardless of how many successes it has
              — a fix that fails for one reader in three is not strong evidence of anything except
              that its environment constraints are wrong.
            </BandRow>
          </li>
          <li>
            <BandRow band="strong_evidence">
              At least {THRESHOLDS.STRONG_PASSES} independent successes across at least{" "}
              {THRESHOLDS.STRONG_UNIQUE_ENVIRONMENTS} distinct environments.
            </BandRow>
          </li>
          <li>
            <BandRow band="moderate_evidence">
              At least {THRESHOLDS.MODERATE_PASSES} independent successes across at least{" "}
              {THRESHOLDS.MODERATE_UNIQUE_ENVIRONMENTS} distinct environments.
            </BandRow>
          </li>
          <li>
            <BandRow band="limited_evidence">
              At least {THRESHOLDS.LIMITED_PASSES} independent success.
            </BandRow>
          </li>
          <li>
            <BandRow band="unverified">
              Written down, and nobody independent has reported trying it. Every new revision starts
              here, including revisions of playbooks that were previously well evidenced.
            </BandRow>
          </li>
        </ol>

        <Card className="mt-4">
          <p className="flex items-start gap-2 text-body-sm text-on-surface-variant">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" />
            <span>
              <strong className="text-on-surface">&ldquo;Independent&rdquo; excludes the author.</strong>{" "}
              An author reporting that their own playbook worked is not evidence that it works for
              anybody else, so it is recorded, shown, and not counted toward the band. The same
              applies to a report filed without signing in: it is shown to readers and weighted at
              zero, because there is nothing to distinguish one anonymous report from ten.
            </span>
          </p>
        </Card>
      </section>

      <section aria-labelledby="failures">
        <h2 id="failures" className="mb-2 font-headline text-headline-md text-on-surface">
          Failures are kept
        </h2>
        <p className="mb-3 text-body-md text-on-surface-variant">
          A report that says the fix did not work is stored, displayed alongside the successes, and
          counted. It cannot be edited or deleted afterwards — not by the reporter, not by the
          author, not by an administrator. The tables are append-only at the database level.
        </p>
        <p className="text-body-md text-on-surface-variant">
          This is what makes the successes worth anything. A system where an inconvenient result can
          quietly disappear produces numbers that mean nothing, and there is no way to tell such a
          system apart from an honest one by looking at it — which is why this one removes the
          ability rather than promising not to use it.
        </p>
      </section>

      <section aria-labelledby="percentages">
        <h2 id="percentages" className="mb-2 font-headline text-headline-md text-on-surface">
          Why you rarely see a percentage
        </h2>
        <p className="text-body-md text-on-surface-variant">
          Below {MIN_SAMPLE_FOR_PERCENTAGE} reports, this site shows the counts and refuses to
          render a percentage. &ldquo;100% success&rdquo; from two reports is a true statement that
          communicates something false, and the reader who acts on it has been misled by arithmetic
          rather than by a claim anybody made.
        </p>
      </section>

      <section aria-labelledby="environments">
        <h2 id="environments" className="mb-2 font-headline text-headline-md text-on-surface">
          Environment is part of the claim
        </h2>
        <p className="text-body-md text-on-surface-variant">
          Evidence gathered on one setup says nothing certain about another, so reports are recorded
          against an immutable snapshot of the environment they ran in and shown segmented by it
          rather than averaged. When two environments disagree, that disagreement is the finding —
          it is stated in words on the evidence page, not smoothed into &ldquo;mostly works&rdquo;.
          A combination nobody has tried is shown as untested, which is an invitation rather than a
          blank.
        </p>
      </section>

      <section aria-labelledby="ai">
        <h2 id="ai" className="mb-2 font-headline text-headline-md text-on-surface">
          What AI does here, and what it does not
        </h2>
        <p className="mb-3 text-body-md text-on-surface-variant">
          AI is used to help structure a submission into steps, to suggest which technologies a
          contribution is about, to spot likely duplicates, and to assist moderation. All of that is
          assistance to a person who then decides.
        </p>
        <p className="text-body-md text-on-surface-variant">
          <strong className="text-on-surface">
            No model can create, weight, or alter a piece of evidence, and none can set or influence
            a confidence band.
          </strong>{" "}
          That is not a guideline in a document — the tasks a model is permitted to perform are an
          allow-list in code, and the forbidden ones are named individually with the reason attached.
        </p>
      </section>

      <section aria-labelledby="disagree">
        <h2 id="disagree" className="mb-2 font-headline text-headline-md text-on-surface">
          If you think a band is wrong
        </h2>
        <p className="mb-3 text-body-md text-on-surface-variant">
          Every playbook has an evidence page listing every record the band was derived from,
          including the failures. If the band looks wrong, the fastest way to change it is to add
          the evidence it is missing: try the procedure and report what actually happened, whichever
          way it went.
        </p>
        <p className="text-body-md text-on-surface-variant">
          <Link to="/playbooks" className="text-evidence-blue underline">
            Browse the playbooks
          </Link>{" "}
          or{" "}
          <Link to="/" className="text-evidence-blue underline">
            start from an error
          </Link>
          .
        </p>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------------- */

function BandRow({ band, children }: { band: ConfidenceBand; children: React.ReactNode }) {
  return (
    <Card as="div" className="flex flex-col items-start gap-2">
      <ConfidenceBandChip band={band} />
      <p className="text-body-sm text-on-surface-variant">{children}</p>
    </Card>
  );
}

const EVIDENCE_EXPLANATIONS = [
  {
    term: "Contributor documentation",
    definition:
      "The author's own account of what worked for them. It is evidence that a procedure was written down, never evidence that it works — on its own it can only produce Unverified.",
  },
  {
    term: "Reproduction",
    definition:
      "Somebody independent followed the author's written steps and reported the outcome. This is the evidence the confidence bands are mostly built from.",
  },
  {
    term: "Independent confirmation",
    definition:
      "Somebody independent reached the same outcome, by their own route rather than by following the steps. Recorded separately from reproduction because merging the two would overstate what is known.",
  },
  {
    term: "Failure observation",
    definition:
      "A report that the procedure did not resolve the problem, from somebody who did not work through the whole playbook. Counted, and never filtered out.",
  },
  {
    term: "Official reference",
    definition:
      "A link to upstream documentation, an issue, or a changelog that supports the cause the playbook names. Supports the explanation; is not a report that the steps run.",
  },
  {
    term: "Maintainer attestation",
    definition:
      "A statement from somebody who has proved they maintain the project in question. One signal among several — it never outranks reproduction, because being the maintainer is not the same as having tried this on your machine.",
  },
  {
    term: "CI execution / matrix execution",
    definition:
      "An automated run, on one environment or across a matrix of them. Precise about what it tested and silent about everything else.",
  },
] as const;

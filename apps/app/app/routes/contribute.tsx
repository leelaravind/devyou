import { Link } from "react-router";
import { Card, Icon } from "@devyou/ui";
import type { Route } from "./+types/contribute";
import { cloudflareContext } from "../context/cloudflare";
import { loadAuthState } from "../lib/auth.server";

/**
 * Contribute.
 *
 * The entry point plan §7 asks for, and it deliberately does not open with a blank
 * "write a playbook" form. The adoption research is specific that the barrier to a
 * first contribution is not willingness — it is being asked for a large, well-formed
 * artefact by a site the person has contributed nothing to yet.
 *
 * So the page is ordered by cost, cheapest first, and the cheapest thing on it takes
 * about fifteen seconds and needs no account. Somebody who reports a result today is
 * far more likely to propose a fix next month than somebody who was shown an empty
 * editor and closed the tab.
 *
 * Everything listed here is a route that exists. This page must never advertise a
 * contribution path the product cannot currently accept — an entry point that leads
 * to a dead end costs more trust than the missing feature does.
 */

export function meta() {
  return [
    { title: "Contribute — DEV.ITISYOU" },
    {
      name: "description",
      content:
        "Report whether a fix worked, propose a missing diagnostic step, or correct a playbook. " +
        "The smallest useful contribution takes about fifteen seconds and needs no account.",
    },
    /*
      `robots.txt` disallows /contribute — it is a form surface, not knowledge. The
      meta tag says the same thing for a crawler that reached this page by a link
      rather than by crawling the root.
    */
    { name: "robots", content: "noindex, follow" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const auth = await loadAuthState(request, env);

  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM playbooks WHERE current_revision_id IS NOT NULL AND status != 'quarantined') AS playbooks,
       (SELECT COUNT(*) FROM technologies) AS technologies`,
  ).first<{ playbooks: number; technologies: number }>();

  return {
    signedIn: auth.principal !== null,
    signInAvailable: auth.signInAvailable,
    playbookCount: counts?.playbooks ?? 0,
    technologyCount: counts?.technologies ?? 0,
  };
}

export default function Contribute({ loaderData }: Route.ComponentProps) {
  const { signedIn, signInAvailable, playbookCount, technologyCount } = loaderData;

  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-[760px] flex-col gap-margin px-margin py-12"
    >
      <header className="flex flex-col gap-3">
        <h1 className="font-headline text-headline-lg text-on-surface">Contribute</h1>
        <p className="text-body-md text-on-surface-variant">
          The corpus is {playbookCount} playbooks across {technologyCount} technologies. It is small
          and it is meant to be — every one of them carries the evidence behind it, and that is the
          part that takes people.
        </p>
      </header>

      <section aria-labelledby="smallest">
        <h2 id="smallest" className="mb-1 font-headline text-headline-md text-on-surface">
          Start with the smallest thing
        </h2>
        <p className="mb-gutter text-body-sm text-on-surface-variant">
          Ordered by how long it takes. The first one is genuinely the most valuable per second
          spent.
        </p>

        <ol className="flex list-none flex-col gap-3">
          <li>
            <Card as="article">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h3 className="font-headline text-body-md font-semibold text-on-surface">
                  Report whether a fix worked
                </h3>
                <span className="font-mono text-env-tag uppercase text-status-ci-verified">
                  ~15 seconds · no account needed
                </span>
              </div>
              <p className="text-body-sm text-on-surface-variant">
                Worked, partially worked, or failed — on any playbook you have tried. This is the
                evidence every confidence band on the site is built from, and a failure is worth
                exactly as much as a success. There is no form to fill in beyond the outcome and
                your environment, and notes are optional.
              </p>
              <p className="mt-2 text-body-sm text-on-surface-variant">
                <Link to="/playbooks" className="text-evidence-blue underline">
                  Find a playbook you have used
                </Link>
              </p>
            </Card>
          </li>

          <li>
            <Card as="article">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h3 className="font-headline text-body-md font-semibold text-on-surface">
                  Say what a playbook is missing
                </h3>
                <span className="font-mono text-env-tag uppercase text-on-surface-variant">
                  ~2 minutes
                </span>
              </div>
              <p className="text-body-sm text-on-surface-variant">
                A diagnostic step that should have been checked, an outcome with no branch to
                follow, something stated that is simply wrong, or a setup the applicability does not
                cover. Every playbook page has a &ldquo;propose a change&rdquo; link that goes
                straight to this.
              </p>
              <p className="mt-2 text-body-sm text-on-surface-variant">
                There is no comment section anywhere on this site, and that is on purpose: a
                playbook that is wrong should be fixed, not argued with underneath.
              </p>
            </Card>
          </li>

          <li>
            <Card as="article">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h3 className="font-headline text-body-md font-semibold text-on-surface">
                  Declare your environment
                </h3>
                <span className="font-mono text-env-tag uppercase text-on-surface-variant">
                  ~30 seconds · stays in your browser
                </span>
              </div>
              <p className="text-body-sm text-on-surface-variant">
                Search results get filtered against it, and any report you file is pre-filled from
                it instead of retyped. It is stored in a cookie, not in an account.
              </p>
              <p className="mt-2 text-body-sm text-on-surface-variant">
                <Link to="/environment" className="text-evidence-blue underline">
                  Set your environment
                </Link>
              </p>
            </Card>
          </li>
        </ol>
      </section>

      <section aria-labelledby="what-makes-good">
        <h2 id="what-makes-good" className="mb-2 font-headline text-headline-md text-on-surface">
          What makes a good playbook here
        </h2>
        <p className="mb-3 text-body-md text-on-surface-variant">
          The unit is a <strong>diagnostic procedure</strong>, not an answer. A good one takes
          somebody who has an error and does not know why, and walks them through checks that
          distinguish between the causes — so a reader ends up knowing which of four things is
          actually wrong, rather than trying four fixes in sequence.
        </p>
        <ul className="flex list-none flex-col gap-2 text-body-sm text-on-surface-variant">
          {[
            "Start from what the reader can observe — an error message, a log line, a symptom — not from the cause they do not know yet.",
            "Every test should have an outcome for “I can't tell”. A reader who cannot run your check is the reader most likely to give up.",
            "Say what the fix does, not only what to type. A command somebody runs without understanding is how the next incident starts.",
            "State what you actually tested it on. “Works on Linux” with no version is not applicability, it is a guess.",
            "Include the failure modes you hit. The path that did not work is often the most useful thing you know.",
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Icon name="chevron_right" size={13} className="mt-1 shrink-0" />
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="rules">
        <h2 id="rules" className="mb-2 font-headline text-headline-md text-on-surface">
          Things worth knowing before you contribute
        </h2>
        <ul className="flex list-none flex-col gap-2 text-body-sm text-on-surface-variant">
          <li className="flex items-start gap-2">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" />
            <span>
              <strong className="text-on-surface">Your contribution is public.</strong> Everything
              here is readable without an account, including by crawlers. Do not paste anything from
              a private log that you have not read through — submissions are scanned for
              credential-shaped strings and hidden characters, but a scanner is not a substitute for
              looking.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" />
            <span>
              <strong className="text-on-surface">An edit does not overwrite anything.</strong>{" "}
              Publishing a change creates a new revision; the old one stays readable with the
              evidence it earned. The new one starts with none.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" />
            <span>
              <strong className="text-on-surface">A report you file cannot be withdrawn.</strong>{" "}
              Reproduction reports are append-only, including failures and including your own. If
              the result changes later, that is new evidence rather than a correction to the old.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" />
            <span>
              <strong className="text-on-surface">A declined proposal keeps its reason.</strong> It
              stays visible to you with an explanation attached. Contributions do not disappear
              silently here.
            </span>
          </li>
        </ul>
      </section>

      {!signedIn && signInAvailable && (
        <Card>
          <p className="flex items-start gap-2 text-body-sm text-on-surface-variant">
            <Icon name="account_circle" size={15} className="mt-0.5 shrink-0" />
            <span>
              You can do all of the above without an account. Signing in makes your reproduction
              reports count toward confidence rather than only being shown, and keeps your
              contributions attributed to you.{" "}
              <Link to="/sign-in" className="text-evidence-blue underline">
                Sign in
              </Link>
              .
            </span>
          </p>
        </Card>
      )}

      <p className="text-body-md text-on-surface-variant">
        If you want to understand how evidence turns into a confidence band before contributing any,{" "}
        <Link to="/how-verification-works" className="text-evidence-blue underline">
          the rules are written down
        </Link>
        .
      </p>
    </main>
  );
}

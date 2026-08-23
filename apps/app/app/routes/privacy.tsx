import { Link } from "react-router";
import { LegalDoc, LegalSection, LegalList, P } from "../lib/legal";

/**
 * The privacy notice.
 *
 * Written from the implementation, not from a template: every claim on this page
 * corresponds to something the code does or deliberately does not do, and several of
 * them are asserted by tests. The rule from ADR-0013 applies — if the implementation
 * changes, this document is part of the change.
 */

export function meta() {
  return [
    { title: "Privacy notice — DEV.ITISYOU" },
    {
      name: "description",
      content:
        "How dev.itisyou.app handles information about the people who read it and contribute to it. " +
        "No analytics, no advertising, no tracking; three first-party cookies; nothing sold.",
    },
  ];
}

export default function Privacy() {
  return (
    <LegalDoc
      title="Privacy notice"
      lede="How this site handles information about the people who read it and contribute to it — written from what the implementation actually does."
      path="/privacy"
    >
      <LegalSection id="who" title="Who is responsible">
        <P>
          DEV.ITISYOU (<span className="font-mono">dev.itisyou.app</span>) is operated by
          itisyou.app, whose postal address is at the end of this page. itisyou.app is the data
          controller for the processing this notice describes, and the UK data-protection fee for
          this service is paid under the name itisyou.app.
        </P>
        <P>
          This notice covers <span className="font-mono">dev.itisyou.app</span> only. Other
          products under itisyou.app share conventions, not data: this product has its own
          database, its own accounts and its own storage, and nothing here is joined to anything
          there.
        </P>
      </LegalSection>

      <LegalSection id="short-version" title="The short version">
        <LegalList
          items={[
            "There are no analytics scripts, no advertising, no tracking pixels and no third-party embeds on any page. The fonts are self-hosted so that page views are not reported to a font network.",
            "Reading and searching need no account, ever, and store nothing about you beyond short-lived operational logs.",
            "Signing in uses GitHub and asks for no permissions beyond your public profile. Your email address is not requested, not received and not stored.",
            "There are exactly three cookies, all first-party, listed below. None is used for tracking, and none requires a consent banner because none is optional decoration — each one is either essential or is itself the thing you asked for.",
            "Text you submit for structuring is sent to one AI provider, Anthropic, only when you submit it, and its output cannot be published without your confirmation.",
            "Published contributions are public and permanent by design. That is the product, and it is stated before you publish, not after.",
          ]}
        />
      </LegalSection>

      <LegalSection id="reading" title="Reading and searching">
        <P>
          No account is needed and no profile of you is built. Requests pass through Cloudflare,
          whose infrastructure this site runs on, and appear in short-lived operational logs
          (IP address, requested URL, user agent) used for running and securing the service.
        </P>
        <P>
          Search quality telemetry deliberately stores no query text and no identifier: what is
          recorded is a one-way fingerprint of the error signature, the shape and token count of
          the query, how many results came back and how fast. It cannot be joined back to a
          person.
        </P>
        <P>
          If you declare your environment (operating system, tools, versions), that declaration
          lives in a cookie in your browser — not in an account, even if you have one. It
          contains your stated versions and nothing else: no identifier, nothing that could
          correlate one reader with another.
        </P>
      </LegalSection>

      <LegalSection id="signing-in" title="Signing in with GitHub">
        <P>
          GitHub is the only sign-in method. The authorisation request asks for no scopes at
          all, which means GitHub shows you a consent screen for your public profile and nothing
          more. From that profile we store your GitHub login, a display name, a handle derived
          from the login, and your avatar URL. The access token is used once, to read that
          profile, and is never stored.
        </P>
        <P>
          What is deliberately not read and not stored: your email address, your repositories,
          your stars, your followers, your organisations and your account age. A GitHub account
          proves you control that account; it buys no standing here.
        </P>
        <P>
          GitHub is a separate controller for what happens on its side of the sign-in; its own
          privacy statement is at{" "}
          <a
            href="https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement"
            className="text-evidence-blue underline"
          >
            docs.github.com
          </a>
          .
        </P>
      </LegalSection>

      <LegalSection id="sessions" title="Sessions and security records">
        <P>
          Signing in sets a session cookie holding a random token. The database stores only a
          cryptographic hash of that token — a copy of the database is not a set of usable
          sessions — together with when the session was created and when it expires (30 days),
          a coarse description of the browser (for example &ldquo;Firefox on Linux&rdquo;, never
          the full user-agent string) and a truncated one-way hash derived from the IP address.
          The IP address itself is not stored with the session.
        </P>
        <P>
          These records exist so that sessions can be revoked — signing out, or an account being
          suspended, invalidates them server-side — and so that abuse can be investigated.
        </P>
      </LegalSection>

      <LegalSection id="contributing" title="Contributing">
        <P>
          A draft is private to its author: to anyone else, including other signed-in users, a
          draft URL is indistinguishable from a page that does not exist. What you paste is
          scanned for credential-shaped strings and hidden characters before it is stored, and
          rejected rather than cleaned if either is found.
        </P>
        <P>
          When you submit a draft for structuring, its text is sent to Anthropic — see{" "}
          <Link to="/ai" className="text-evidence-blue underline">
            how AI is used
          </Link>
          . Publishing makes the contribution public, permanent and attributed to your handle;
          the{" "}
          <Link to="/contribution-terms" className="text-evidence-blue underline">
            contribution terms
          </Link>{" "}
          set out what that means before you do it.
        </P>
        <P>
          Reproduction reports can be filed without an account. A signed-in report is attributed
          to you and counts toward a confidence figure; an anonymous report is shown but not
          counted, and a truncated one-way hash of the reporting IP address is stored to limit
          anonymous reports to one per playbook revision. Change proposals are stored without an
          account attribution even when you are signed in, and safety reports are anonymous.
        </P>
      </LegalSection>

      <LegalSection id="ai" title="AI processing">
        <P>
          The only AI processing on this site is assistive structuring of contributions, done by
          Anthropic when a contributor submits text, described in full on{" "}
          <Link to="/ai" className="text-evidence-blue underline">
            how AI is used
          </Link>
          . Reading, searching and diagnosing send nothing to any AI provider. The request
          metadata sent to Anthropic labels the kind of task, not the person. A ledger records
          each AI task — which account requested it, token counts, cost and latency — as an
          operational and audit record.
        </P>
        <P>
          No decision producing legal or similarly significant effects is made automatically.
          Publication requires the contributor; moderation outcomes and account suspensions
          require a human administrator, and every privileged action is written to an
          append-only audit log with a stated reason.
        </P>
      </LegalSection>

      <LegalSection id="cookies" title="Cookies — the complete list">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-body-sm text-on-surface-variant">
            <thead>
              <tr className="border-b border-outline-variant font-mono text-env-tag uppercase">
                <th scope="col" className="py-2 pr-4">
                  Cookie
                </th>
                <th scope="col" className="py-2 pr-4">
                  What it is for
                </th>
                <th scope="col" className="py-2">
                  Lifetime
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-outline-variant">
                <td className="py-2 pr-4 font-mono text-code-block text-on-surface">dv_session</td>
                <td className="py-2 pr-4">
                  Keeps you signed in. Set only when you sign in; holds an opaque random token.
                </td>
                <td className="py-2">30 days</td>
              </tr>
              <tr className="border-b border-outline-variant">
                <td className="py-2 pr-4 font-mono text-code-block text-on-surface">
                  dv_oauth_state
                </td>
                <td className="py-2 pr-4">
                  Protects the sign-in round trip to GitHub against forgery. Set when you start
                  signing in; cleared when the round trip ends, however it ends.
                </td>
                <td className="py-2">10 minutes</td>
              </tr>
              <tr className="border-b border-outline-variant">
                <td className="py-2 pr-4 font-mono text-code-block text-on-surface">dv_env</td>
                <td className="py-2 pr-4">
                  Your declared environment, if you declared one. A preference, in the same
                  category as a theme choice; contains no identifier.
                </td>
                <td className="py-2">1 year</td>
              </tr>
            </tbody>
          </table>
        </div>
        <P>
          That is the complete list. There are no third-party cookies, no analytics cookies and
          no advertising cookies, and the site uses no local storage. Because each cookie is
          either strictly necessary for something you asked for or is itself the preference you
          set, there is no consent banner — there is nothing optional to consent to. You can
          clear any of them in your browser at any time; clearing{" "}
          <span className="font-mono">dv_session</span> signs you out.
        </P>
      </LegalSection>

      <LegalSection id="recipients" title="Infrastructure, and who else touches data">
        <LegalList
          items={[
            <>
              <strong className="text-on-surface">Cloudflare</strong> — the site runs on
              Cloudflare Workers, with its database, storage and queues on Cloudflare
              infrastructure. Evidence file storage is pinned to Cloudflare&rsquo;s EU
              jurisdiction. Cloudflare also produces the operational logs described above.
            </>,
            <>
              <strong className="text-on-surface">Anthropic</strong> — receives contribution
              text for structuring, only when a contributor submits it.
            </>,
            <>
              <strong className="text-on-surface">GitHub</strong> — handles sign-in, as its own
              controller.
            </>,
          ]}
        />
        <P>
          There are no advertising partners, no analytics providers and no data brokers, and
          nothing is sold or shared for marketing.
        </P>
      </LegalSection>

      <LegalSection id="transfers" title="Where data goes">
        <P>
          Cloudflare operates a global network, and Anthropic is a US provider, so some
          processing happens outside the UK. Those transfers take place under each
          provider&rsquo;s data-processing terms, which incorporate safeguards recognised under
          UK data-protection law for international transfers.
        </P>
      </LegalSection>

      <LegalSection id="lawful-bases" title="Lawful bases">
        <P>
          Operating, securing and moderating a public knowledge service — the logs, session
          security records, rate limits, moderation and audit records above — rests on
          legitimate interests. Providing the features you ask for — an account, drafts,
          structuring, publication — rests on performing our terms with you. Where the law
          compels disclosure or retention, that is a legal obligation. Nothing here rests on
          consent, because nothing optional — marketing, analytics, tracking — exists to consent
          to.
        </P>
      </LegalSection>

      <LegalSection id="retention" title="How long things are kept">
        <LegalList
          items={[
            "Account and profile records: for as long as you have an account, and until a deletion request is actioned.",
            "Sessions: expire 30 days after sign-in, or immediately on sign-out, suspension or revocation.",
            "Drafts: kept for their author, including abandoned ones — they are listed to you rather than silently removed, and remain private.",
            "Published revisions, evidence records and reproduction reports: permanent by design. A published revision is immutable; a correction is a new revision, and the old one stays readable with the evidence it earned. Content removed for legal or abuse reasons leaves a visible tombstone rather than a silent gap.",
            "Moderation cases and the administrative audit log: append-only records, retained.",
            "AI task ledger entries: retained as operational and cost records.",
            "Operational logs: short-lived, per the infrastructure platform's defaults.",
          ]}
        />
      </LegalSection>

      <LegalSection id="rights" title="Your rights">
        <P>
          UK data-protection law gives you rights over personal data we hold about you:
          access, rectification, erasure, restriction, objection and, where it applies,
          portability. To exercise any of them, write to the postal address below with enough
          detail to find your records — your handle or GitHub login is the useful identifier,
          since we hold no email address. There is currently no self-service export or deletion;
          requests are handled manually.
        </P>
        <P>
          On erasure, one honest caveat: an account can be closed and its records anonymised,
          but published material and evidence records are part of a public, append-only record —
          where the law requires it, attribution is removed rather than the record destroyed.
          Each request is assessed on its own facts.
        </P>
        <P>
          You also have the right to complain to the Information Commissioner&rsquo;s Office
          (ico.org.uk).
        </P>
      </LegalSection>

      <LegalSection id="changes" title="Changes to this notice">
        <P>
          Changes are published on this page with a new effective date. This notice describes
          the implementation; when the implementation changes in a way that matters here, the
          notice changes with it.
        </P>
      </LegalSection>
    </LegalDoc>
  );
}

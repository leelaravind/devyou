import { Link } from "react-router";
import { LegalDoc, LegalSection, LegalList, P } from "../lib/legal";

/**
 * Acceptable use policy.
 *
 * Shaped by what this product actually is: a site whose content is instructions
 * people run on real systems, and whose value is an evidence model. The two things
 * this policy most exists to prohibit are content that harms the reader who trusts
 * it, and anything that games the evidence.
 */

export function meta() {
  return [
    { title: "Acceptable use policy — DEV.ITISYOU" },
    {
      name: "description",
      content:
        "What may not be done on dev.itisyou.app: content that harms readers, gaming the " +
        "evidence model, and attacks on the service.",
    },
  ];
}

export default function AcceptableUse() {
  return (
    <LegalDoc
      title="Acceptable use policy"
      lede="This applies to everything submitted or done here, signed in or not — playbooks, reports, proposals, and use of the service itself."
      path="/acceptable-use"
    >
      <LegalSection id="harm" title="Content that harms the people who trust it">
        <LegalList
          items={[
            "No procedures designed to damage the systems of the person who runs them — destructive commands presented as fixes, malware, backdoors, or downloads that are not what they claim to be.",
            "No deliberately false troubleshooting content. Being wrong in good faith is what the evidence model exists to surface; being wrong on purpose is a violation.",
            "No instructions whose purpose is unauthorised access to systems or data that are not yours.",
          ]}
        />
      </LegalSection>

      <LegalSection id="unlawful" title="Unlawful content and other people's information">
        <LegalList
          items={[
            "Nothing unlawful under the law of England and Wales.",
            "No personal data about other people — names, addresses, internal logs identifying colleagues, customer records pasted from production.",
            "No credentials or secrets, yours or anyone else's. Submissions are scanned for credential-shaped strings and rejected, but the scanner is a backstop, not permission to rely on it.",
            "No content that infringes copyright — see the content and copyright policy.",
          ]}
        />
      </LegalSection>

      <LegalSection id="gaming" title="Gaming the evidence model">
        <P>
          The product&rsquo;s value is that its confidence figures mean something. Fabricated
          reproduction reports, reports for procedures you did not run, coordinated
          confirmation of your own contributions through multiple accounts, and any other
          manufacturing of evidence are violations — whether or not they succeed. Failed
          reproductions are welcome; fake ones, in either direction, are not.
        </P>
      </LegalSection>

      <LegalSection id="service" title="Attacks on the service">
        <LegalList
          items={[
            "No attempts to manipulate the structuring model through submissions — prompt injection is treated as hostile content, and submissions are processed on that assumption.",
            "No hidden Unicode or other content crafted to read differently to a human than to a machine. Submissions are scanned, shown back revealed, and rejected.",
            "No circumventing rate limits, moderation decisions or suspensions, including by creating accounts to do so.",
            "No access that degrades the service for others. Reading is open — including to crawlers, which are deliberately not blocked — but abusive request volume is not.",
          ]}
        />
      </LegalSection>

      <LegalSection id="enforcement" title="Enforcement">
        <P>
          Violations lead to content being suppressed, deprecated or removed with a visible
          tombstone, to accounts being suspended, and, where the law requires or permits it, to
          reports to the relevant authorities. Moderation here is done by people, recorded in
          an append-only audit log with a stated reason, and never delegated to an AI system —
          the same boundary described on{" "}
          <Link to="/ai" className="text-evidence-blue underline">
            how AI is used
          </Link>
          . To report content that violates this policy, use the safety report on the playbook
          page (no account needed) or write to the postal address below.
        </P>
      </LegalSection>
    </LegalDoc>
  );
}

import { Link } from "react-router";
import { LegalDoc, LegalSection, LegalList, P } from "../lib/legal";

/**
 * Contribution terms.
 *
 * The shape is fixed by ADR-0013: ownership stays with the contributor; itisyou.app
 * receives the permissions the product actually needs, and no more; the permanence of
 * published material is stated as the grant it is, because the immutable-revision and
 * append-only-evidence model cannot work under a revocable licence.
 */

export function meta() {
  return [
    { title: "Contribution terms — DEV.ITISYOU" },
    {
      name: "description",
      content:
        "What you grant and what you keep when you contribute to dev.itisyou.app: ownership stays " +
        "with you; published material is permanent by design.",
    },
  ];
}

export default function ContributionTerms() {
  return (
    <LegalDoc
      title="Contribution terms"
      lede="What you grant and what you keep when you submit anything here — a draft, a published playbook, a reproduction report, a change proposal. These terms are linked from every submission surface, before you submit."
      path="/contribution-terms"
    >
      <LegalSection id="scope" title="What these terms cover">
        <P>
          Everything you submit to DEV.ITISYOU: contribution drafts and the playbook revisions
          published from them, reproduction reports (signed-in or anonymous), change proposals
          and safety reports. Submitting any of these means agreeing to these terms.
        </P>
      </LegalSection>

      <LegalSection id="ownership" title="You keep ownership">
        <P>
          Copyright in what you write stays with you. There is no assignment and no contributor
          licence agreement transferring your rights. Nothing here stops you publishing your own
          material anywhere else.
        </P>
      </LegalSection>

      <LegalSection id="grant" title="What you grant us">
        <P>
          You grant itisyou.app a worldwide, non-exclusive, royalty-free licence to do the
          things the service actually needs to do with your submission: store it, reproduce it,
          reformat and structure it (including the AI-assisted structuring described on{" "}
          <Link to="/ai" className="text-evidence-blue underline">
            how AI is used
          </Link>
          ), moderate it, display it and distribute it as part of the service, including to the
          service providers that process it on our behalf.
        </P>
        <P>
          For material that is published, and for reports and evidence once filed, this licence
          is perpetual and irrevocable. That is not small print — it is the product&rsquo;s
          central mechanism. Published revisions are immutable, evidence is append-only, and a
          superseded revision stays readable with the evidence it earned; a licence you could
          withdraw would be a way to delete the evidence trail, which this system is built to
          prevent. Drafts are different: a draft is private to you, and an abandoned draft is
          simply kept for you, unpublished.
        </P>
        <P>
          No general licence to the public is currently granted over published content — see the{" "}
          <Link to="/content-policy" className="text-evidence-blue underline">
            content and copyright policy
          </Link>
          . If that changes, it will not apply retroactively to your contribution without your
          consent.
        </P>
      </LegalSection>

      <LegalSection id="representations" title="What you promise about your submission">
        <LegalList
          items={[
            "It is yours to submit: you wrote it, or you otherwise hold the rights needed to grant the licence above.",
            <>
              Any third-party material in it complies with the{" "}
              <Link to="/content-policy" className="text-evidence-blue underline">
                content and copyright policy
              </Link>{" "}
              — sources are cited as evidence, not copied as content, and any open-source code
              respects its licence and attribution requirements.
            </>,
            "It contains no confidential information, no credentials, and no personal data about other people.",
            "Reports describe what actually happened: you ran the procedure you say you ran, in the environment you declared, and the outcome you filed is the outcome you observed.",
            "It does not violate the acceptable use policy.",
          ]}
        />
      </LegalSection>

      <LegalSection id="ai-structuring" title="AI structuring, stated plainly">
        <P>
          When you submit a draft for structuring, its text is sent to Anthropic, our AI
          provider, which proposes a structured version for your review. The proposal is
          exactly that: every AI-derived field is recorded with its provenance, and nothing the
          model produced can be published until you have confirmed or rewritten it. AI-assisted
          structuring does not change who owns your material and does not launder anyone
          else&rsquo;s — third-party content passed through a model remains third-party
          content.
        </P>
      </LegalSection>

      <LegalSection id="publishing" title="What publishing means">
        <LegalList
          items={[
            "Your contribution becomes publicly readable and indexable immediately, without a login, including by crawlers and AI systems.",
            "It is attributed to your handle, and stays attributed across revisions.",
            "It is permanent. A published revision cannot be edited — a correction is a new revision, and the old one stays readable at its own URL with its own evidence. A reproduction report cannot be withdrawn; if the result changes later, that is new evidence.",
            "It starts with no evidence. Confidence comes from what other people report, and nothing you or the structuring model can do will move it.",
          ]}
        />
      </LegalSection>

      <LegalSection id="moderation" title="Moderation">
        <P>
          Submissions may be reviewed, suppressed, deprecated or removed under the{" "}
          <Link to="/acceptable-use" className="text-evidence-blue underline">
            acceptable use policy
          </Link>{" "}
          and the{" "}
          <Link to="/content-policy" className="text-evidence-blue underline">
            content and copyright policy
          </Link>
          . Moderation prefers visible deprecation and tombstones over silent deletion, a
          declined proposal keeps its reason, and moderation decisions are made by people —
          never by an AI system.
        </P>
      </LegalSection>

      <LegalSection id="no-payment" title="No payment, no obligation">
        <P>
          Contributions are voluntary and unpaid, and itisyou.app is not obliged to publish,
          retain in a particular place, or promote any submission. There is no reputation
          system, no rank and no reward beyond the attribution itself.
        </P>
      </LegalSection>
    </LegalDoc>
  );
}

import { Link } from "react-router";
import { LegalDoc, LegalSection, P } from "../lib/legal";

/**
 * Terms of use.
 *
 * The load-bearing section is "Commands are text you choose to run" — this is a site
 * whose subject matter is instructions that can destroy data when they are wrong, or
 * when they are right but run in the wrong place. The disclaimers exist because the
 * risk is real, not as boilerplate.
 */

export function meta() {
  return [
    { title: "Terms of use — DEV.ITISYOU" },
    {
      name: "description",
      content:
        "The terms for using dev.itisyou.app: community-contributed troubleshooting knowledge, " +
        "derived confidence signals, and commands you read and choose to run yourself.",
    },
  ];
}

export default function Terms() {
  return (
    <LegalDoc
      title="Terms of use"
      lede="The agreement between you and itisyou.app for using this site. Using it means accepting these terms; if you contribute, the contribution terms apply as well."
      path="/terms"
    >
      <LegalSection id="service" title="What this service is">
        <P>
          DEV.ITISYOU is a public, community-contributed troubleshooting knowledge base operated
          by itisyou.app. Knowledge here is structured as diagnostic procedures — problem,
          environment, tests, root cause, fix — with the evidence behind each fix tied to the
          exact revision that was tested. Reading, searching and running a diagnosis require no
          account and are free.
        </P>
      </LegalSection>

      <LegalSection id="user-content" title="The content is user-submitted">
        <P>
          Playbooks, reproduction reports and evidence are submitted by contributors. itisyou.app
          hosts and moderates them but does not author, endorse or independently verify them.
          The confidence band on a playbook is a derived summary of what people reported after
          trying it — including failures — computed by a published rule you can read on{" "}
          <Link to="/how-verification-works" className="text-evidence-blue underline">
            how verification works
          </Link>
          . It is a signal about evidence, not a guarantee that a procedure is correct or safe
          for your situation.
        </P>
      </LegalSection>

      <LegalSection id="your-risk" title="Commands are text you choose to run">
        <P>
          Nothing on this site executes anything. Every command is inert text that you read and
          choose to run yourself, in your own shell, on your own systems. Troubleshooting
          procedures can be destructive when they are wrong — and when they are right but run in
          the wrong environment. Before running anything: read it, understand it, check it
          against your environment, and prefer a non-production system first. The safety
          classifications shown next to commands are best-effort aids, not assurances.
        </P>
        <P>
          You are responsible for what you run and for its consequences. Nothing here is
          professional advice for your specific situation.
        </P>
      </LegalSection>

      <LegalSection id="accounts" title="Accounts">
        <P>
          An account is created by signing in with GitHub and exists so contributions can be
          attributed. You are responsible for activity under your account and for the security
          of the GitHub account behind it. We may suspend an account for violations of these
          terms, the{" "}
          <Link to="/acceptable-use" className="text-evidence-blue underline">
            acceptable use policy
          </Link>{" "}
          or the{" "}
          <Link to="/content-policy" className="text-evidence-blue underline">
            content and copyright policy
          </Link>
          ; suspension revokes every session immediately.
        </P>
      </LegalSection>

      <LegalSection id="contributions" title="Contributing">
        <P>
          Submitting anything — a draft, a reproduction report, a change proposal — is governed
          by the{" "}
          <Link to="/contribution-terms" className="text-evidence-blue underline">
            contribution terms
          </Link>
          , which are linked from every submission surface before you submit. In outline: you
          keep ownership of what you write; you grant itisyou.app the permissions needed to
          host, structure, moderate, display and distribute it as part of the service; and
          published material is permanent by design.
        </P>
      </LegalSection>

      <LegalSection id="ownership" title="Ownership">
        <P>
          Contributed content belongs to its contributors. The software, design and compilation
          of the service belong to itisyou.app. No general licence to reuse published content is
          currently granted — see the{" "}
          <Link to="/content-policy" className="text-evidence-blue underline">
            content and copyright policy
          </Link>{" "}
          for what is and is not permitted, including how to raise a copyright complaint.
        </P>
      </LegalSection>

      <LegalSection id="moderation" title="Moderation and removal">
        <P>
          Content that violates our policies may be suppressed, deprecated or, where the law or
          safety requires it, removed. Because published revisions are immutable and evidence is
          append-only, moderation prefers deprecation and visible tombstones over silent
          deletion: a removed page says it was removed, and a declined proposal keeps its
          reason. Moderation decisions are made by people, recorded in an append-only audit log,
          and never delegated to an AI system.
        </P>
      </LegalSection>

      <LegalSection id="availability" title="Availability">
        <P>
          The service is provided as it stands, without a promise of uninterrupted availability.
          We may change, suspend or discontinue features. If the service were ever to shut
          down, the intention recorded in our own engineering decisions is deprecation with
          notice rather than silent disappearance — but that intention is not a contractual
          commitment.
        </P>
      </LegalSection>

      <LegalSection id="liability" title="Liability">
        <P>
          Nothing in these terms excludes or limits liability for death or personal injury
          caused by negligence, for fraud or fraudulent misrepresentation, or for anything else
          that cannot be excluded or limited under the law of England and Wales.
        </P>
        <P>
          Subject to that: the service and its content are provided without warranties of any
          kind, and itisyou.app is not liable for loss or damage arising from reliance on
          content, from running commands found here, or from unavailability of the service —
          whether in contract, tort or otherwise — to the fullest extent the law permits. If you
          use this site as a consumer, your statutory rights are unaffected.
        </P>
      </LegalSection>

      <LegalSection id="changes" title="Changes to these terms">
        <P>
          Changes are published on this page with a new effective date. Continuing to use the
          service after a change takes effect means accepting the changed terms; if a change
          materially affects contributors, we will make it visible on the contribution surfaces
          rather than relying on anyone re-reading this page.
        </P>
      </LegalSection>

      <LegalSection id="law" title="Governing law">
        <P>
          These terms are governed by the law of England and Wales, and the courts of England
          and Wales have jurisdiction — except that if you use the service as a consumer
          elsewhere in the UK, you keep the protection of, and may bring proceedings under, the
          law of the part of the UK where you live.
        </P>
      </LegalSection>
    </LegalDoc>
  );
}

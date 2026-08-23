import { Link } from "react-router";
import { LegalDoc, LegalSection, LegalList, P } from "../lib/legal";

/**
 * The AI and automated-processing disclosure.
 *
 * Everything on this page corresponds to an enforced boundary: the allowed-task and
 * forbidden-task lists are code, the provenance table is schema, and the publish gate
 * re-checks confirmation server-side. The page must not claim a control that is not
 * enforced, and must not soften one that is.
 */

export function meta() {
  return [
    { title: "How AI is used — DEV.ITISYOU" },
    {
      name: "description",
      content:
        "AI on dev.itisyou.app is assistive, never authoritative: it structures what contributors " +
        "submit, its output requires human confirmation, and it can never publish, verify, delete " +
        "or suspend.",
    },
  ];
}

export default function HowAiIsUsed() {
  return (
    <LegalDoc
      title="How AI is used"
      lede="One rule governs AI here: it may assist, and it may never be the authority. This page states what it does, what it is structurally prevented from doing, and who processes what."
      path="/ai"
    >
      <LegalSection id="today" title="What AI does here today">
        <P>
          One thing: when a contributor submits rough notes for structuring, a model proposes a
          structured playbook — problem, steps, environment — for that contributor to review,
          correct and confirm. That is the only AI processing in the product. Reading,
          searching, diagnosing and filing reports involve no AI at all, and nothing on this
          site generates answers: there is no chatbot, and the model never writes knowledge on
          its own account.
        </P>
      </LegalSection>

      <LegalSection id="never" title="What AI can never do">
        <P>
          The boundary is enforced in code, not in policy alone: the task allow-list is checked
          before any request is built, and the forbidden list throws rather than asks. AI on
          this site can never:
        </P>
        <LegalList
          items={[
            "create or change verification state — confidence is derived from human reproduction reports by a published rule, and there is no field a model could set;",
            "publish anything — every AI-proposed field is recorded with its provenance, and publication is blocked until a person has confirmed or rewritten each one, a check that runs again server-side at the moment of writing;",
            "delete content, suspend accounts, or approve identity claims — these require a human administrator and land in an append-only audit log;",
            "execute code — commands on this site are inert text, for the model as for everyone else.",
          ]}
        />
      </LegalSection>

      <LegalSection id="who" title="Who processes what">
        <P>
          Structuring is performed by Anthropic, a US AI provider. What is sent is the text the
          contributor submitted, wrapped so the model treats it as untrusted content — and
          nothing else: request metadata carries a label for the kind of task, not the
          contributor&rsquo;s identity. Content is sent only at the moment a contributor
          submits it for structuring; browsing the site sends nothing to any AI provider.
        </P>
        <P>
          The model&rsquo;s output is stored as a proposal on the contributor&rsquo;s private
          draft, together with a per-field provenance record that keeps what the model
          originally proposed even after the contributor corrects it. An operational ledger
          records each task&rsquo;s token counts, cost and latency, and a daily spending cap is
          enforced before any call is made.
        </P>
      </LegalSection>

      <LegalSection id="provenance" title="AI does not launder provenance">
        <P>
          Structuring does not change who owns what. A contributor&rsquo;s material remains
          theirs after the model has structured it, and third-party copyrighted material does
          not become anyone else&rsquo;s because a model rephrased it — the{" "}
          <Link to="/content-policy" className="text-evidence-blue underline">
            content and copyright policy
          </Link>{" "}
          treats AI paraphrase as the copy it is. Source references are recorded and displayed,
          not dissolved into model output.
        </P>
      </LegalSection>

      <LegalSection id="decisions" title="No automated decisions about you">
        <P>
          No decision with legal or similarly significant effects is made by automation.
          Moderation and suspension are human decisions; the model has no capability to make
          them, and the audit log records who did.
        </P>
      </LegalSection>

      <LegalSection id="ai-readers" title="AI systems reading this site">
        <P>
          Crawlers, including AI crawlers, are deliberately not blocked from public knowledge
          pages: this is a public reference, and being cited is part of its purpose. Our{" "}
          <a href="/llms.txt" className="text-evidence-blue underline">
            llms.txt
          </a>{" "}
          asks AI systems to cite revision-pinned URLs, so a claim can be traced to the exact
          text and evidence that backed it.
        </P>
      </LegalSection>
    </LegalDoc>
  );
}

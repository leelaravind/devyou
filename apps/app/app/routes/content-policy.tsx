import { Link } from "react-router";
import { LegalDoc, LegalSection, LegalList, P } from "../lib/legal";

/**
 * Content and copyright policy.
 *
 * The principle is ADR-0013's: external sources are evidence, never content to copy.
 * The takedown procedure is deliberately a UK-shaped copyright complaint procedure,
 * not a recital of US statute.
 */

export function meta() {
  return [
    { title: "Content and copyright policy — DEV.ITISYOU" },
    {
      name: "description",
      content:
        "External sources are evidence, not content to copy: what contributors may do with " +
        "third-party material, and how to raise a copyright complaint.",
    },
  ];
}

export default function ContentPolicy() {
  return (
    <LegalDoc
      title="Content and copyright policy"
      lede="One principle governs third-party material here: external sources are evidence, never content to copy."
      path="/content-policy"
    >
      <LegalSection id="principle" title="The principle">
        <P>
          Contributors may use external technical sources — documentation, Stack Overflow,
          articles, repositories — to research, verify and support playbooks they write
          themselves, subject to each source&rsquo;s licence and terms. The path from an
          external source to a playbook goes through evidence: read it, cite it, record where
          it came from, and write the knowledge independently.
        </P>
      </LegalSection>

      <LegalSection id="permitted" title="What contributors may do">
        <LegalList
          items={[
            "Write independent explanations in their own words, informed by what they read and — above all — by what they ran.",
            "Extract facts: version numbers, error strings, configuration keys, observed behaviour. Facts are not copyrightable; their expression is.",
            "Link and cite. Source references are first-class records here, stored with URL, title, publisher and retrieval date, and shown with the playbook.",
            "Quote minimally, where a short excerpt is genuinely needed — an error message, a line of a changelog — with attribution.",
            "Include open-source code only within its licence, with the attribution and notices that licence requires. Publicly accessible is not the same thing as freely reusable: a repository with no licence is fully copyrighted by default.",
          ]}
        />
      </LegalSection>

      <LegalSection id="prohibited" title="What is prohibited">
        <LegalList
          items={[
            "Republishing or substantially reproducing third-party articles, documentation, Stack Overflow answers, GitHub content or any other copyrighted material as a contribution.",
            "Disguising a copy: light rewording, reordering or reformatting of someone else's work is still a copy.",
            "Laundering through AI: running third-party material through a structuring or paraphrasing model does not erase its provenance and does not make it yours. This holds for our own structuring pipeline too, by design.",
            "Stripping attribution or licence notices from open-source code.",
          ]}
        />
        <P>
          Plagiarism is an enumerated moderation reason in this system. Contributions that
          violate this policy are subject to the moderation actions described in the{" "}
          <Link to="/contribution-terms" className="text-evidence-blue underline">
            contribution terms
          </Link>
          , and repeat violations to account suspension.
        </P>
      </LegalSection>

      <LegalSection id="reuse" title="Reusing content from this site">
        <P>
          Published playbooks are the copyright of their contributors, hosted here under the
          contribution terms. No general reuse licence is currently offered: an open-licence
          decision is explicitly recorded as pending in our engineering decision record, and
          until it is made, all rights are reserved by the respective contributors. Linking and
          citation are welcome — every revision has a permanent URL that exists to be cited,
          and our{" "}
          <a href="/llms.txt" className="text-evidence-blue underline">
            llms.txt
          </a>{" "}
          invites AI systems to cite revision-pinned URLs.
        </P>
      </LegalSection>

      <LegalSection id="complaints" title="Copyright complaints and takedown">
        <P>
          If you believe content on this site infringes copyright you own or represent, write
          to the postal address below, marked for copyright complaints, including:
        </P>
        <LegalList
          items={[
            "identification of the copyrighted work you say is infringed;",
            "the URL of the material on this site (playbook and, where relevant, revision URL);",
            "your name and contact details, and, if you act for the rights holder, your authority to do so;",
            "a statement that you believe in good faith that the use is not authorised by the rights holder, their agent or the law;",
            "a statement that the information in the notice is accurate.",
          ]}
        />
        <P>
          On receiving a valid complaint we will review the material and, where the complaint
          is well founded, suppress or remove it. Because published revisions are immutable and
          evidence is append-only, removal takes the form of a visible tombstone rather than a
          silent gap — the record that something was removed, and why in general terms, is
          preserved. The contributor will be notified where we can reach them and may respond
          with a counter-statement, which we will assess before deciding whether the material
          is restored. Contributors who repeatedly infringe lose the ability to contribute.
        </P>
      </LegalSection>
    </LegalDoc>
  );
}

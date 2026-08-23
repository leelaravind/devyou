# ADR-0013 — Public licensing and contribution terms

- **Status:** Accepted
- **Date:** 2026-08-23
- **Phase:** 14
- **Supersedes:** —
- **Decided by:** the owner, 23 August 2026. This ADR records that decision; it does not
  make one.

## Context

This is the ADR that A0-3 has pointed at since Phase 0. The product launched without it,
which was tolerable only because the corpus was seeded by its operator: the moment an
unrelated contributor submits material, three questions stop being deferrable —

1. What may DevYou itself do with external technical sources (Stack Overflow, vendor
   documentation, blog posts, GitHub repositories)?
2. What does a contributor grant DevYou, and what do they keep?
3. What may the public do with published playbooks?

The research constraints bearing on this are R-43 (recommends DCO sign-off rather than a
CLA, a CC BY-SA-family content licence, and deprecation over hard delete) and R-44
(resolve licensing **before importing anything**; Stack Overflow content is CC BY-SA and
revision-tied; GitHub content defaults to full copyright absent a licence). Research is
rationale, not authority — the decision itself belonged to the owner.

## Decision

The owner decided questions 1 and 2 on 23 August 2026. Question 3 is **explicitly not
decided** — see "Deliberately left open".

### 1. External sources are evidence, never content to copy

DevYou may use external technical sources to research, verify and support independently
created structured playbooks, subject to each source's applicable licence and terms.

The permitted pipeline is:

```
external source → evidence / provenance record → independently written structured knowledge
```

The prohibited pipeline is:

```
external source → wholesale copy or rewrite → publication
```

Concretely, DevYou and its contributors must prefer independently written explanations,
factual extraction, source attribution, links and citations to originals, minimal
quotation only where justified, and licence/provenance metadata where applicable. It is a
policy violation to republish, substantially reproduce, or disguise copies of third-party
articles, documentation, Stack Overflow answers, GitHub content or other copyrighted
material as DevYou content. Open-source code and snippets must respect the applicable
repository licence and its attribution requirements; publicly accessible is not the same
thing as freely reusable.

**AI structuring is not a laundering boundary.** Running third-party copyrighted material
through the structuring model does not erase its provenance and does not make the output
ITISYOU-owned or contributor-owned content. The schema already models this direction
correctly — `source_references` carries `url`, `title`, `source_type`, `publisher` and
`retrieved_at`, bound to revisions through `revision_source_references`, and
`draft_field_provenance` records what the model proposed and on what basis — and this ADR
makes it policy rather than merely schema: ingestion and contribution surfaces must
preserve source URL, attribution and licence information where known.

`plagiarism` is already an enumerated moderation reason in `moderation_cases`; this ADR is
the policy it enforces.

### 2. Contributors keep ownership and grant DevYou the permissions the product needs

Contributions are governed by explicit contribution terms, published at
`/contribution-terms` and linked from every submission surface before the point of
submission. Their shape, as decided:

- **Ownership stays with the contributor.** There is no assignment and no CLA.
- The contributor grants ITISYOU the permissions **actually required** to operate the
  product: host, store, reproduce, structure (including AI-assisted structuring),
  moderate, display and distribute the submitted material as part of the service.
- For **published** revisions and filed reports, that grant does not lapse, because the
  product's evidence model is built on permanence: published revisions are immutable
  (ADR-0005), reports are append-only, and superseded revisions stay readable with their
  evidence. A licence that could be withdrawn would let a contributor delete the evidence
  trail, which is the exact thing the schema's triggers exist to prevent.
- The terms carry the contributor's representations about the material they submit —
  that they hold the necessary rights, that third-party material complies with the
  content policy, that reports describe what actually happened. This delivers the
  *substance* of R-43's DCO recommendation as contractual representations; no
  `Signed-off-by` mechanic is added to the submission flow in V1.

### 3. The public legal/contact identity

The public legal contact for the service is:

> itisyou.app, 13 Freeland Park, Wareham Road, Poole, Dorset, BH16 6FA, United Kingdom

The UK data-protection fee is paid under the name `itisyou.app`. No company number, VAT
number, ICO reference, DPO or telephone number exists for this service, and none may be
invented in any document.

## Deliberately left open — the outbound public licence

**What licence, if any, the public receives over published playbooks is not decided.**
R-43 recommends a CC BY-SA-family licence; the owner has neither adopted nor rejected
that recommendation. Until an ADR supersedes this one:

- Published playbooks remain the copyright of their contributors, hosted and displayed by
  DevYou under the contribution-terms grant.
- No general reuse licence is offered to readers. Linking and citation are welcome —
  `llms.txt` already invites revision-pinned citation — and that is the full extent of
  what is granted.
- The public content-policy page states this plainly rather than implying an open licence
  that does not exist.

**This open question has a clock on it.** Every contribution accepted under the current
terms is licensed to ITISYOU for operating the service, and nothing more. If the owner
later wants published content under CC BY-SA, contributions made before that decision
cannot be relicensed without going back to each contributor. Deciding before the corpus
accepts outside contributions at scale is cheap; deciding after is a per-contributor
consent exercise. This supersedes nothing about A0-3's urgency — it narrows A0-3 to this
single remaining question.

## Consequences

- The contribution surfaces now link the contribution terms before submission, and the
  publish gate names the grant. Nothing about the pipeline's mechanics changed — the
  authority boundary (ADR-0010's territory) and the provenance tables were already built
  in the right shape for this policy.
- Seeding by import remains off the table (R-44). There is no ingestion path that copies
  external content, and this ADR is the reason one must not be built.
- The legal document set at `/privacy`, `/terms`, `/contribution-terms`,
  `/content-policy`, `/acceptable-use` and `/ai` describes the implementation as it
  exists. When the implementation changes — a deletion flow, a retention job, a new AI
  task going live — the documents are part of the change, not an afterthought.
- A future outbound-licence ADR must state what happens to revisions published before
  it, and must not claim rights over them that the contribution terms in force at their
  publication did not grant.

# DevYou — `dev.itisyou.app`

A public, cross-vendor, version-aware engineering troubleshooting system.

Troubleshooting knowledge is modelled as a structured, evidence-backed playbook:

```
Problem → Environment → Symptoms → Diagnostic Tests → Observations
        → Root Cause → Fix → Evidence → Reproduction
```

You paste an error. You get playbooks that say *why they apply to your versions*. You run
one diagnostic test at a time, report what you observed, follow the branch that matches,
reach a root cause, apply the fix — and report Worked, Partial or Failed. That report
becomes revision-bound evidence for the next person.

**It is not** Stack Overflow, a social feed, a documentation wiki, or an AI chatbot.

## What makes it different

- **Verification is evidence, not a badge.** There is no `verified` boolean in the schema.
  Confidence is derived from typed evidence records and is always explainable.
- **Evidence is bound to the exact immutable revision it validated.** Editing a playbook
  creates a new revision; old evidence never silently transfers to text it never tested.
- **Failed reproductions are kept.** They are evidence, segmented by environment — not
  downvotes to be buried.
- **AI structures, it never verifies.** AI may parse rough notes into a playbook, suggest
  duplicates, classify and assist moderation. It can never create verification truth.
- **No code is executed.** Commands are inert content in V1.
- **Reading and searching need no account.**

## Documentation

| Document | What it is |
|---|---|
| [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) | The plan. Primary technical authority |
| [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) | Honest per-phase state |
| [`CLAUDE.md`](./CLAUDE.md) | Working rules, invariants, protected areas |
| [`docs/decisions/`](./docs/decisions/) | Architecture decision records |
| [`docs/implementation/`](./docs/implementation/) | Phase gate documents and audits |
| [`docs/research/RESEARCH-CONSTRAINTS.md`](./docs/research/RESEARCH-CONSTRAINTS.md) | What the research binds, traced to phases |
| [`docs/design/stitch/`](./docs/design/) | The Stitch design package — visual authority |

## Status

**Phase 0 of 14 complete.** Nothing is deployed; no Cloudflare resource exists yet.
See [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md).

## Part of the ITISYOU network

DevYou is one product on `itisyou.app`, alongside ITISYOU (network home), Space, Tools and
ATSYou. Products share conventions and a Cloudflare account — **never a database, a
session, or an authorisation boundary**. See ADR-0001.

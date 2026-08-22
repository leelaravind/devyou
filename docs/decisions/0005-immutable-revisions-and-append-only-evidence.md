# ADR-0005 — Immutable revisions and append-only evidence

- **Status:** Accepted
- **Date:** 2026-08-22
- **Phase:** 2

## Context

The architecture research calls this "the single most important architectural rule":
evidence must be bound to an immutable snapshot of the exact procedure it verified
(R-1). It names the failure mode this prevents directly — the Stack Overflow shape,
where an answer is edited after the fact and its upvotes keep describing text that no
longer exists. A reproduction report that says "worked" is worthless once the words it
tested have changed underneath it, and worse than worthless if it is still displayed
as if it applies.

DevYou's whole value proposition is that confidence is derived from evidence rather
than asserted. That claim only holds if evidence cannot silently detach from what it
verified, so this had to be enforced at more than one layer.

## Decision

Three layers, each covering something the others do not.

### 1. Schema

`playbooks` (`packages/db/src/schema/knowledge.ts`) holds no content at all — no
title, no body, nothing readable. It is stable identity plus a
`currentRevisionId` pointer. All content — title, summary, diagnostic nodes, edges,
environment constraints — hangs off `playbook_revisions`. `evidence_records.revisionId`
is `notNull`, and there is no column on `evidence_records` pointing at a playbook.
Evidence has no way to refer to the thing that gets edited, because the thing that
gets edited (the playbook) carries nothing to point at.

### 2. Database triggers

`packages/db/migrations/0001_invariant_enforcement.sql`:

| Trigger | Enforces |
|---|---|
| `trg_revision_content_immutable` | A published revision's content columns cannot be updated |
| `trg_revision_no_unpublish` | `published_at` cannot be cleared once set |
| `trg_revision_no_delete_published` | A published revision cannot be deleted |
| `trg_nodes_immutable_after_publish`, `trg_nodes_no_insert_after_publish`, `trg_nodes_no_delete_after_publish` | A published revision's `diagnostic_nodes` cannot be edited, added to, or removed from |
| `trg_edges_immutable_after_publish`, `trg_edges_no_insert_after_publish` | Same, for `diagnostic_edges` |
| `trg_edges_same_revision` | An edge's two endpoints must belong to the same revision |
| `trg_evidence_append_only_update`, `trg_evidence_append_only_delete` | `evidence_records` cannot be updated (except suppression columns) or deleted, by anybody |
| `trg_reproduction_append_only_update`, `trg_reproduction_append_only_delete` | `reproduction_reports` cannot be rewritten or deleted, by anybody |
| `trg_audit_append_only_update`, `trg_audit_append_only_delete` | `admin_audit_events` cannot be edited or deleted |

`trg_revision_content_immutable` fires on `UPDATE OF title, summary, change_summary,
playbook_id, revision_number, created_by, created_at, published_at,
supersedes_revision_id`. Lifecycle columns — `status`, `superseded_at`,
`deprecated_at`, `deprecation_reason`, `needs_reverification_at`,
`needs_reverification_reason` — are deliberately absent from that list, so
`UPDATE OF <columns>` lets the SQLite trigger fire only for statements naming the
listed columns: a revision can move from `published` to `needs_reverification` to
`deprecated` after publication, but its content cannot move at all. A revision that
could never be marked deprecated would be worse than a mutable one.

### 3. Domain layer and tests

`packages/domain` has no function that mutates a published revision. Both the
migration's comment and the schema comment on `playbookRevisions` are explicit that
this is deliberate belt-and-braces: "Any one of them alone would eventually be
bypassed by a helpful refactor." The database trigger is the layer that survives code
which does not go through the domain layer at all — a console query, a migration
script written in a hurry, a future refactor that reaches for `db.update()` directly.

### Related rules recorded here

- **Suppression, not deletion.** `evidenceRecords.suppressedAt` /
  `suppressionReason` are the only mutable columns on an evidence row, and setting
  them does not hide the row from the admin evidence inspector — it stays readable
  there, because the proof that justified suppressing it is the row itself. A
  suppression that erased its own evidence would be unauditable.
- **No exception for an administrator.** The triggers apply uniformly; the migration's
  own comment states it: a failed reproduction is evidence (plan §0.3), and a system
  where an inconvenient result can be deleted by anybody — including an admin —
  produces confidence figures that mean nothing.
- **`INITIAL_BAND` is always `unverified`.** When a reviewer judges that old evidence
  still plausibly applies to a new revision, that judgement is itself new evidence,
  recorded against the new revision going forward. It is never an inherited status —
  a new revision starts with none of the old revision's confidence, by construction,
  because nothing has tested the new text yet.

## Consequences

- **Verified, not just written down.** `scripts/verify-invariants.mjs` runs 19 checks
  straight against the deployed staging D1 database over `wrangler d1 execute`, with
  no application code in the path, and all 19 currently pass — proving the rejection
  comes from SQLite itself, not from the domain layer being well-behaved.
  `apps/app/test/invariants.test.ts` runs 11 equivalent assertions inside `workerd`
  against the real migrations, on every branch, before merge. Neither replaces the
  other: the script proves the rules hold on the database that is actually deployed
  today; the test proves a migration cannot quietly drop a trigger without CI catching
  it first.
- **Correcting a typo means a new revision.** There is no cheap edit path, by design.
  The corpus accumulates revisions indefinitely, and every one of them must stay
  addressable — plan §9 requires historical URLs to survive, because a 404 on a
  superseded revision would destroy the evidence trail that justified changing it.
  This is a real, permanent storage and addressing cost, accepted deliberately rather
  than discovered later.

## Alternatives considered

- **Soft-delete flags.** Rejected. A flag an admin can set and unset is a delete with
  extra steps — it does not change who can make evidence disappear, only how many
  clicks it takes.
- **Application-layer-only enforcement.** Rejected. The entire value of the
  database-level trigger is surviving code that does not know the rule exists: a
  console query, a migration script, a future refactor. An application-only rule is
  exactly the kind of thing a helpful refactor removes without noticing.
- **Copying evidence forward on edit, marked "may be stale."** Rejected. It asserts a
  relevance judgement — "this evidence probably still applies" — that nobody actually
  checked. `INITIAL_BAND = unverified` exists precisely so that judgement has to be
  made explicitly, as new evidence, rather than defaulted into existence by the copy
  operation itself.

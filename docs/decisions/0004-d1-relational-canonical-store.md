# ADR-0004 — D1 relational canonical store; no graph database in V1

- **Status:** Accepted
- **Date:** 2026-08-22
- **Phase:** 2

## Context

The domain is graph-shaped: Problem → Test → Observation → Cause → Fix → Evidence,
joined by branch conditions. That shape invites a graph database, and the temptation
is worth naming rather than sidestepping.

**This is a plan decision, not a research-derived one, and the record should say so
plainly.** The architecture research (`ARCH`) states outright: *"Do not select a
database now."* Where the research does engage with the shape of the domain, it says
the opposite of what the shape suggests — the fact that the domain is "graph-like"
does not imply a graph database. `RESEARCH-CONSTRAINTS.md` §3 records the database row
explicitly as "Plan + account evidence decide this, not research." IMPLEMENTATION.md
§5 is the actual source: *"The application should expose a graph-like domain while
keeping canonical persistence relational."*

The account evidence is ATSYou: it already operates D1 + Drizzle + Workers in
production, and DevYou is Cloudflare-first by the same account decision recorded in
ADR-0003. A second datastore is a second thing to operate, for a domain whose actual
traversal need turns out to be narrow (see Decision).

## Decision

Cloudflare D1 (SQLite) is the canonical store for all knowledge, evidence and identity
data, accessed through Drizzle ORM. No graph database in V1.

| Concern | Storage |
|---|---|
| Playbooks, revisions, diagnostic nodes/edges, evidence, identity, taxonomy | D1 (canonical) |
| Full-text and signature search | D1 FTS5 (`playbook_fts`, `signature_fts`), rebuilt on publish |
| Cache, config snapshots | KV — never canonical knowledge |
| Evidence attachments (logs, screenshots) | R2 (`devyou-evidence-*`), referenced by key from `evidence_records.attachment_key` |

The graph is real, but it lives as two ordinary relational tables:
`diagnostic_nodes` and `diagnostic_edges`, both `revision_id`-scoped (see ADR-0005 for
why revision-scoping matters). What makes this workable without a graph engine is that
the domain's actual traversal is bounded, not variable-depth: a diagnostic session
walks one edge at a time from the current node —
`edges.filter((edge) => edge.fromNodeId === current.id)` in
`packages/domain/src/session.ts` — which is an indexed lookup
(`diagnostic_edges_from_idx` on `from_node_id`) repeated once per step, never a
recursive or multi-hop query. There is no feature in V1 that asks "find all nodes
within N hops" or "shortest path across playbooks." A graph database earns its keep on
queries relational storage cannot express efficiently; this domain does not have one.

Cross-playbook search and ranking — which do need to look sideways across the corpus —
are exactly the case where a graph database would be the wrong tool anyway: FTS5 and
ordinary indexed joins handle "find playbooks matching this error" without walking
edges at all.

## Consequences

- **D1's real limits are carried forward, not hidden.** A database is capped at 10 GB,
  and D1 is single-threaded per database — there is no parallel write path to reach
  for later. Both are recorded here because a corpus that grows large and hot would
  hit them before Workers CPU time becomes the bottleneck.
- **No user-defined functions on D1** is why version comparison is not a semver
  function call. `versions.semverNormalized` and the environment-constraint bounds
  (`minSemver`/`maxSemver`) are stored as zero-padded, sortable strings (e.g.
  `00020.00011.00001`), so a range check is a plain SQLite string comparison. This is
  documented at the source in `packages/db/src/schema/taxonomy.ts`.
- **Partitioning is the escape hatch**, not a rewrite. Nothing in the schema prevents
  splitting by technology or problem domain into separate D1 databases later — every
  foreign key here is scoped within a revision or a playbook, not spread across an
  unbounded join. That escape hatch is deliberately unused for a V1 corpus of 30–50
  seed playbooks (plan §20); reaching for it early would be solving a problem the
  product does not have yet.
- FTS5 uses its own content copy rather than an external-content table — cheaper in
  storage at this corpus size than the alternative, and it removes several
  synchronisation triggers that could silently drift (`packages/db/migrations/0001_invariant_enforcement.sql`).

## Alternatives considered

- **A real graph database.** Rejected for V1. Plan §26 places "advanced evidence
  graph/ranking" under "Later / research-heavy," gated behind the core hypothesis
  being validated first — not something to build merely because the schema could
  support it. It would also be a second datastore to operate for a traversal depth of
  one.
- **Durable Objects per playbook.** Rejected. Search and ranking are cross-playbook by
  nature, and Durable Objects do not join across instances — every cross-playbook
  query would have to be reassembled in application code, at the cost the plan is
  trying to avoid.
- **An external Postgres.** Rejected. It abandons the Cloudflare-first direction
  established in ADR-0003 for no measured need; nothing about the graph shape of this
  domain requires it, given the bounded traversal above.

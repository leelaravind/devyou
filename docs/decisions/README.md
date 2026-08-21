# Architecture Decision Records

One decision per file, numbered, immutable once Accepted. A decision changes by a new ADR
superseding the old one — never by editing history.

## Index

| ADR | Title | Status | Phase |
|---|---|---|---|
| [0001](./0001-product-isolation-and-admin-boundary.md) | Product isolation and the Admin Console boundary | Accepted | 0 |
| [0002](./0002-product-hostnames-and-resource-naming.md) | Product hostnames and Cloudflare resource naming | Accepted | 0 |
| [0003](./0003-react-router-ssr-on-cloudflare-workers.md) | React Router SSR on Cloudflare Workers | Accepted | 0 |
| 0004 | D1 relational canonical store; no graph database in V1 | Planned | 2 |
| 0005 | Immutable revisions and append-only evidence | Planned | 2 |
| 0006 | Typed verification model; no binary verified field | Planned | 2 |
| 0007 | No arbitrary code execution in V1 | Planned | 4 |
| 0008 | Search baseline: exact + FTS first, semantic experimental | Planned | 3 |
| 0009 | Authentication strategy | Planned | 6 |
| 0010 | AI assistive-only authority boundary | Planned | 7 |
| 0011 | UGC rendering and sanitisation policy | Planned | 7 |
| 0012 | Evidence and reproduction anti-gaming policy | Planned | 8 |
| 0013 | Public licensing and contribution terms | Planned | 14 — **owner decision** |

## Mapping to `IMPLEMENTATION.md` §23

The plan lists twelve required ADRs. This repository inserts the hostname and naming
decision as 0002 — the plan folds it into §21 prose rather than listing it as an ADR, but
it is a real, hard-to-reverse decision and belongs in the record. Every plan ADR after the
first therefore shifts by one.

| Plan ADR | Here |
|---|---|
| 1 — Product isolation / Admin boundary | 0001 |
| 2 — React Router SSR / Workers | 0003 |
| 3 — D1 relational, no graph DB | 0004 |
| 4 — Immutable revision + append-only evidence | 0005 |
| 5 — Typed verification, no binary field | 0006 |
| 6 — No arbitrary code execution | 0007 |
| 7 — Search baseline | 0008 |
| 8 — AI assistive-only | 0010 |
| 9 — Authentication strategy | 0009 |
| 10 — UGC rendering / sanitisation | 0011 |
| 11 — Evidence anti-gaming | 0012 |
| 12 — Public licensing | 0013 |
| *(not in the plan's list)* — Hostnames and naming | 0002 |

Planned ADRs are written **in the phase that makes the decision**, not up front, so the
record reflects a decision actually taken against real code rather than a prediction.

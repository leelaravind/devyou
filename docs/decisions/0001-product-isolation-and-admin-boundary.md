# ADR-0001 — Product isolation and the Admin Console boundary

- **Status:** Accepted
- **Date:** 2026-08-22
- **Phase:** 0
- **Supersedes:** —

## Context

`IMPLEMENTATION.md` §13 anticipates that a shared *ITISYOU Admin Console* exists and that
DevYou should extend it, while §0.9 requires product isolation. Those two only coexist if
the shared console has a real extension mechanism, so §13 makes a source audit the first
task and forbids assumptions.

The audit is [`docs/implementation/ADMIN-CONSOLE-INTEGRATION-AUDIT.md`](../implementation/ADMIN-CONSOLE-INTEGRATION-AUDIT.md).
Its finding:

> There is no shared ITISYOU Admin Console.

`ats-admin.itisyou.app` is ATSYou's admin Worker. It has no product switcher, no product
registry, no navigation extension point, no cross-product session, and it is bound
directly to `atsyou-db-*`. A network operations surface (`ops.itisyou.app`) is *designed*
in the ATSYou repository's `docs/network/inventory.md`, but its own author lists it as
awaiting owner approval, and probing confirms it is not deployed.

The same document records the finding that settles the wider question:

> "There is no network-level datastore. Every store on this account belongs to one
> product."

## Decision

**1. DevYou is isolated by construction, not by policy.**

It owns `devyou-db-*` (D1), `devyou-evidence-*` (R2), `devyou-cache-*` (KV) and
`devyou-events-*` (Queues). No DevYou Worker is bound to any resource belonging to
ATSYou, ITISYOU, Space, Tools or News, and none ever will be. The enforcement is the
absence of the binding in `wrangler.jsonc`, which is visible in review, rather than a rule
somebody has to remember.

**2. DevYou ships its own admin Worker.**

`devyou-admin` on `dev-admin.itisyou.app`, with its own Cloudflare Access application, its
own cookie namespace, its own capability model and its own append-only audit log. This is
plan §13 integration rule 4 — *"If no safe shared integration exists, deploy the Dev admin
module separately but link it from the network Admin Console until federation is
implemented."*

**3. DevYou does not build the network console.**

Building one would exceed V1 scope, create the cross-product coupling §0.9 forbids, and
collide with another product's in-flight design.

**4. The contract is published outward, not adapted inward.**

`packages/admin-contract` defines versioned Zod schemas for what a future console would
need — a product descriptor, a content-bearing health contract, a high-level event mirror,
and a serialised capability declaration. Nothing more. In particular:

- No central console gets SQL access to `devyou-db-*` (plan §13 rule 1).
- The audit log is product-local. Any mirror is a *summary* stream, never replication.
- DevYou identity is product-local. ATSYou's `users` table is not an identity source.

**5. The admin perimeter mirrors ATSYou's, in order.**

`Access JWT → same-origin → session → surface → role → 2FA → step-up`, with Access
**failing closed** on staging and production, and `workers_dev`/`preview_urls` disabled.
Re-inventing this would be a regression against a reviewed, working posture.

## Consequences

- DevYou can be built and deployed without waiting on a console that does not exist.
- A compromise of DevYou reaches no other product's data, and an ATSYou migration cannot
  break DevYou.
- Federation later is additive: a console consumes `packages/admin-contract` without
  DevYou changing shape.
- **Cost:** operators use a second admin hostname until federation exists. Accepted —
  the alternative is coupling to an imaginary interface.
- **Blocked on the owner:** a Cloudflare Access application for the DevYou admin
  hostnames, and its AUD tag (audit action A0-1). This blocks the Phase 10 staging deploy,
  not the build.

## Alternatives considered

- **Extend `ats-admin`.** Rejected: it is one product's admin, bound to that product's
  database. Adding DevYou to it would put a DevYou surface inside ATSYou's authorisation
  boundary — the exact coupling §0.9 forbids.
- **Build the network console as part of DevYou.** Rejected: out of scope, and it would
  collide with an unapproved design owned elsewhere.
- **Give a future console direct SQL access to `devyou-db-*`.** Rejected by plan §13
  rule 1, and it would make every DevYou schema change a cross-product breaking change.

# Implementation status

**Updated:** 22 August 2026
**Repository:** `leelaravind/devyou` (private)
**Product:** DevYou — `dev.itisyou.app`

## How to read this file

| State | Means |
|---|---|
| `NOT STARTED` | No code exists for this phase |
| `IN PROGRESS` | Being worked on; not complete |
| `IMPLEMENTED` | Code exists, typechecks, lints and builds. **Says nothing about correctness** |
| `TESTED` | Unit / integration / security tests for the phase's gate criteria pass |
| `DEPLOYED STAGING` | Deployed to staging. **Not a claim that it works** |
| `VERIFIED STAGING` | Exercised against staging and the phase gate was met, with evidence recorded in `docs/evidence/` |
| `PRODUCTION READY` | Launch-gate criteria for this phase closed |

A successful build is not `TESTED`. A successful `wrangler deploy` is not
`VERIFIED STAGING`. This distinction is the point of the file.

---

## Summary

| Phase | Scope | State |
|---|---|---|
| 0 | Repository + existing-network audit | **VERIFIED** — gate passed |
| 1 | Monorepo + design system | **VERIFIED STAGING** (visual gate deferred — see below) |
| 2 | Database and domain invariants | **VERIFIED STAGING** |
| 3 | Public landing + search baseline | `IN PROGRESS` |
| 4 | Playbook reader + diagnostic engine | `NOT STARTED` |
| 5 | Environment + evidence UX | `NOT STARTED` |
| 6 | Authentication + contributor identity | `NOT STARTED` |
| 7 | Contribution pipeline + AI structuring | `NOT STARTED` |
| 8 | Reproduction + micro-contribution | `NOT STARTED` |
| 9 | Revisioning, deprecation, staleness | `NOT STARTED` |
| 10 | Dev Admin module | `NOT STARTED` |
| 11 | Security hardening | `NOT STARTED` |
| 12 | SEO, accessibility, performance, search quality | `NOT STARTED` |
| 13 | Seed corpus + closed validation | `NOT STARTED` |
| 14 | Staging freeze + launch gate | `NOT STARTED` |

**Deployed:** `devyou-app-staging` on `https://dev-staging.itisyou.app`.
**Created:** the DevYou-owned Cloudflare resources listed in
[`docs/implementation/CLOUDFLARE-RESOURCES.md`](docs/implementation/CLOUDFLARE-RESOURCES.md).
No resource belonging to another product has been created, modified or deleted.

---

## Phase 0 — Repository + existing-network audit

**State: VERIFIED.** Gate — *"no Dev code written until existing network/admin boundaries
are documented"* — is closed.

### Delivered

| Artefact | Path |
|---|---|
| Network baseline | `docs/implementation/PHASE-0-NETWORK-BASELINE.md` |
| Admin Console integration audit | `docs/implementation/ADMIN-CONSOLE-INTEGRATION-AUDIT.md` |
| Research constraints, traced R-1 … R-46 | `docs/research/RESEARCH-CONSTRAINTS.md` |
| ADR-0001 Product isolation and Admin boundary | `docs/decisions/0001-…` |
| ADR-0002 Hostnames and resource naming | `docs/decisions/0002-…` |
| ADR-0003 React Router SSR on Workers | `docs/decisions/0003-…` |
| Working rules | `CLAUDE.md` |
| The plan, in place | `IMPLEMENTATION.md` |
| Research and Stitch package, in repository | `docs/research/`, `docs/design/` |

### Evidence

| Check | Result |
|---|---|
| `.gitignore` written **before** `git init` | ✅ The repository has never held an unignored credential |
| `git check-ignore .env` | ✅ IGNORED |
| `git check-ignore mcp` | ✅ IGNORED |
| Private GitHub repository | ✅ `gh repo view` → `visibility: PRIVATE` |
| Cloudflare inventory (Workers, D1, KV, R2) | ✅ Taken. Queues **UNCONFIRMED** (U-1) |
| Cloudflare mutations made | ✅ **None** |
| Sibling products modified | ✅ **None.** Read-only throughout |
| All four research documents read in full | ✅ |
| Stitch package (9 screens + `DESIGN.md`) inspected | ✅ Matches plan §1 exactly |

### Findings that changed the plan's assumptions

1. **There is no shared ITISYOU Admin Console.** Plan §13 anticipates extending one. It
   does not exist — `ats-admin.itisyou.app` is one product's admin, with no product
   switcher and no extension point. Plan §13 rule 4 applies: DevYou ships its own admin
   Worker. ADR-0001.
2. **Resource naming follows the account, not the plan's examples.** `devyou-*`, not
   `dev-itisyou-*`, as plan §21 itself instructs. ADR-0002.
3. **The Stitch MCP cannot be reached from this session** — it is registered for three
   other projects, and MCP servers attach at session start. Not a blocker: the complete
   generated output is already in the repository as the ZIP.

### Open owner actions

| # | Action | Blocks |
|---|---|---|
| A0-1 | Cloudflare Access application for the DevYou admin hostnames + its AUD tag | Phase 10 staging deploy |
| A0-2 | Confirm DNS / custom domains for the four DevYou hostnames | First staging deploy |
| A0-3 | Decide the public content licence and contribution terms (research recommends DCO + CC BY-SA-family, not a CLA) | Public launch, Phase 14 |

Phases 1–9 are unblocked by all three.

### Recorded unknowns

`U-1` queues not enumerable · `U-2` whether `itisyou-root-edge` fronts subdomains ·
`U-3` Cloudflare plan level vs `limits.cpu_ms` · `U-4` whether Vectorize is enabled ·
`U-5` content licence. Full detail in the baseline document, §8.

---

## Phase 1 — Monorepo + design system

**State: VERIFIED STAGING**, with one gate item deferred and named below.

### Delivered

pnpm + Turborepo workspace matching the network's conventions; twelve packages and the
public app; the "Technical Precision" token layer rebuilt from
`technical_precision/DESIGN.md` as a Tailwind 4 `@theme` over CSS variables, with a
light palette that is a re-derivation rather than an inversion; thirteen UI primitives;
the public Worker deployed to staging with its security headers and CSP nonce.

### Evidence

| Check | Result |
|---|---|
| `pnpm run lint` | ✅ clean |
| `pnpm run typecheck` | ✅ 14/14 projects |
| `pnpm run build` | ✅ |
| Deployed | ✅ `https://dev-staging.itisyou.app` |
| `/healthz` on the deployed Worker | ✅ 200, D1 reachable, content-bearing body |
| CSP present with per-response nonce | ✅ every `<script>` carries it |
| Server-rendered knowledge with JS disabled | ✅ page content present in the HTML |
| Cache policy: public on `/`, `no-store` elsewhere | ✅ |

### Gate item deferred, and why

The plan's Phase 1 gate is a **visual review against the Stitch screenshots**. The
browser automation available in this environment is not connected, so a screenshot
comparison could not be run. It is deferred to Phase 12, where Playwright is set up —
which is the better home for it anyway, because a visual check that only ever ran once
by hand is not a check.

**This is not recorded as passed.** Phase 1 is `VERIFIED STAGING` for everything above
and explicitly *unverified* visually.

### Reconciliations against the design package

| Conflict | Resolution |
|---|---|
| `DESIGN.md` front-matter says `radius.DEFAULT = 0.25rem`; all nine rendered screens use `0.125rem` | The renders win — they are the acceptance baseline |
| The landing screen loads only Inter and JetBrains Mono; seven of nine load Geist as well | Tri-font hierarchy kept, per `DESIGN.md` prose and the majority of screens |
| Stitch uses the Material Symbols icon **font** | Replaced with inline SVG. An icon font is a third-party render-blocking request, and when it fails it renders the literal text `bug_report`. Icons here carry state, so they must be present when the state is |

---

## Phase 2 — Database and domain invariants

**State: VERIFIED STAGING.** All four critical gate tests from plan §24 pass, against the
deployed database as well as in CI.

### Delivered

Drizzle schema across six files covering every entity in plan §5; two migrations —
the schema, and `0001_invariant_enforcement.sql` which is where the invariants stop
being conventions; the domain rules as pure functions (confidence derivation, graph
validation, session engine, revision lifecycle, environment matching); a migration
runner, a reset script and an invariant verification script; the technology taxonomy
seeded.

### Gate evidence

The plan names four critical gate tests. Each is asserted twice — once in CI against
the real migrations inside `workerd`, and once against the deployed staging database
with no application code in the path.

| Plan §24 gate test | Result |
|---|---|
| A published revision cannot mutate in place | ✅ rejected by `trg_revision_content_immutable` |
| Evidence remains tied to the old revision after an edit | ✅ new revision inherits zero evidence |
| Failed reproductions remain queryable | ✅ retained and returned |
| Branch graph validation rejects invalid edges | ✅ cross-revision edge rejected by `trg_edges_same_revision` |

| Suite | Result |
|---|---|
| `scripts/verify-invariants.mjs --env staging --remote` | ✅ **19/19 invariants hold** against the deployed database |
| `apps/app/test/invariants.test.ts` (workerd, real migrations) | ✅ 11/11 |
| `packages/domain` unit tests | ✅ 64/64 |
| `pnpm run typecheck` / `lint` / `test` | ✅ clean |

Two of those checks are **positive controls** rather than prohibitions — lifecycle state
must still move on a published revision, and an edge within a single draft revision must
still be accepted. A guard that blocks everything is not a guard, it is an outage.

### Two defects found and fixed during this phase

1. **A verification-node dead end.** `verification` was in neither the branching set nor
   the terminal set in `validateGraph`, so it was the one node type that could silently
   be a dead end — on the node that asks "did the fix work?", where a reader answering
   "no" is exactly who most needs a next step.
2. **A verification script that passed for the wrong reason.** The cross-revision edge
   check targeted a *published* revision, so it was rejected by the publication trigger
   before the cross-revision trigger was consulted. Retargeted at a draft.

### Taxonomy seeded

33 technologies, 171 aliases, 52 versions across the three launch domains
(Cloudflare/edge, PostgreSQL, Docker/Kubernetes) plus their runtimes and OSes. The
aliases carry the error tokens that pasted output actually contains — `SQLITE_BUSY`,
`CrashLoopBackOff`, `SQLSTATE 40001` — which is what lets a pasted error resolve to a
technology at all.

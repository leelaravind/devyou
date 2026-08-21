# Phase 0 — Network baseline

**Date:** 22 August 2026
**Deliverable required by:** `IMPLEMENTATION.md` §24, Phase 0
**Gate:** *No Dev code is written until existing network and admin boundaries are documented.*
**Gate status:** **PASSED** — this document plus
[`ADMIN-CONSOLE-INTEGRATION-AUDIT.md`](./ADMIN-CONSOLE-INTEGRATION-AUDIT.md) close it.

Everything below was established by reading the repository, reading sibling product
source, or calling the Cloudflare API. Nothing is inferred from a name. Where something
could not be established it says **UNCONFIRMED**.

---

## 1. What existed in this repository before Phase 0

Four things, and no code:

| Path | What it is |
|---|---|
| `DEV-ITISYOU-END-TO-END-IMPLEMENTATION-PLAN.md` | The implementation plan. Now `IMPLEMENTATION.md` |
| `Research/` (4 documents) | Now `docs/research/` |
| `Design/…zip` | The Stitch package. Now `docs/design/` + extracted to `docs/design/stitch/` |
| `.env`, `mcp` | Credentials. **Both gitignored before `git init` ran** |

**There was no git repository, no `.gitignore`, no source tree, no `package.json`.** The
build starts from zero. Nothing in this repository was already implemented, so nothing in
`IMPLEMENTATION_STATUS.md` may claim otherwise.

### Secret handling — verified, not assumed

`.gitignore` was written **before** `git init`, so the repository has never at any point
had an unignored credential in it.

```
$ git check-ignore -q .env && echo IGNORED   → IGNORED
$ git check-ignore -q mcp  && echo IGNORED   → IGNORED
```

- `.env` holds `ANTHROPIC_API_KEY` (variable name only was inspected; the value has not
  been printed, logged, copied into any file, or committed).
- `mcp` holds a Google Stitch MCP API key (`X-Goog-Api-Key`).
- Staging and production credentials will live in **Cloudflare Worker secrets**, never in
  this repository.

---

## 2. The ITISYOU network as it actually is

Established by `workers_list`, `d1_databases_list`, `r2_buckets_list`,
`kv_namespaces_list` against the live account on 22 August 2026, cross-read against
`docs/network/inventory.md` in the ATSYou repository.

### Products

| Product | Public host | Repository | State |
|---|---|---|---|
| ITISYOU (network home) | `itisyou.app` | `F:\Meditation` → `leelaravind/itisyou` | Live |
| Space | `space.itisyou.app` | same | Live |
| Tools | `tools.itisyou.app` | `leelaravind/uk-utility-tools` | Live |
| Network API | `api.itisyou.app` | `F:\Meditation` | Live |
| **ATSYou** | `ats.itisyou.app` | `F:\AI Resume Gen` → `leelaravind/atsyou` | **Staging only.** Production host does not resolve yet |
| **DevYou** | `dev.itisyou.app` | **this repository** → `leelaravind/devyou` | Not started |

### Workers on the account (10)

`atsyou-app-staging`, `atsyou-admin-staging`, `atsyou-jobs-staging`,
`atsyou-status-staging`, `itisyou-root-edge`, `itisyou-api`, `itisyou-maintenance`,
`uk-utility-tools`, `thraksha-updates`, `polished-frog-89f3`.

**No Worker on this account belongs to Dev.** Nothing to preserve, nothing to migrate,
nothing at risk of being overwritten.

### Stores on the account

| Kind | Name | Owner |
|---|---|---|
| D1 | `atsyou-db-production`, `atsyou-db-staging` | ATSYou |
| KV | `atsyou-cache-production`, `atsyou-cache-staging` | ATSYou |
| R2 | `itisyou-artwork-eu`, `itisyou-site-media` | Network |

ATSYou's R2 buckets (`atsyou-uploads-*`, `atsyou-exports-*`) are EU-jurisdictional and do
not appear in the account-level list; their Wrangler config is the authority.

**Queues could not be enumerated** — the Cloudflare tooling available here exposes no
queue-list operation. ATSYou's `atsyou-events-*` queues are known to exist from its
Wrangler config. **UNCONFIRMED:** whether any other queue exists. This does not affect
Dev, whose queues will be created under a name no other product uses.

> **The finding that matters:** every store on this account belongs to exactly one
> product. There is no network-level datastore and no shared schema. Dev inherits that
> posture rather than breaking it.

---

## 3. Naming and hostnames for Dev — derived, not invented

ATSYou ADR-0002 (*Product hostnames and Cloudflare resource naming*, Accepted 2026-08-18)
establishes the network convention and the constraint behind it:

- **Every hostname is a single label under `itisyou.app`.** Cloudflare Universal SSL
  covers the apex and exactly one subdomain level. `admin.dev.itisyou.app` is two levels
  deep and would require Advanced Certificate Manager — a paid add-on and an avoidable
  launch dependency.
- **Resources are named `<product>you-<resource>-<environment>`**, with the production
  Worker name unsuffixed.

`IMPLEMENTATION.md` §21 offers `dev-itisyou-web-staging`-style names but explicitly
defers: *"Use actual naming conventions from the user's Cloudflare account after
inventory."* The account convention wins. See ADR-0002 in this repository.

**Brand reading:** `DevYou` = the Dev product on `itisyou.app`, exactly as `ATSYou` = the
ATS product on `itisyou.app`.

| Purpose | Production | Staging |
|---|---|---|
| Public site + contributor UI | `dev.itisyou.app` | `dev-staging.itisyou.app` |
| Admin | `dev-admin.itisyou.app` | `dev-admin-staging.itisyou.app` |

| Kind | Production | Staging |
|---|---|---|
| Worker (public) | `devyou-app` | `devyou-app-staging` |
| Worker (admin) | `devyou-admin` | `devyou-admin-staging` |
| Worker (jobs) | `devyou-jobs` | `devyou-jobs-staging` |
| D1 | `devyou-db-production` | `devyou-db-staging` |
| R2 (evidence attachments) | `devyou-evidence-production` | `devyou-evidence-staging` |
| KV (config/cache snapshots) | `devyou-cache-production` | `devyou-cache-staging` |
| Queue | `devyou-events-production` | `devyou-events-staging` |
| Queue DLQ | `devyou-events-dlq-production` | `devyou-events-dlq-staging` |

Every one of these names is unused on the account today, so creating them cannot collide
with a live product.

---

## 4. Toolchain — matched to the network, not chosen fresh

Read from `F:\AI Resume Gen` (`package.json`, `pnpm-workspace.yaml`, `turbo.json`,
`tsconfig.base.json`, `apps/app/package.json`). Dev adopts the same stack so that a
network engineer moving between products meets one set of conventions.

| Concern | Choice | Source |
|---|---|---|
| Package manager | pnpm 11.22.0, workspaces | ATS `packageManager` |
| Task runner | Turborepo ^2.10 | ATS `turbo.json` |
| Node | >= 22.22.0 | ATS `engines` |
| Language | TypeScript ~5.9.3, `strict` + `noUncheckedIndexedAccess` | ATS `tsconfig.base.json` |
| Framework | React 19 + React Router 8 (framework/SSR mode) | ATS `apps/app` |
| Bundler | Vite 8 + `@cloudflare/vite-plugin` | ATS `apps/app` |
| Styling | Tailwind CSS 4 (`@tailwindcss/vite`), token-driven | ATS `apps/app` |
| ORM | Drizzle ORM ^0.45 + drizzle-kit ^0.31 | ATS `packages/db` |
| Auth | better-auth 1.7 + capability statements | ATS `packages/auth` |
| Tests | Vitest 4 + `@cloudflare/vitest-pool-workers` | ATS `apps/app` |
| Deploy | Wrangler ^4.123 | ATS `apps/app` |
| Validation | Zod ^4.4 | ATS `packages/schemas` |

Two ATS supply-chain measures are adopted verbatim because they are cheap and correct:
an **explicit `allowBuilds` allow-list** (only `esbuild` and `workerd` may run
install-time scripts) and a **minimum release age** gate on new dependencies.

---

## 5. The Stitch design package — what is actually in it

`docs/design/stitch/` contains **nine screens** (`code.html` + `screen.png` each) and one
design-system specification:

`landing_diagnostic_omnibox`, `search_results_triage`, `active_diagnostic_session`,
`root_cause_resolution`, `environment_management`, `contribution_ai_review`,
`dev_admin_console_overview`, `mobile_landing`, `mobile_diagnostic_session`,
plus `technical_precision/DESIGN.md`.

That matches `IMPLEMENTATION.md` §1 exactly — the plan's list of design gaps (19 missing
screens) is accurate and stands.

**Design system, from `technical_precision/DESIGN.md`:** dark-first "Technical Precision";
Geist headings / Inter body / JetBrains Mono for data; depth by tonal layering and 1px
borders rather than shadows; 4px base unit; 0.25rem default radius; a typed verification
palette (`status-documented` slate, `status-confirmed` indigo, `status-reproduced` rose,
`status-ci-verified` emerald) which maps directly onto the evidence model rather than
being decorative.

**The mobile conflict named in plan §1 is real** and resolved as the plan directs: mobile
stays interactive for Test → Result → Next Step, with full-tree visualisation behind a
drawer. `DESIGN.md`'s "mobile not recommended" line is overridden by the plan, which is
the higher authority on behaviour.

### Stitch MCP — status

The `mcp` file configures a Google Stitch MCP server
(`https://stitch.googleapis.com/mcp`). It is **registered for three other projects in
`~/.claude.json` but not for this one**, and MCP servers are attached at session start, so
it cannot be reached from the current session even after registration.

This is **not a blocker**: the complete generated output is already in the repository as
the ZIP, which is the authoritative artefact the MCP would serve. Registering Stitch for
this project is recorded as a follow-up for the phase that fills the 19 missing screens
(Phase 1 onwards), where a second generation could usefully replace the extended designs.

---

## 6. Research — what it constrains

`docs/research/03-GROK-DEV-COMMUNITY-ADOPTION-RESEARCH.md` (21 Aug 2026) is adversarial
and its conclusions bind several implementation choices:

1. **No reputation economy.** "Pure reputation points and bronze/silver/gold badges in the
   classic SO style… many seniors actively dislike it." Roles in Dev are **capabilities**,
   never status. Badges, where used at all, must be evidence-derived
   (*"used successfully in 50+ environments"*), not activity-derived. This reinforces plan
   §12 and §0.1.
2. **Cold-start is existential.** "<50 high-quality playbooks after 6 months" is named as
   the early-warning signal for fatal failure — which is where plan §20's 30–50 seed
   playbook target comes from. Phase 13 is not optional.
3. **Narrow vertical or nothing.** "Ruthless vertical focus at launch." Plan §20's three
   domains (Cloudflare/edge, PostgreSQL, Docker/Kubernetes) are consistent with the
   research's "cloud networking, database performance, security tooling".
4. **Anti-gaming is a product problem, not a moderation afterthought.** "Success-rate
   metrics without strong anti-gaming controls become attack surfaces rather than trust
   signals." Phase 8's Sybil/rate controls are load-bearing.
5. **Licensing is unresolved and is an owner decision.** Open question 7 asks what model
   "encourages contribution and limits pure extraction by model providers." Recorded as
   owner action A0-3; it gates public launch, not the build.

All four research documents have now been read in full. Their binding constraints are
extracted, numbered (R-1 … R-46) and traced to the phase that must honour them in
[`docs/research/RESEARCH-CONSTRAINTS.md`](../research/RESEARCH-CONSTRAINTS.md). Highlights
that change the build rather than merely agreeing with it:

- **R-1** — "Evidence must be bound to an immutable snapshot of the exact procedure it
  verified" is named by the architecture research as *the single most important
  architectural rule*. It exists to prevent the Stack Overflow failure mode where an
  edited answer's upvotes no longer describe its current text.
- **R-4** — confidence is a discrete band with raw counts always shown, and percentages
  are **suppressed below n < 5**. The plan says "never show a percentage unless sample-size
  rules are satisfied"; the research supplies the number.
- **R-18** — error-signature fingerprinting (stack trace → exception → message, the Sentry
  grouping model) is a **first-class retrieval path**, not a preprocessing nicety.
- **R-31** — the reproduction flow must complete in **10–30 seconds** or abandonment
  spikes. This is a hard Phase 8 gate, not a nice-to-have.
- **R-43/R-44** — DCO sign-off rather than a CLA, a CC BY-SA-family content licence, and
  no import of Stack Overflow or GitHub content without licence-aware handling.
- **§4 of that file** — Stack Overflow for Agents launched in beta on **10 June 2026**,
  converging directly on this product's differentiation. It constrains timeline, not
  architecture, and is recorded so no later phase meets it as a surprise.

Four divergences between research and plan are recorded there explicitly, with the plan
winning each one and the reasoning stated — including the honest note that the 30–50 seed
playbook target is **the plan's own judgement and is not research-derived**.

---

## 7. Implementation sequence

The plan's phase order is adopted unchanged. Dependencies below are the real ones, not
decoration.

| Phase | Scope | Depends on | Owner action blocking it |
|---|---|---|---|
| 0 | Network baseline, repo, ADRs | — | — |
| 1 | Workspace + design system from Stitch tokens | 0 | — |
| 2 | D1 schema, migrations, domain invariants | 1 | — |
| 3 | Public landing + FTS search baseline + benchmark | 2 | — |
| 4 | Playbook reader + diagnostic engine | 3 | — |
| 5 | Environment + evidence UX | 4 | — |
| 6 | Auth + contributor identity | 2 | — |
| 7 | Contribution pipeline + AI structuring | 6 | — |
| 8 | Reproduction + micro-contribution | 5, 6 | — |
| 9 | Revisioning, deprecation, staleness | 8 | — |
| 10 | Dev Admin module | 9 | **A0-1** (Access app) for staging deploy |
| 11 | Security hardening | 10 | — |
| 12 | SEO, accessibility, performance, search quality | 11 | — |
| 13 | Seed corpus + closed validation | 12 | — |
| 14 | Staging freeze + launch gate | 13 | **A0-2**, **A0-3** |

**Phases 1–9 are unblocked.** The two owner actions that matter bite at Phase 10 and
Phase 14 respectively, which is why the build proceeds now rather than waiting.

---

## 8. Explicitly recorded unknowns

Recorded rather than invented, per the standing instruction.

| # | Unknown | Impact | When it must be resolved |
|---|---|---|---|
| U-1 | Cloudflare Queues cannot be enumerated with the available tooling | None for Dev — its queue names are new | Phase 2 (queue creation) |
| U-2 | Whether `itisyou-root-edge` fronts subdomains, or only the apex | Could affect how `dev.itisyou.app` routes | Before first staging deploy |
| U-3 | Cloudflare plan level (ATS ADR-0013 notes `limits` is rejected on Free) | Determines whether Dev may set `cpu_ms` ceilings | Phase 1 (`wrangler.jsonc`) |
| U-4 | Whether Vectorize is enabled on the account | Only affects the Phase-2-of-search experiment, which is flagged off by default | Phase 12 |
| U-5 | Content licence / contribution terms | Gates opening public UGC | Phase 14 (owner action A0-3) |

---

## 9. Protected areas — off limits for the whole build

| Area | Rule |
|---|---|
| `F:\AI Resume Gen` (ATSYou) | **Read-only.** Had uncommitted changes at audit time; concurrent work is in progress there |
| `F:\Meditation`, `F:\newsroom`, `uk-utility-tools` | **Read-only** |
| `atsyou-*`, `itisyou-*` Cloudflare resources | **No writes.** List operations only |
| Any Cloudflare resource not named `devyou-*` | **No writes** |
| `.env`, `mcp` | Never read for value, never printed, never committed |

---

## 10. Phase 0 evidence

| Check | Result |
|---|---|
| `.gitignore` precedes `git init` | ✅ Verified — repository has never held an unignored credential |
| `git check-ignore .env` | ✅ IGNORED |
| `git check-ignore mcp` | ✅ IGNORED |
| Private GitHub repository created | ✅ `leelaravind/devyou` — `gh repo view` reports `visibility: PRIVATE` |
| Cloudflare inventory taken | ✅ Workers, D1, KV, R2 enumerated; queues **UNCONFIRMED** (U-1) |
| No Cloudflare resource created/modified/deleted | ✅ Every call was a `list` |
| Admin Console audit produced | ✅ `ADMIN-CONSOLE-INTEGRATION-AUDIT.md` |
| No sibling product modified | ✅ Read-only throughout |

# Implementation status

**Updated:** 23 August 2026
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
| `VERIFIED PRODUCTION` | Exercised against `dev.itisyou.app` itself, not only staging |

A successful build is not `TESTED`. A successful `wrangler deploy` is not
`VERIFIED STAGING`. This distinction is the point of the file.

---

## Summary

| Phase | Scope | State |
|---|---|---|
| 0 | Repository + existing-network audit | **VERIFIED** — gate passed |
| 1 | Monorepo + design system | **VERIFIED PRODUCTION** — visual baselines committed |
| 2 | Database and domain invariants | **VERIFIED STAGING** — the trigger tests publish a revision, so they cannot run against production |
| 3 | Public landing + search baseline | **VERIFIED PRODUCTION** — benchmark measured on staging |
| 4 | Playbook reader + diagnostic engine | **VERIFIED PRODUCTION** |
| 5 | Environment + evidence UX | **VERIFIED PRODUCTION** |
| 6 | Authentication + contributor identity | **VERIFIED STAGING** (unconfigured path; OAuth round-trip blocked on A0-4) |
| 7 | Contribution pipeline + AI structuring | `DEPLOYED` — never run against a real model |
| 8 | Reproduction + micro-contribution | **VERIFIED PRODUCTION** |
| 9 | Revisioning, deprecation, staleness | **VERIFIED PRODUCTION** |
| 10 | Dev Admin module | `DEPLOYED` — failing closed until owner action A0-1 |
| 11 | Security hardening | **VERIFIED** — 4 defects found by the corpus and fixed |
| 12 | SEO, accessibility, performance, search quality | **VERIFIED PRODUCTION** |
| 13 | Seed corpus + closed validation | `IN PROGRESS` — corpus live; **human validation not run** |
| 14 | Staging freeze + launch gate | **LAUNCHED** — see [`LAUNCH-GATE.md`](LAUNCH-GATE.md) |

**Live:** `devyou-app` on **`https://dev.itisyou.app`**, `devyou-jobs` consuming
`devyou-events-production`, and `devyou-admin` on `dev-admin.itisyou.app` deployed and
refusing every request until owner action A0-1. Staging mirrors all three.
Full assessment: [`LAUNCH-GATE.md`](LAUNCH-GATE.md) and
[`DEPLOYMENT-REPORT.md`](DEPLOYMENT-REPORT.md).

**Legal document set (ADR-0013): VERIFIED STAGING — production deploy pending owner.**
Six public routes (`/privacy`, `/terms`, `/contribution-terms`, `/content-policy`,
`/acceptable-use`, `/ai`), a footer legal nav on every page, contribution-terms links on
every submission surface, and an Anthropic disclosure at the point of capture. 67
source-level guards in `apps/app/test/legal.node.test.ts`, 18 Playwright tests across
both viewports, 116/116 E2E against staging (7 visual baselines deliberately
regenerated for the intended footer change). The production deploy was not permitted
from the implementing session; `pnpm run deploy:production` in `apps/app` ships it.
Evidence: [`docs/evidence/legal-pages-2026-08-23.md`](docs/evidence/legal-pages-2026-08-23.md).
The **outbound public reuse licence** over published playbooks remains an open owner
decision — ADR-0013 records why it has a clock on it.
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
| A0-3 | Decide the public content licence and contribution terms (research recommends DCO + CC BY-SA-family, not a CLA) — **narrowed 23 Aug 2026**: contribution terms and external-source policy decided, ADR-0013; outbound public reuse licence still open | Public launch, Phase 14 |

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

---

## Phase 3 — Public landing + search baseline

**State: VERIFIED STAGING.** The plan's gate — *"a pasted error resolves to the right
playbook"* — was measured, not asserted.

Benchmarked against the deployed staging Worker with 57 labelled queries across four
input shapes: **MRR 0.809, hit@3 88.9% (target ≥70%), zero-result 9.3% (ceiling 15%),
false-positive 0.0% (ceiling 34%)**. Evidence:
[`docs/evidence/search-benchmark-2026-08-22.txt`](docs/evidence/search-benchmark-2026-08-22.txt).
Design and trade-offs: [ADR-0008](docs/decisions/0008-search-baseline.md).

### Two defects the benchmark surfaced

1. **A 500 on every natural-language query**, from binding the candidate list three
   times while using numbered placeholders `?1..?N` — which refer to *positions*, not
   occurrences. Found because the benchmark reported a 52% zero-result rate.
2. **The benchmark itself was wrong.** It reported a transport failure as a relevance
   figure, which is the worst thing a benchmark can do: it produced plausible numbers
   while the system under test was down. It now separates transport failures from
   genuine zero-results and exits non-zero rather than reporting relevance during an
   outage.

### The scope gate

Measured bm25 score distributions and found no threshold separates a relevant hit from
an irrelevant one on a corpus this small — common English words score as well as real
matches. The lexical stage therefore runs only when a query mentions a covered
technology, resolved through 171 aliases. This is correct *because* the corpus is
narrow, and becomes wrong as coverage grows; ADR-0008 records the trigger to revisit.

---

## Phase 4 — Playbook reader + diagnostic engine

**State: VERIFIED STAGING.** Gate — *"the diagnostic flow works without JavaScript"* —
is closed by test, against the deployed Worker.

`tests/e2e/specs/no-javascript.spec.ts` disables JavaScript and walks a full diagnostic
session: every control is a real link, the search form is a real GET form, and a
playbook page renders all of its steps in the HTML. That last one is the
crawlable-knowledge gate — knowledge that only exists after hydration is knowledge no
crawler and no reader on a slow connection ever sees.

Session state lives in the URL, so a session is shareable, bookmarkable and
back-buttonable, and reaching a conclusion **records nothing by itself** — a reader
states the outcome or no evidence exists. `diagnostic-flow.spec.ts` asserts that
directly, along with backtracking truncating later steps (R-28) and the "I cannot tell"
branch existing on test nodes (R-27).

---

## Phase 5 — Environment + evidence UX

**State: VERIFIED STAGING.**

The declared environment lives in a cookie, never in an account, and is used to filter
search and to prefill the report form. Evidence is shown segmented by environment and
never averaged: the compatibility matrix renders an untested combination as an
invitation rather than a blank (R-30), and genuine conflicts between environments are
stated in words rather than smoothed into "mostly works" (R-6).

Every reproduction is bound to an **immutable environment snapshot**, not to the
reader's current preset. Pointing evidence at a mutable preset would mean that
upgrading Node silently rewrote the environment of every report that person had ever
filed.

---

## Phase 6 — Authentication + contributor identity

**State: VERIFIED STAGING for the unconfigured path.** The OAuth round-trip cannot be
exercised until owner action **A0-4**; everything around it can be and has been.

Decision record: [ADR-0009](docs/decisions/0009-authentication-strategy.md).

### Verified against `https://dev-staging.itisyou.app`

| Check | Result |
|---|---|
| `/sign-in` with no credentials configured | ✅ 200, says so plainly, renders no GitHub button |
| Account corner absent from the nav when unconfigured | ✅ no sign-in link rendered anywhere |
| `/auth/github/callback` with an unmatched state | ✅ 302 to `/sign-in?error=…`, state cookie cleared |
| `GET /sign-out` | ✅ 302, revokes nothing — a prefetcher cannot sign anybody out |
| `POST /sign-out` cross-origin | ✅ 403 |
| `POST /sign-out` same-origin | ✅ 302, session revoked server-side |
| Unknown or suspended profile | ✅ 404 |
| Capability matrix, every role × every capability | ✅ 24/24, `packages/auth/src/capabilities.test.ts` |

### One defect found and fixed: a cache-poisoning identity leak

The nav renders the signed-in contributor's handle, and a playbook page is otherwise
shared-cacheable at the edge. A signed-in reader's page would have been stored and
served to the next anonymous reader, handle included.

Closed at the Worker boundary: **any request carrying a session cookie is `no-store`**,
whatever route it hit. `Vary: Cookie` was rejected — a second cookie (the environment
preset already exists) would fragment the cache key and destroy the hit rate the public
policy exists for. Verified both directions on staging:

| Request | `cache-control` |
|---|---|
| `/p/:slug` anonymous | `public, max-age=60, s-maxage=300, stale-while-revalidate=86400` |
| `/p/:slug` with `dv_session` | `no-store` |

### What signing in does not buy

`contributor` is the role a GitHub sign-in produces, and it holds **zero
capabilities** — asserted exhaustively rather than spot-checked, so a capability added
later cannot be granted to every account that signs in without the test failing.
Account age, followers, stars and organisation membership are not read and not stored.

---

## Phase 7 — Contribution pipeline + AI structuring

**State: TESTED — not deployed, and the AI half has never met a real model.**

The whole pipeline exists: `/contribute/start` (raw capture), `/contribute/:draftId/review`
(structure review), `/contribute/:draftId/edit` (graph editor), `/contribute/:draftId/publish`
(the gate), plus `devyou-jobs`, the queue consumer that holds the AI credential.

### The authority boundary, and where it is enforced

| Claim | Enforced by |
|---|---|
| A model's inference cannot become public without a person | `draft_field_provenance` rows with `confirmed_at IS NULL` block `canPublish`; the gate is re-run inside `publishDraft` against the write itself, not only for the screen |
| Nothing AI writes leaves a draft | The jobs Worker's only writes are `contribution_drafts`, `draft_field_provenance` and its own `ai_tasks` row; `@devyou/ai` imports no database client |
| The pipeline works with no AI at all | An absent credential, a spent budget, a refusal and an unbound queue all land on the same review screen, which names the reason and offers "write the structure myself" |
| A retried job cannot overwrite an author | `structureContribution` returns immediately unless the draft is still `structuring` |
| An author's own safety classification is a floor, not a ceiling | `effectiveSafety` takes the more severe of the author's answer and `classifyCommand`, and it is what gets written to `diagnostic_nodes` |

### Publication

One `db.batch`: the revision is inserted as a draft, its graph goes in while it is still one,
and only then is `published_at` set — after which the triggers freeze it. A new revision always
gets `INITIAL_BAND` with explicit zeroes and exactly one `contributor_documentation` record, and
the superseded revision keeps its own evidence at its own URL. Asserted in
`apps/app/test/contribution.test.ts`, including the two-revision case.

### What is not done

- ~~**The deployed consumer has still never structured a real contribution.**~~ It has, once,
  on 23 August 2026 — traced end to end through the production queue and recorded in
  `docs/evidence/pipeline-e2e-2026-08-23.md`. What follows is the state before that run,
  kept because the credential-placement history is the useful part. The credential
  is now in the right place — `ANTHROPIC_API_KEY` was on `devyou-app`, the public Worker
  that has no code to read it, and was moved to `devyou-jobs` and deleted from `devyou-app`
  on 22 August 2026 — and the boundary itself is now proven against the live API:
  `verify-ai.mjs` returns 10/10, recorded in `docs/evidence/ai-boundary-2026-08-22.txt`.

  What has not happened is a message going through the production queue and coming back as
  a structured proposal. That writes production data, so it is an owner decision rather
  than a verification step, and until it happens `structure_contribution` is proven at the
  provider boundary and unproven at the deployment boundary. Those are different claims and
  this file will not merge them.

  `devyou-jobs` is deployed to production only; there is no staging jobs Worker.
- **No result cache.** Plan §11 asks for caching by normalised input hash. `ai_tasks` has
  the hash column but nowhere to keep a result, and the only copy of a previous structuring
  is inside another contributor's private draft. Recorded rather than invented.
- **`duplicate_candidates` is not wired in.** The task exists in `@devyou/ai`; nothing calls
  it, so a contributor gets no duplicate warning before publishing.
- **Node-level provenance is `ai_extracted`, never an inference.** `structuredNode` carries
  no per-field provenance, so the model has not said which parts of a step it read and which
  it filled in. The review screen says so and asks the author to delete any step they did not
  run; a stronger claim would be one the schema cannot support.

---

## Phase 8 — Reproduction + micro-contribution

**State: VERIFIED STAGING.**

Worked / Partial / Failed, prefilled from the diagnostic page, environment prefilled
from the declared one, notes optional and last. R-31 budgets the whole flow at 10–30
seconds, and forcing a written justification is a named abandonment trigger.

Notes are scanned for hidden Unicode and credential-shaped strings **at submission**,
which is the only moment the person who can fix it is still present. The receipt states
exactly what was recorded and what it will and will not affect.

One report per account per revision for signed-in contributors; one per address per
revision for anonymous ones. The address guard is skipped for signed-in contributors —
two colleagues behind one office address are two independent reproductions, and blocking
the second would discard real evidence.

---

## Phase 9 — Revisioning, deprecation, staleness

**State: IMPLEMENTED — not verified.** The routes exist (`/p/:slug/history`,
`/p/:slug/r/:n`) and `/p/:slug/r/1` returns 200 on staging, but **every playbook in the
staging corpus is at revision 1**, so nothing here has been exercised against a
superseded revision, a deprecation banner, or evidence that stayed behind on an older
version. `tests/e2e/specs/public-knowledge.spec.ts` marks where that test belongs.

This is the largest untested area in the product, and it is the mechanism the whole
evidence model rests on. It cannot move to `VERIFIED STAGING` until the corpus contains
a real superseded revision.

---

## Phase 11 — Security hardening (in progress)

**Delivered:** a hostile-content corpus of 61 entries across seven categories, and 82
tests over the four `@devyou/security` modules — 81 passing, 1 pinned known-failure.
UGC never becomes an HTML string: `markdown.ts` returns an AST and ESLint bans
`dangerouslySetInnerHTML` repository-wide. CSP carries a per-response nonce.

### Four defects found by the corpus and fixed

1. **A false positive that would have trained readers to ignore the warning.**
   `rm -rf ./node_modules` — the commonest use of those flags in this subject matter,
   and fully recoverable — classified as `destructive`, identically to `rm -rf /`. The
   classifier now inspects the target, not only the flags.
2. **`chmod -R 777 /` under-rated** as `state_changing`, indistinguishable from scoping
   the same mode to one file. The original mode bits are recorded nowhere, so it is not
   undoable; now `destructive`.
3. **`looksLikeSecret` missed credentials in connection URIs.** A pasted
   `postgres://user:password@host/db` — one of the commonest accidental leaks there
   is — passed every pattern, because they all required a literal keyword before the
   value. Now matched on structure.
4. **No open-redirect detection in `checkUrl`.** A link to a real, well-known host
   carrying `?redirect_uri=https://evil.tld` came back `safe: true` with no flags —
   exactly the shape a reader trusts without hovering, on a corpus where every link is
   user-submitted.

### One finding deliberately not "fixed"

`history -c` remains `state_changing`. `SAFETY_LEVELS` measures blast radius, and
clearing a shell history genuinely has a small one; what makes it notable is intent, and
the vocabulary has no value for that. Inflating the level would make `destructive` mean
two different things. Pinned as a visible known-failure in the test file with the
reasoning attached, rather than silently dropped.

---

## Phase 12 — SEO, accessibility, performance (in progress)

**Delivered:** a Playwright suite of 38 tests run across two viewports —
**76/76 passing** against the deployed staging Worker — covering public knowledge, the
diagnostic flow, no-JavaScript operation, axe accessibility, and eight committed visual
baselines. Plus `robots.txt`, `sitemap.xml` and a generated `llms.txt`.

### Three accessibility defects found and fixed

1. **`/search` had no `<h1>`.** Every heading on the page was an `h2`, so the document
   started at level 2 and a screen-reader user landing there had no statement of what
   the page was. Now a visually-hidden `h1` naming the query.
2. **Light-mode contrast failure on technology tags** — `#0f766e` on `#e4e4e7` measured
   **4.31:1** against R-33's 4.5:1 requirement.
3. **Light-mode contrast failure on the `state_changing` safety badge** — `#b45309` on
   `#e4e4e7` measured **3.95:1**.

Both colour failures existed only in light mode, which the product does not default
to — which is exactly why the axe run is deliberately *not* forced into dark mode. The
tokens are now `#115e59` and `#92400e`, measuring 5.1 and 4.8 against the darkest
surface they sit on, with the ratios recorded in `theme.css` so the next person to
adjust them knows what the numbers were chosen for.

### Four dead links in the global nav and footer

`/about`, `/how-verification-works`, `/contribute` and `/llms.txt` were linked from
every page on the site and all four returned 404. A dead link in a persistent nav is a
defect on every page at once. All four now exist and return 200.

### Performance measured, and two defects fixed

Evidence: [`docs/evidence/performance-2026-08-22.txt`](docs/evidence/performance-2026-08-22.txt).
TTFB 39–133 ms across every public route; HTML 4–22 KB gzip; client bundle 127 KB gzip.

1. **Every static asset was being revalidated on every navigation.** `withSecurityHeaders`
   sets `immutable` for `/assets/`, and it was never running for them: Cloudflare's
   static-asset server answers a matching path *before* the Worker does. Eleven
   content-hashed JS/CSS files, `public, max-age=0, must-revalidate`, on every page
   view by every repeat visitor. Fixed with an `_headers` file, which is the mechanism
   that actually reaches the asset server.
2. **Google Fonts was a render-blocking third party on every page.** One DNS lookup,
   one TLS handshake and one round trip to `fonts.googleapis.com` before it named a
   *second* host that needed its own — all on the critical path. The fonts are now
   self-hosted, content-hashed and served `immutable` from the same connection as the
   HTML, and `style-src`/`font-src` are down to `'self'`.

   The second reason mattered more than the first: every page view was sending the
   reader's IP and user-agent to a third party, on a product whose About page tells
   people it does not join their data to anything. Removing the request is the only
   version of that claim that is checkable.

   232 KB of distinct font bytes, latin and latin-ext only, deduplicated from the
   740 KB Google serves — it returns the same variable-font binary under a different
   name per weight.

**Not done:** no Lighthouse or field Core Web Vitals run. The figures above are real
measurements from one client at one location and are stated as that, not as a lab
score.

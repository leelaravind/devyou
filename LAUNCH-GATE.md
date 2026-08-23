# Launch gate

**Assessed:** 22 August 2026
**Product:** DevYou — `https://dev.itisyou.app`
**Verdict:** **Launched.** Live, serving, and honest about what is not finished.

This file exists to be argued with. Every row below is either backed by a command
somebody else can run, or marked as not done. A gate that grades itself on intent is
not a gate.

---

## 1. Product invariants

These are the claims the product makes about itself. If one of them is false, nothing
else on this page matters.

| Invariant | How it is enforced | Verified |
|---|---|---|
| Verification comes from evidence, never a `verified=true` flag | There is no such column. ESLint bans the identifier in `packages/db\|domain\|schemas\|search` | ✅ `deriveConfidenceBand` is a decision procedure over `evidence_records`; lint clean |
| Evidence binds to the exact immutable revision tested | `evidence_records.revision_id` is `notNull` and there is **no playbook column** — the schema cannot express carry-over | ✅ Trigger tests + `revision-lifecycle.spec.ts` against production |
| A published revision cannot change | `trg_revision_content_immutable`, `trg_revision_no_unpublish`, `trg_revision_no_delete_published` | ✅ 19/19 invariant checks on staging; 11/11 in `workerd` |
| Publishing an edit creates a new revision starting at zero evidence | `INITIAL_BAND`, explicit zeroes in `publishDraft` and `publish-revision.mjs` | ✅ Production: r1 and r2 both hold their own evidence, neither inherits |
| Failed reproductions are retained and shown | `trg_evidence_append_only_{update,delete}`, `trg_reproduction_append_only_*` | ✅ No code path deletes either; the evidence page lists failures beside successes |
| AI may structure/classify/summarise/dedupe/assist moderation, never establish truth | `ALLOWED_TASKS` / `FORBIDDEN_TASKS` allow-list; `assertTaskAllowed` throws; the publish gate reads a provenance table the contributor cannot edit | ✅ `publishDraft` re-runs the gate at the write, asserted by a test that bypasses the route |
| No arbitrary user-code execution | Commands are inert text with a static safety classification | ✅ ADR-0007; no runtime anywhere in the repository |
| Public search and read need no login | Every knowledge route resolves a principal and carries on without one | ✅ Production smoke test, all anonymous |
| Search-first, no feed | There is no feed route and no chat surface | ✅ `public-knowledge.spec.ts` asserts their absence |
| Worked / Partial / Failed is low-friction | Prefilled outcome and environment, optional notes, no sign-in wall | ✅ Reachable and submittable anonymously in production |
| DevYou owns isolated DB, storage, secrets, queues, sessions, search | `devyou-*` resources only; `users.network_actor_id` has no foreign key | ✅ ADR-0001; no cross-product join exists |
| Admin integration is an explicit contract | `@devyou/admin-contract`; DevYou ships its own admin Worker | ✅ ADR-0001, `/api/v1/{product,health,capabilities}` |
| User content, Markdown, URLs, code and AI input treated as hostile | `@devyou/security`; Markdown returns an AST, never an HTML string | ✅ 82 tests over a 61-entry hostile corpus |

---

## 2. Phase gates

| Phase | Gate | State |
|---|---|---|
| 0 | No Dev code before the network/admin audit | ✅ closed |
| 1 | Design system builds and deploys | ✅ |
| 2 | Four critical invariant tests pass against the deployed DB | ✅ 19/19 |
| 3 | A pasted error resolves to the right playbook | ✅ MRR 0.809, hit@3 88.9%, false-positive 0.0% |
| 4 | The diagnostic flow works without JavaScript | ✅ 10 tests with JS disabled |
| 5 | Evidence is segmented by environment, never averaged | ✅ compatibility matrix + conflict sentences |
| 6 | Sign-in works, or says plainly that it is unconfigured | ✅ real browser round trip in production; account created as `contributor` with no email and no capability |
| 7 | Malicious prompt text stays data; malformed model output fails safely | ✅ 10/10 against the real provider, **and** one live contribution traced end to end through the production queue — see §4 |
| 8 | A reproduction can be filed in 10–30 seconds | ✅ |
| 9 | Historical revisions survive and keep their own evidence | ✅ 11 tests against production |
| 10 | Admin refuses everything until Access is configured | ✅ Access enforcing on every path; Worker still fails closed on a variable-name mismatch (§5) |
| 11 | Hostile content is neutralised | ✅ 81/82, 1 pinned known-failure with reasoning |
| 12 | Accessible, crawlable, fast | ✅ axe clean, 98/98 E2E, TTFB 39–133 ms |
| 13 | Closed validation with real users | ❌ **not run** — see §4 |
| 14 | Production deployed and verified | ✅ this document |

---

## 3. What is deployed

| Worker | Hostname | State |
|---|---|---|
| `devyou-app` | `dev.itisyou.app` | ✅ serving |
| `devyou-jobs` | none (queue consumer only) | ✅ consuming `devyou-events-production` |
| `devyou-admin` | `dev-admin.itisyou.app` | ✅ behind Cloudflare Access, redeployed with the `CF_ACCESS_AUD` rename, and backed by one active `dev_admin` |

Production corpus: 43 playbooks, 44 published revisions (one superseded), 352 nodes,
473 edges, 33 technologies, 171 aliases, 110 evidence records, **0 reproductions**.

That last number is the honest one. Every playbook reads `Unverified`, because nobody
independent has reported trying one yet. The product is launching with its own central
claim unproven, and saying so on every page, which is the only version of this that is
not a lie.

---

## 4. What is not done, stated plainly

**Closed validation with real users has not happened.** Plan §13 asks for it and it
cannot be simulated. Everything below the surface has been tested; whether a developer
at 3am finds this faster than a search engine is not something a test suite can answer.

**The model has now been called, and the injection corpus holds.** `verify-ai.mjs` ran
against `claude-opus-5` on 22 August 2026: **10/10**. Four hostile submissions came back as
content with the schema intact, five forbidden tasks threw before a request was built, and
moderation assist flagged a destructive command and a pasted credential.
[`docs/evidence/ai-boundary-2026-08-22.txt`](docs/evidence/ai-boundary-2026-08-22.txt).

What that does **not** cover: the deployed queue consumer has still never structured a real
contribution end to end. Doing so writes production data and is an owner decision. And a
four-entry corpus plus a model's refusal is a behaviour, not a guarantee — the structural
controls are what hold regardless.

**Sign-in works, verified in a real browser.** A GitHub account is created as
`contributor`, which holds no capability, with no email stored — so it is structurally
incapable of colliding with an Access-matched administrator account. `packages/auth` had
tests for `capabilities.ts` and nothing else; the state check, cookie attributes, session
revocation and account upsert are now covered by 27 tests in `apps/app/test/auth.test.ts`.

**The contribution pipeline has run end to end in production, once.**
[`docs/evidence/pipeline-e2e-2026-08-23.md`](docs/evidence/pipeline-e2e-2026-08-23.md).
One submission → `devyou-events-production` → `devyou-jobs` → a real `claude-opus-5` call
(3994 in / 3943 out, $0.1185, no repair) → 22 provenance rows → `awaiting_review`. The 43
playbooks, 44 published revisions and 110 evidence records were untouched, and nothing was
published.

Two findings came out of it, both recorded rather than quietly fixed. **The model
classifies its own output's provenance**, so the `unconfirmed_ai_fields` blocker is only as
strong as the model's willingness to admit it inferred something — in this run it declared
all 22 fields `ai_extracted` and that blocker never fired. What stopped publication was the
deterministic requirement to state environment constraints. And **`effectiveSafety` can
raise a command's safety level but never lower it**, so the model rating a read-only
`SELECT 1` as `destructive` stands uncorrected — the same warning-fatigue defect already
fixed once in `packages/security`, reachable again through the AI path.

**The admin surface has one administrator, provisioned out of band.** Both halves of the
perimeter are now live: Access authenticates at the edge, and a `users` row with
`role = 'dev_admin'` decides what that identity may do. The first role could not come from
the console — `contributors:set_role` needs an existing admin, and self-action is refused
outright, deliberately — so it came from `scripts/bootstrap-admin.mjs`, which writes the
three rows and its own audit event and then **refuses to run again** once any active admin
exists. A bootstrap that still works after bootstrap is a backdoor.

The audit row for that grant carries `actor_id = NULL`, which is the honest value: no DevYou
administrator performed it, because none existed. Writing the new admin's own id there would
have recorded a self-promotion — the exact act the console refuses — and made the log claim
something the system does not permit.

**No AI result cache** (plan §11), and `duplicate_candidates` is written but not wired
in. Both recorded rather than quietly skipped.

**No Lighthouse or field Core Web Vitals run.** The performance figures are real
measurements from one client at one location and are stated as that.

**`pnpm run format:check` fails on ~150 files**, pre-existing and repo-wide. Cosmetic,
untouched because two concurrent sessions were writing.

---

## 5. Owner actions outstanding

| # | Action | Blocks |
|---|---|---|
| A0-1 | **Done** for `dev-admin.itisyou.app` — Access application created and enforcing on every path. See the note below | — |
| A0-3 | **Narrowed** 23 Aug 2026 — external-source policy and contribution terms decided and recorded in ADR-0013; the legal set (`/privacy`, `/terms`, `/contribution-terms`, `/content-policy`, `/acceptable-use`, `/ai`) is written, tested and **VERIFIED PRODUCTION**. Open half: the outbound public reuse licence over published playbooks. See the note below | Outbound licence only; contribution terms no longer block |
| A0-4 | **Done** — OAuth app registered, both secrets on `devyou-app`, sign-in verified in a real browser on 23 August 2026 | — |
| — | **Done** — `ANTHROPIC_API_KEY` moved to `devyou-jobs` and deleted from `devyou-app` | — |

### A0-3, narrowed 23 August 2026

The owner decided the external-source policy ("external sources are evidence, never
content to copy") and the contribution-terms shape (ownership stays with the
contributor; itisyou.app receives the permissions the product actually needs;
published material's grant is irrevocable because publication here is permanent by
design). Recorded in ADR-0013 and implemented as six public routes with a footer
legal nav, terms links on every submission surface, an Anthropic disclosure at the
point of capture, and 67 source-level guards plus an 18-test Playwright spec.
Evidence: [`docs/evidence/legal-pages-2026-08-23.md`](docs/evidence/legal-pages-2026-08-23.md).

The set is **VERIFIED PRODUCTION**: the owner ran the deploy in-session on 23 August
2026 (the implementing session's permission gate blocked it, and was not worked
around), and the full E2E suite then passed 116/116 with
`BASE_URL=https://dev.itisyou.app`, alongside anonymous curl checks of every route,
the footer, the sitemap and the submission surfaces.

What remains open is not cosmetic: **the outbound public reuse licence is
undecided** — until a superseding ADR, published playbooks are their contributors'
copyright with no general reuse licence, and every contribution accepted meanwhile
deepens the future relicensing cost.

### A0-1, verified 22 August 2026

The Access application exists and is enforcing. Checked from outside the perimeter rather
than taken on trust: an unauthenticated request to `/`, to `/moderation`, to `/assets/*`
and to `/healthz` each returns `302` to the team domain's login endpoint. There is no path
on that hostname that reaches the origin unauthenticated.

Two things about it are not yet finished, and neither is cosmetic.

**The secret was stored as `CF_ACCESS_AUD`; the Worker read `CF_ACCESS_POLICY_AUD`.** A
name that does not match is the same as a name that is absent, so the Worker stayed in its
fail-closed branch and the admin surface still served nothing — behind a correctly
configured gate. The repository has been renamed to `CF_ACCESS_AUD` to match what is
actually deployed, because the alternative asks the owner to re-enter a credential to
satisfy a spelling. **The admin Worker has not been redeployed with the rename**, so this
is fixed in source and not yet in production.

**`dev-admin-staging.itisyou.app` has no Access application, and no staging admin Worker to
protect.** `devyou-admin-staging` has never been deployed. That is a coherent state — an
absent Worker cannot be reached — but it is not the state this table previously implied.

### The Anthropic key was on the wrong Worker

It was set on **`devyou-app`** — the public request-path Worker, which has no code that
reads it — while `devyou-jobs`, which does read it, had no secrets at all.

The split those two Workers exist to enforce is stated in `apps/jobs/wrangler.jsonc`: no
request path may spend money on a model call, so the public Worker produces a queue message
and the jobs Worker — which has no hostname and no `fetch` handler — holds the credential
and consumes it. A key on `devyou-app` was a paid, prompt-injectable credential sitting in
the environment of the one Worker the open internet can reach. Nothing read it; the control
was supposed to be that nothing *could*.

Moved to `devyou-jobs` and deleted from `devyou-app` on 22 August 2026. The value was piped
from the gitignored `.env` straight into wrangler's stdin, so it was never printed, stored,
or written anywhere. `apps/app/worker-secrets.d.ts` no longer declares the variable either,
so `env.ANTHROPIC_API_KEY` in the public Worker is now a compile error as well as an absent
binding — two independent reasons, which is the right number for a control this quiet.

A0-2 (DNS and custom domains) is **closed** — the production deploy created
`dev.itisyou.app` and `dev-admin.itisyou.app` as custom domains, and both resolve.

None of these were worked around. Every one is a credential or a policy decision that
belongs to the account owner, and each degrades to a clearly-stated unavailable state
rather than to a broken page.

---

## 6. How to check this yourself

```
pnpm run typecheck            # 19/19
pnpm run lint                 # clean
pnpm run test                 # 16/16 suites
cd tests/e2e && BASE_URL=https://dev.itisyou.app pnpm exec playwright test   # 98/98
node scripts/verify-invariants.mjs --env staging --remote                    # 19/19
node scripts/search-eval.mjs --env staging --remote                          # MRR / hit@3 / zero-result
curl -s https://dev.itisyou.app/healthz
```

`verify-invariants.mjs` refuses to run against production, and that refusal is
deliberate: it publishes a revision to test the immutability triggers, and a published
revision cannot be deleted. A verification script that could clean up after itself
would be testing something other than the invariant.

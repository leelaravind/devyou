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
| 6 | Sign-in works, or says plainly that it is unconfigured | ⚠️ **unconfigured path verified; OAuth round-trip untested** — blocked on A0-4 |
| 7 | Malicious prompt text stays data; malformed model output fails safely | ⚠️ **structurally enforced and unit-tested; no real model call has been made** |
| 8 | A reproduction can be filed in 10–30 seconds | ✅ |
| 9 | Historical revisions survive and keep their own evidence | ✅ 11 tests against production |
| 10 | Admin refuses everything until Access is configured | ✅ 503 with a message naming A0-1 |
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
| `devyou-admin` | `dev-admin.itisyou.app` | ⚠️ deployed and **refusing every request** until A0-1 |

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

**No real model call has been made.** `ANTHROPIC_API_KEY` is set nowhere, so the
structuring pipeline has never run end to end against the live API. The advisory
boundary is enforced structurally and unit-tested, and `scripts/verify-ai.mjs` exists
to prove the injection resistance — it has not been run against production.

**Sign-in is unconfigured.** Blocked on A0-4. Everything else works; reports filed now
are shown and not counted, which the form says before submission.

**The admin surface serves nothing.** Blocked on A0-1. It fails closed, which is the
correct state to deploy in.

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
| A0-1 | Cloudflare Access application for `dev-admin.itisyou.app` and `dev-admin-staging.itisyou.app`, and set `CF_ACCESS_POLICY_AUD` | The admin surface, entirely |
| A0-3 | Decide the public content licence and contribution terms (ADR-0013) | Opening unrestricted public contribution |
| A0-4 | Register a GitHub OAuth app; set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` as Worker Secrets | Sign-in, and therefore counted reproductions |
| — | Set `ANTHROPIC_API_KEY` as a Worker Secret on `devyou-jobs` | AI structuring in the contribution pipeline |

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

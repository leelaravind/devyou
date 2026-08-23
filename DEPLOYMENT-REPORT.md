# Deployment report

**Date:** 22 August 2026
**Repository:** `leelaravind/devyou` (private)
**Assessment:** [`LAUNCH-GATE.md`](LAUNCH-GATE.md)

---

## Live

| | |
|---|---|
| **Public site** | **https://dev.itisyou.app** |
| Staging | https://dev-staging.itisyou.app |
| Admin | https://dev-admin.itisyou.app — deployed, refusing every request until A0-1 |

---

## Cloudflare resources

Every resource is DevYou-owned and prefixed `devyou-`. **No resource belonging to
another product on this account was created, modified, read for its data, or deleted
at any point.**

| Kind | Production | Staging |
|---|---|---|
| Worker | `devyou-app` | `devyou-app-staging` |
| Worker | `devyou-jobs` (queue consumer, no fetch handler) | **not deployed** |
| Worker | `devyou-admin` | **not deployed** |
| D1 | `devyou-db-production` | `devyou-db-staging` |
| KV | `devyou-cache-production` | `devyou-cache-staging` |
| R2 | `devyou-evidence-production` (EU jurisdiction) | `devyou-evidence-staging` (EU) |
| Queue | `devyou-events-production` | `devyou-events-staging` |

Custom domains `dev.itisyou.app` and `dev-admin.itisyou.app` were created by the
production deploy, which closed owner action A0-2.

The two "not deployed" cells are a correction to the first version of this report, which
listed all six Workers as though they existed. `wrangler secret list --env staging`
returns "Worker not found" for both, and the account's Worker list contains exactly four
`devyou-*` entries. Only `devyou-app` has a staging twin; the jobs and admin Workers have
been deployed to production only. Deploying either staging Worker would create a new
custom domain, which is a DNS change and therefore an owner decision rather than a
build step.

---

## What went out

Three migrations, applied in order to `devyou-db-production`:
`0000_initial_schema`, `0001_invariant_enforcement`, `0002_draft_field_basis`.
Production and staging schemas are identical — 54 tables, 128 indexes, 17 triggers,
compared directly rather than assumed.

Seeded: 33 technologies, 171 aliases, 52 versions; 43 playbooks as 44 published
revisions (one deliberately superseded), 352 nodes, 473 edges, 43 search documents,
110 evidence records.

**No reproduction counts were fabricated.** Plan §20 forbids it and the corpus obeys:
every playbook holds exactly one `contributor_documentation` record plus one
`official_reference` per cited source, and every one reads `Unverified` with zero
reproductions. The launch position is that the product's central claim is unproven and
says so on every page.

---

## Verification, as run

| Check | Result |
|---|---|
| `pnpm run typecheck` | 19/19 packages |
| `pnpm run lint` | clean |
| `pnpm run test` | 16/16 suites — admin 116, app 25, auth 24, domain 66, security 81 + 1 pinned |
| Playwright against **production** | **98/98** across two viewports |
| `verify-invariants.mjs` (staging, remote) | 19/19 |
| `search-eval.mjs` (staging, remote) | MRR 0.809, hit@3 88.9%, zero-result 9.3%, false-positive 0.0% |
| Production route smoke test | 19 routes, all expected statuses, 404 on an unknown path |
| Admin fails closed | 503 with a message naming owner action A0-1 |

Performance, measured rather than estimated
([`docs/evidence/performance-2026-08-22.txt`](docs/evidence/performance-2026-08-22.txt)):
TTFB 39–133 ms, HTML 4–22 KB gzip, client bundle 127 KB gzip, **zero third-party
requests on any page** — enforced by a CSP that allows only `'self'` plus the Turnstile
frame.

---

## Defects found and fixed during the build

Listed because a deployment report that only lists successes is a marketing document.
Each of these was live in the codebase, and none was found by the test that should have
caught it — which is the useful part.

1. **A cache-poisoning identity leak.** The nav renders the signed-in handle and
   playbook pages are shared-cacheable, so a signed-in reader's page would have been
   served to the next anonymous one. Any request with a session cookie is now
   `no-store` at the Worker boundary.
2. **Every static asset was revalidated on every navigation.** `withSecurityHeaders`
   sets `immutable` and was never running for `/assets/` — Cloudflare's asset server
   answers first. Eleven files, `max-age=0`, every page view, every repeat visitor.
3. **A superseded revision was labelled "Deprecated".** Those say opposite things, and
   every reader on a historical URL was being told the procedure was known-bad when it
   had only been reworded. Found by publishing a real second revision and reading the
   page — not reachable any other way.
4. **`official_references` was a number with no evidence behind it.** Written from the
   count of source links. It feeds the path to `moderate_evidence`, and
   `recomputeConfidence` would have reset it to zero on the first real reproduction —
   unbacked and unstable at once. 66 records backfilled in each environment.
5. **`rm -rf ./node_modules` rated `destructive`,** identically to `rm -rf /`. That is
   how a safety warning stops being read.
6. **`looksLikeSecret` missed connection URIs.** A pasted `DATABASE_URL` with an inline
   password passed every pattern, because they all required a literal keyword.
7. **No open-redirect detection.** A link to a real host carrying
   `?redirect_uri=https://evil.tld` came back `safe: true` — the exact shape a reader
   trusts without hovering, on a corpus where every link is user-submitted.
8. **Two light-mode contrast failures** at 4.31:1 and 3.95:1 against R-33's 4.5:1, and
   **`/search` had no `<h1>` at all**.
9. **Four dead links in the global nav and footer** — a defect on every page at once.
10. **Google Fonts was a render-blocking third party** sending every reader's IP off-site,
    on a product whose About page says it does not join their data to anything.
11. **`deploy:production` had never been run and was broken** — it set
    `CLOUDFLARE_ENV=production` while the top-level config *is* production.
12. **A search bug that 500'd every natural-language query** — the candidate list was
    bound three times while using numbered placeholders, which refer to positions.
13. **The search benchmark reported a transport failure as a relevance figure**, which is
    the worst thing a benchmark can do: plausible numbers while the system was down.

---

## Rollback

Every Worker keeps its version history. To revert:

```
wrangler rollback --name devyou-app          # or devyou-jobs, devyou-admin
```

The database cannot be rolled back, and that is by design: published revisions and
evidence records are append-only at the trigger level. A schema change is a new
migration; a content change is a new revision.

---

## Immediately next

1. ~~**A0-1** — the Access application.~~ **Done**, and enforcing on every path. The AUD had
   been stored as `CF_ACCESS_AUD` while the Worker read `CF_ACCESS_POLICY_AUD`, so the
   console still served nothing from behind a correctly configured gate. Renamed in source
   and redeployed.
2. **A0-4** — the GitHub OAuth app. Until then no reproduction can be counted toward a
   confidence band, which means no playbook can leave `Unverified`.
3. ~~`ANTHROPIC_API_KEY` on `devyou-jobs`~~ — **done.** It had been set on `devyou-app`, the
   public request-path Worker, which has no code that reads it. Moved to `devyou-jobs` and
   deleted from `devyou-app`. `scripts/verify-ai.mjs` then returned 10/10 against
   `claude-opus-5` — the first real model call this product has made
   ([evidence](docs/evidence/ai-boundary-2026-08-22.txt)). The deployed queue consumer has
   still not structured a live contribution end to end.
4. **A0-3** — narrowed on 23 August 2026. The external-source policy and the contribution
   terms are decided and recorded ([ADR-0013](docs/decisions/0013-public-licensing-and-contribution-terms.md)),
   and the full legal set is written and linked from every page and submission surface.
   What remains open is the **outbound public reuse licence** over published playbooks —
   and it has a clock on it: contributions accepted under the current terms cannot be
   relicensed later without per-contributor consent.
5. Closed validation with real developers (plan §13). It is the one gate no amount of
   further engineering closes.

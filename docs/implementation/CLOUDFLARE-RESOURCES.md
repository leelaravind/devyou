# DevYou Cloudflare resources

**Created:** 22 August 2026, Phase 1
**Account:** `a0365f6aaae5fe32b3fdb8fa08fd000c`
**Naming:** ADR-0002

Every resource below was **created new**. None existed before, and no resource
belonging to another product was created, modified or deleted at any point.

## Workers

| Worker | Hostname | Status |
|---|---|---|
| `devyou-app-staging` | `dev-staging.itisyou.app` | Deployed |
| `devyou-app` | `dev.itisyou.app` | Not yet deployed |
| `devyou-admin-staging` | `dev-admin-staging.itisyou.app` | Phase 10 |
| `devyou-admin` | `dev-admin.itisyou.app` | Phase 10 |
| `devyou-jobs-staging` | — (queue consumer) | Phase 7 |
| `devyou-jobs` | — (queue consumer) | Phase 7 |

## D1

| Name | UUID | Environment |
|---|---|---|
| `devyou-db-staging` | `ee2ac390-d79b-42b9-bb2c-53fd47e84bc7` | staging |
| `devyou-db-production` | `283a19f0-0896-4506-8f19-dda3e7fd52d2` | production |

## KV

| Name | ID | Purpose |
|---|---|---|
| `devyou-cache-staging` | `cc27b3bad3c34026b632d23ab9bcf4ff` | Config and cache snapshots. **Never canonical knowledge** — plan §4 |
| `devyou-cache-production` | `a50e21d05a15411181579c0e661c67f7` | as above |

## R2

| Name | Jurisdiction | Purpose |
|---|---|---|
| `devyou-evidence-staging` | EU | Evidence attachments only |
| `devyou-evidence-production` | EU | Evidence attachments only |

**Why EU jurisdiction.** Evidence attachments are logs and terminal output that a
contributor chose to upload. Logs are exactly the kind of artefact that carries an IP
address, a hostname or a username without the uploader noticing. The network already
places its user-content buckets in the EU, and matching that costs nothing while
keeping DevYou inside one residency story rather than opening a second one.

Note: EU-jurisdictional buckets do **not** appear in the account-level
`r2 bucket list`. Verify with `--jurisdiction eu`, or read the Wrangler config, which
is the authority.

## Queues

| Name | Role |
|---|---|
| `devyou-events-staging` | Async jobs: AI structuring, indexing, duplicate detection, staleness |
| `devyou-events-dlq-staging` | Dead letter |
| `devyou-events-production` | as above |
| `devyou-events-dlq-production` | Dead letter |

## Resolved unknowns

**U-3 — Cloudflare plan level: RESOLVED.** `apps/app/wrangler.jsonc` sets
`limits: { cpu_ms: 200 }` and the staging deploy **succeeded**. `limits` is rejected
outright with `code: 100328` on the Free plan, so the account is on Workers Paid. The
deploy is the evidence; nothing was asked or assumed.

**U-2 — whether `itisyou-root-edge` fronts subdomains: RESOLVED.** It does not.
`dev-staging.itisyou.app` was created as a custom domain by the deploy and serves the
DevYou Worker directly, with no interference from the root edge Worker.

## Still outstanding

| # | Item | Blocks |
|---|---|---|
| A0-1 | Cloudflare Access application for the two admin hostnames, and its AUD | Phase 10 admin deploy |
| U-4 | Whether Vectorize is enabled on the account | Phase 12 only — the semantic layer is flagged off by default |

## Reproducing this

```sh
wrangler d1 create devyou-db-staging
wrangler d1 create devyou-db-production
wrangler kv namespace create devyou-cache-staging
wrangler kv namespace create devyou-cache-production
wrangler r2 bucket create devyou-evidence-staging --jurisdiction eu
wrangler r2 bucket create devyou-evidence-production --jurisdiction eu
wrangler queues create devyou-events-staging
wrangler queues create devyou-events-dlq-staging
wrangler queues create devyou-events-production
wrangler queues create devyou-events-dlq-production
```

The ids the first four commands print go into `wrangler.jsonc`. They are not secrets —
a database id is not a credential, and having it in the repository is what makes a
misconfigured binding visible in review.

# ADR-0002 — Product hostnames and Cloudflare resource naming

- **Status:** Accepted
- **Date:** 2026-08-22
- **Phase:** 0

## Context

`IMPLEMENTATION.md` §21 offers example resource names (`dev-itisyou-web-staging`, …) and
then explicitly defers to reality:

> "Use actual naming conventions from the user's Cloudflare account after inventory; do
> not overwrite existing resources based on guessed names."

The Phase 0 inventory shows a settled convention already in use, and an ADR in the ATSYou
repository (its own `0002-product-hostnames-and-resource-naming`, Accepted 2026-08-18)
states the constraint behind it:

- Cloudflare **Universal SSL covers the apex and exactly one subdomain level**
  (`*.itisyou.app`). A hostname such as `admin.dev.itisyou.app` is two levels deep and
  would require Advanced Certificate Manager — a paid add-on and an avoidable launch
  dependency.
- Resources are named `<product>you-<resource>-<environment>`, with the **production
  Worker name unsuffixed**, following Cloudflare's own convention.

Live examples: `atsyou-app-staging`, `atsyou-db-production`, `atsyou-cache-staging`, on
`ats.itisyou.app` and `ats-admin-staging.itisyou.app`.

## Decision

DevYou follows the account convention. The brand reading is **`DevYou` = the Dev product
on `itisyou.app`**, exactly as `ATSYou` is the ATS product on `itisyou.app`.

### Hostnames — one label under `itisyou.app`

| Purpose | Production | Staging |
|---|---|---|
| Public site + contributor UI | `dev.itisyou.app` | `dev-staging.itisyou.app` |
| Admin | `dev-admin.itisyou.app` | `dev-admin-staging.itisyou.app` |

### Resources

| Kind | Production | Staging |
|---|---|---|
| Worker (public) | `devyou-app` | `devyou-app-staging` |
| Worker (admin) | `devyou-admin` | `devyou-admin-staging` |
| Worker (jobs) | `devyou-jobs` | `devyou-jobs-staging` |
| D1 | `devyou-db-production` | `devyou-db-staging` |
| R2 (evidence attachments) | `devyou-evidence-production` | `devyou-evidence-staging` |
| KV (config / cache snapshots) | `devyou-cache-production` | `devyou-cache-staging` |
| Queue | `devyou-events-production` | `devyou-events-staging` |
| Queue DLQ | `devyou-events-dlq-production` | `devyou-events-dlq-staging` |

The plan calls the public Worker "web"; the account calls the equivalent Worker "app".
**"app" wins** — consistency with the account beats consistency with the plan's prose,
which is exactly what §21 asks for.

Every name above was unused on the account on 22 August 2026, verified by `workers_list`,
`d1_databases_list`, `kv_namespaces_list` and `r2_buckets_list`. Creating them cannot
collide with a live product.

## Consequences

- Universal SSL covers every DevYou hostname; no certificate purchase blocks launch.
- Staging and production share no resource name, so a misconfigured binding fails loudly
  instead of quietly reading the wrong environment's data.
- The admin app sits on a distinct hostname, which is what makes a separate Cloudflare
  Access application and a separate cookie namespace possible at all.
- A `devyou-` prefix cannot be misread as an environment. `dev-itisyou-db-staging` invites
  the question of whether `dev` is the product or the environment; `devyou-db-staging`
  does not.

## Alternatives considered

- **The plan's `dev-itisyou-*` names.** Rejected: §21 defers to the account, the account
  says `<product>you-`, and `dev-` collides visually with an environment prefix.
- **`admin.dev.itisyou.app`.** Rejected: outside Universal SSL coverage.
- **A separate zone.** Rejected: another zone to buy, delegate and secure, with no benefit
  over a subdomain of a zone already on Cloudflare.

# Admin Console integration audit

**Audit date:** 22 August 2026
**Auditor:** Claude Code, Phase 0
**Required by:** `IMPLEMENTATION.md` §13 — *"integration begins with a source audit, not assumptions"*
**Status:** Complete. Findings below are drawn from source and from the live Cloudflare
account; anything that could not be established is marked **UNCONFIRMED** rather than guessed.

---

## 1. The headline finding

> **There is no shared ITISYOU Admin Console.**

The plan (§13) is written against the possibility that a central, multi-product admin
console already exists and that Dev should extend it. It does not exist. What exists is a
**per-product admin Worker**, built for exactly one product, with no product switcher, no
product registry, no navigation extension point and no cross-product session.

This is not a gap to be filled by Dev. It is the network's actual architecture, and it was
chosen deliberately — see §4.

**Consequence for Dev:** `IMPLEMENTATION.md` §13 integration rule 4 applies —

> *"If no safe shared integration exists, deploy the Dev admin module separately but link
> it from the network Admin Console until federation is implemented."*

Dev ships its own admin Worker on its own hostname, with its own database, its own
Cloudflare Access application and its own audit log. See ADR-0001.

---

## 2. What was audited

| Question (from plan §13) | Answer | Confidence |
|---|---|---|
| Repository / path | `F:\AI Resume Gen` → GitHub `leelaravind/atsyou` (private) | Confirmed — git remote read |
| Admin domain | `ats-admin.itisyou.app` (prod), `ats-admin-staging.itisyou.app` (staging) | Confirmed — `apps/admin/wrangler.jsonc` routes |
| Auth / session mechanism | Cloudflare Access (outer) → better-auth session (own cookie namespace) → surface check → role → 2FA → step-up | Confirmed — `apps/admin/app/lib/perimeter.server.ts` |
| Role / capability model | 3 roles (`USER`, `SUPPORT_ADMIN`, `SUPER_ADMIN`); capability statements map in `packages/auth/src/rbac.ts` | Confirmed — source read |
| Product switcher / registry | **Does not exist** | Confirmed — no such construct in `apps/admin` |
| Navigation extension points | **Do not exist.** `app/components/admin-shell.tsx` is a fixed shell with hardcoded ATS routes | Confirmed — source read |
| API / service-to-service auth | Worker **service bindings** with named RPC entrypoints (`JobsEntrypoint`, `PaymentsEntrypoint`) — not HTTP tokens | Confirmed — `wrangler.jsonc` `services[]` |
| Audit mechanism | `apps/admin/app/lib/audit.server.ts`, append-only, product-local, reason codes on destructive actions | Confirmed — source read |
| Shared UI package | `packages/ui` — but it is `@atsyou/ui`, scoped to the ATS repository and its Stitch variant. Not published, not cross-repo | Confirmed |
| Deployment model | pnpm workspace + Turborepo, `wrangler deploy` per app, deploy order jobs → admin → app (ATS ADR-0025) | Confirmed |

---

## 3. The ATSYou admin perimeter, in order

Read from `apps/admin/app/lib/perimeter.server.ts`. This is the pattern Dev will mirror,
because it is the network's established security posture and re-inventing it would be a
regression.

```
Cloudflare Access JWT   ← outer identity gate, fails closed on staging + production
        ↓
Same-origin assertion   ← CSRF
        ↓
Session (better-auth)   ← own cookie namespace; a customer session never grants admin
        ↓
Surface check           ← the session must have been minted for the admin surface
        ↓
Role                    ← capability statement lookup
        ↓
2FA enrolment
        ↓
Step-up (per action)    ← re-verified second factor within 600s, for privileged mutations
```

Two details worth carrying into Dev verbatim:

- **Access fails closed.** If `CF_ACCESS_TEAM_DOMAIN` or `CF_ACCESS_POLICY_AUD` is missing
  on a deployed environment, the admin surface returns `INTERNAL` and refuses to serve,
  rather than silently dropping its outer wall.
- **`workers_dev: false` and `preview_urls: false`** on the admin Worker. A `workers.dev`
  origin would route around Cloudflare Access, "which is exactly how an admin perimeter
  becomes decorative" (their comment, and it is correct).

**Cloudflare Access team domain:** `https://itisyou-network.cloudflareaccess.com`
(a `var`, not a secret — it appears in every Access redirect anyway). The paired
`CF_ACCESS_POLICY_AUD` is a Worker secret and identifies one Access application. **Dev
needs its own Access application and therefore its own AUD.** This is an owner action —
see §6.

---

## 4. Why there is no shared console, and why Dev must not create one

`docs/network/inventory.md` in the ATS repository records the finding that decided it:

> **"There is no network-level datastore. Every store on this account belongs to one
> product. That is the single most important finding for the design below."**

The same document describes a *proposed* network operations surface (`ops.itisyou.app`,
Worker `itisyou-ops`, database `itisyou-status-db`) which is **not built and not
deployed** — its own author lists it under "What I need approval for before touching
infrastructure", and the live-host probe confirms `status.itisyou.app` does not resolve.

So the only thing resembling a network console is a design that has not been implemented.

**Dev must not build it.** Building a network-wide console as part of Dev would (a) exceed
the Dev V1 scope, (b) create exactly the cross-product coupling `IMPLEMENTATION.md` §0.9
forbids, and (c) collide with another product's in-flight design. Dev links out to the
network console when one exists; it does not become one.

---

## 5. The integration contract Dev will honour

Because there is nothing to plug into today, the "explicit contract/boundary" the goal
requires is defined **outward-facing** — as the surface Dev will expose when a network
console does arrive — rather than as an inward adapter to something imaginary.

`packages/admin-contract` will define, as versioned Zod schemas and nothing more:

| Element | Shape | Notes |
|---|---|---|
| Product descriptor | `{ id: "dev", name, adminUrl, publicUrl, capabilities[] }` | Lets a future console render a product entry without knowing Dev's internals |
| Health contract | `GET /admin/api/v1/health` → `{ ok, checks[] }` | Content-bearing, not just a 200 — per the network inventory's §4 finding |
| Event mirror | `{ type, occurredAt, actorRef, summary }` | High-level admin events only. **Never** the Dev audit row itself, which stays product-local |
| Capability declaration | The Dev capability statement map, serialised | So a console can render a permission matrix it does not own |

**Hard boundaries, enforced by the absence of bindings rather than by policy prose:**

- The Dev admin Worker is bound to `devyou-db-*` **only**. It has no binding to
  `atsyou-db-*`, `itisyou-*` or any other product's store, and adding one is a
  `wrangler.jsonc` change that shows up in review.
- No central console gets direct SQL access to Dev's D1 (plan §13 rule 1).
- Dev's audit log is Dev's. Mirroring is a *summary* stream, not a replication.
- Dev identity is product-local. ATSYou's `users` table is not, and will not become, an
  identity source for Dev — the network inventory already establishes this principle for
  the status platform, and it applies identically here.

---

## 6. Owner actions this audit surfaces

These cannot be completed by Claude Code and are recorded rather than worked around.

| # | Action | Why it needs the owner | Blocks |
|---|---|---|---|
| A0-1 | Create a Cloudflare Access application for `dev-admin.itisyou.app` and `dev-admin-staging.itisyou.app`, and supply its AUD tag | Zero Trust configuration is account-level and outside `wrangler` | Deploying the Dev admin Worker to staging (Phase 10) |
| A0-2 | Confirm DNS/custom domains for `dev.itisyou.app`, `dev-staging.itisyou.app`, `dev-admin.itisyou.app`, `dev-admin-staging.itisyou.app` | Custom-domain routes are created at deploy time but the zone is shared with live products | First staging deploy |
| A0-3 | Decide the public content licence and contribution terms | Plan ADR-12 — required *before* opening unrestricted UGC, and it is a legal/commercial decision, not a technical one | Public launch (Phase 14), not earlier phases |
| A0-4 | Register a GitHub OAuth app and set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` as Worker Secrets per environment | Creating an OAuth app requires the GitHub account owner; the secret must never reach this repository | Sign-in only. Callback URLs: `https://dev-staging.itisyou.app/auth/github/callback` and `https://dev.itisyou.app/auth/github/callback` |

None of these block Phases 1–9, which is why the build proceeds. **A0-4 does not block
launch either**: with no credentials configured the sign-in page says so plainly and
every other surface — read, search, diagnose, report — works unchanged. Reports filed in
that state are shown and not counted toward confidence, which the report form states
before submission. See [ADR-0009](../decisions/0009-authentication-strategy.md).

---

## 7. What this audit deliberately did not do

- **No file in `F:\AI Resume Gen` was modified.** The audit was read-only. That repository
  had uncommitted working-tree changes at audit time, indicating active concurrent work.
- No Cloudflare resource was created, modified or deleted. Every Cloudflare call made
  during this audit was a `list` operation.
- No attempt was made to read ATSYou secrets, and none were read.

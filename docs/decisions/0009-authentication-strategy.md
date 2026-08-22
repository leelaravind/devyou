# ADR-0009 — Authentication strategy

- **Status:** Accepted
- **Date:** 2026-08-22
- **Phase:** 6
- **Supersedes:** —

## Context

`IMPLEMENTATION.md` §12 requires an authentication decision and constrains it in an unusual
direction. Most products want authentication to be the front door. DevYou needs it to be
optional infrastructure, because two of its load-bearing product invariants pull the other
way:

- §0.7 — public search and read require no login, ever.
- §0.8 — reporting a reproduction is low-friction, with a 10–30 second budget (R-31). A
  sign-in wall in that flow is measured as abandonment, not as a slightly slower form.

At the same time R-9 requires reproduction evidence to be weighted by the reporter's
independence, and an unauthenticated report cannot be weighted at all — it counts for
nothing toward a confidence band. So identity has to exist and has to matter, without ever
becoming a gate.

§12 adds one further constraint, and it is the one most likely to be violated by accident:

> Do not couple GitHub identity to trust automatically. A GitHub-linked account proves
> control of that account, not technical correctness.

## Decision

**Product-local accounts, GitHub OAuth as the only sign-in method, opaque server-side
sessions, and a capability model that confers no standing.**

### 1. Identity is product-local

DevYou owns `users`, `profiles`, `sessions` and `actor_trust`. ATSYou's `users` table is
not an identity source here and DevYou's is not one for anything else — ADR-0001 already
settled that products share a Cloudflare account and a set of conventions, never an
authorisation boundary. `users.network_actor_id` is a nullable string with **no foreign
key**, a forward hook for the day a network identity contract exists.

### 2. GitHub OAuth, with an empty scope

GitHub is the lowest-friction identity for the audience, and the audience already has an
account. The authorisation request asks for **no scopes at all**: the unscoped token
returns the public profile, which is everything the product uses. Asking for `read:user`
would make the consent screen claim more than the product does.

The access token is used once, at the callback, and **never stored**. DevYou has no reason
to act on GitHub's behalf later; a stored token would be a credential to protect, a scope
to justify and a thing to revoke, for no capability the product has.

### 3. What a GitHub account buys, precisely

An attributable identity, and nothing else. Sign-in sets `role = 'contributor'`, which
grants **zero capabilities** (asserted exhaustively in `capabilities.test.ts`).

Account age, follower count, stars, organisation membership and repository history are not
read, not stored and not used. Using any of them would be exactly the automatic trust
coupling §12 forbids — and it would import a status hierarchy from another product into one
whose research says a status hierarchy is what drove contributors away.

The one derived signal that does exist, `actor_trust`, is computed from behaviour *on this
site* — account age here, environment diversity here, clustering here. It has no display
surface and is never shown to the person it describes.

### 4. Sessions are opaque and stored hashed

A 256-bit CSRNG token in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie. The database holds
its SHA-256; the token itself is never stored, so a leaked database is not a set of live
sessions.

Not a JWT. A stateless token cannot be revoked, and revocation is a feature this product
needs on the day it needs it most: account suspension revokes every session in one
statement, and `resolvePrincipal` returns `null` for any account whose status is not
`active` — a single condition that signs a suspended user out everywhere rather than a
`status` check every call site could forget.

`SameSite=Lax` rather than `Strict`, because a contributor following a playbook link from
Slack should still be signed in. Every state-changing route separately checks the request
`Origin` against the expected host, and fails closed when the header is absent on a method
that should always send it.

### 5. Capabilities grant actions, never standing

`capabilities.ts` is the single source of truth: a statement map read by route handlers, by
the admin action layer and by the test matrix alike, so a capability cannot be granted in
one place and forgotten in another. Roles are `user`, `contributor`, `reviewer`,
`support_admin`, `dev_admin`.

`contributor` is not "above" `user`; it is a different set of buttons. There is no rank, no
score, no badge derived from a role and nothing a contributor can do to climb one.
`maintainer_verified` is deliberately **not** a role — it is a claim in
`official_identity_claims` granting exactly one thing, the ability to file
`maintainer_attestation` evidence, which is one signal among several and never outranks
reproduction. Making it a role would let authority accumulate power.

There is no `evidence:delete` capability, and its absence is the decision: evidence is
append-only at the database, so a capability to delete it would be a capability to attempt
something the storage layer refuses.

### 6. Sign-in may be absent, and that is a supported state

GitHub OAuth needs an app registered by the account owner — an action outside this
repository. When the credentials are absent, `isConfigured()` is false, the account corner
disappears from the nav and `/sign-in` says so plainly. Everything else works unchanged:
read, search, diagnose and report. Reports filed in that state are shown and not counted,
which the form says before it is submitted rather than after.

## Consequences

**A signed-in reader makes their page uncacheable.** The nav renders the contributor's
handle, and a public playbook page is otherwise shared-cacheable. `cachePolicyFor` therefore
downgrades **any request carrying a session cookie** to `no-store`, whatever route it hit.
`Vary: Cookie` would express this more precisely and is the wrong tool: any future cookie —
the environment preset cookie already exists — would fragment the cache key and destroy the
hit rate the public policy exists for. Keying on "did this request authenticate" keeps the
anonymous majority, including every crawler, fully cacheable, and fails in the right
direction: forgetting to exclude a new personalised route costs a cache miss, not a leak.

**A GitHub rename produces a new local account.** Accounts are matched on `github_login`,
not on the numeric id. Matching on the id and updating the login is correct until somebody
renames *into* a login another user vacated, at which point attribution silently transfers.
Duplicate accounts are a support problem; misattributed evidence is a correctness problem.

**Anonymous reports are guarded by address, signed-in reports by account.** One report per
account per revision, enforced by a unique index and checked in the route so the reader gets
a sentence rather than a constraint violation. The per-address guard is skipped for
signed-in contributors — two colleagues behind one office address are two independent
reproductions, and blocking the second would discard real evidence.

**Login CSRF is closed with a `state` cookie**, 256 bits of CSRNG, `Path=/auth`,
`SameSite=Lax` (a `Strict` cookie is not sent on the top-level navigation back from GitHub,
so the check would fail for every legitimate sign-in), compared in constant time and cleared
on every path — success, failure and mismatch alike, because a state value that survives a
failed attempt can be replayed.

**Email/password is not implemented and is not planned.** It would add password storage,
reset flows, and a credential-stuffing surface, to reach an audience that overwhelmingly has
a GitHub account. If a second provider is ever needed, it is a new ADR.

## Owner action required

**A0-4** — register a GitHub OAuth app and set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
as Worker Secrets per environment (`wrangler secret put`, never `.env`, never this
repository). Callback URLs:

- staging — `https://dev-staging.itisyou.app/auth/github/callback`
- production — `https://dev.itisyou.app/auth/github/callback`

Until then the deployment runs in the unconfigured state described in §6, which is
deliberately not a broken one.

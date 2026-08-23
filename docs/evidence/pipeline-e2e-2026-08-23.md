# End-to-end verification: sign-in and the contribution pipeline

**Date:** 23 August 2026
**Environment:** production — `dev.itisyou.app`, `devyou-jobs`, `devyou-db-production`
**Performed by:** the account owner, in a real browser, with tracing from the repository

Two things were proven here that no test suite could: that a person can sign in to the
live site with GitHub, and that a contribution they write reaches a real model and comes
back as a structured proposal that **cannot publish itself**.

Nothing in this document is a credential. Session tokens, the OAuth code, the client
secret and the API key are absent by construction — every figure below came from
`wrangler tail`, from `wrangler secret list` (which returns names only), or from counting
rows.

---

## 1. GitHub sign-in

Owner action A0-4 was completed by the account owner: an OAuth app with callback
`https://dev.itisyou.app/auth/github/callback`, and `GITHUB_CLIENT_ID` /
`GITHUB_CLIENT_SECRET` stored as Worker secrets on `devyou-app`.

The live request sequence, from `wrangler tail` on `devyou-app`:

```
GET  /sign-in                              Ok   06:45:20
POST /sign-in.data                         Ok   06:45:24   ← state cookie issued
GET  /auth/github/callback?code=…&state=…  Ok   06:45:28   ← state matched, code exchanged
GET  /                                     Ok   06:45:29   ← signed in
```

Nine seconds, no error redirect. The account it produced:

| id | role | email | handle | github_login | live sessions |
|---|---|---|---|---|---|
| `usr_01M0PJE3207J6WYHYMAJH9B8TD` | `contributor` | **null** | `leelaravind` | set | 1 |

Two properties of that row matter more than the fact that it exists.

**`role = 'contributor'`, which grants no capability at all.** Plan §12 requires that a
GitHub-linked account prove control of that account and nothing else, and this is what
that looks like in the data. Follower count, account age, starred repositories and
organisation membership are not read — they are not fields on `GitHubIdentity`, so there
is nothing for a later change to begin weighting.

**`email` is null.** The unscoped token does not return one and none is asked for. That
also makes GitHub sign-in structurally unable to collide with an administrator account,
which `perimeter.server.ts` matches on `users.email`. Signing in as the owner therefore
produced a *second, separate* account rather than escalating the existing `dev_admin`
one — which is the intended shape: admin identity comes from Cloudflare Access, public
identity from GitHub, and the two are deliberately not joined.

### Secret placement, after A0-4

```
devyou-app     GITHUB_CLIENT_ID  GITHUB_CLIENT_SECRET
devyou-admin   CF_ACCESS_AUD
devyou-jobs    ANTHROPIC_API_KEY
```

Each Worker holds exactly the secrets it reads and no others. `GITHUB_CLIENT_*` appears
nowhere outside `apps/app` — verified by grep across `apps/admin`, `apps/jobs` and every
package.

### What was missing, and is no longer

`packages/auth` had tests for `capabilities.ts` and nothing else. The OAuth state check,
the cookie attributes, session revocation and the account upsert were entirely unasserted
— on the code path that decides whose name ends up attached to a piece of evidence.
`apps/app/test/auth.test.ts` now covers them: 27 tests, taking the app suite from 25 to 52.

---

## 2. The contribution pipeline

One submission, written and submitted by the owner in the browser, labelled
`E2E PIPELINE TEST - DO NOT PUBLISH` in its own first line.

```
POST /contribute/start.data      Ok   06:56:52
GET  /contribute/<id>/review     Ok   06:56:53
```

### The trace

| Stage | Evidence |
|---|---|
| Ingestion | `contribution_drafts` row `drf_01M0PK2YT8T597NK4ZW81YYCDD`, author `usr_…MAJH9B8TD`, 1128 chars raw |
| Ledger before dispatch | `ai_tasks` row `aij_01M0PK2YTT14AWYQFRGHGFRXH2` written as `queued` **before** the queue send |
| Queue | `devyou-events-production` — 1 producer (`devyou-app`), 1 consumer (`devyou-jobs`) |
| Real model call | `provider = anthropic:claude-opus-5`, `prompt_version = 2026-08-22.1` |
| Result | `status = succeeded`, 3994 input tokens, 3943 output tokens, 43,369 ms, `repair_attempted = 0` |
| Cost | **118,546 micro-USD ($0.1185)** against a 2,000,000 (\$2/day) ceiling |
| End state | draft `awaiting_review`, `published_revision_id = NULL`, 22 provenance rows |

Wall clock from submission to settled: 47 seconds.

The cost figure is derived, not asserted: 3994/1e6 × \$5 + 3943/1e6 × \$25 = \$0.118545,
rounded up to 118,546 micro-USD. The ledger and the published price agree.

### What the model produced

7 nodes, 12 edges, 4 symptoms, 2 technologies, **0 constraints**, 0 sources. Both
technology slugs (`wrangler`, `cloudflare-d1`) resolved against the existing taxonomy —
`knownTechnologySlugs` filters to active slugs, so the model cannot invent one.

### The publication gate held — but not for the reason it looks like

`canPublish` refuses on six blockers. Walking them against this draft:

| Blocker | Fired? | Why |
|---|---|---|
| `already_published` | no | a draft has no `published_at` |
| `graph_invalid` | no | 7 nodes / 12 edges validated |
| `unconfirmed_ai_fields` | **no** | **all 22 provenance rows are `ai_extracted`; zero are `ai_inferred_requires_confirmation`** |
| `unclassified_commands` | no | every command node carries a safety level and effect |
| `safety_findings` | no | no hidden Unicode, no credential shapes, no unsafe URLs |
| `no_environment_constraints` | **yes** | the model produced no constraints |

So the draft cannot publish — but the thing that stopped it was the deterministic
requirement to state which technologies and versions a playbook applies to, **not** the
AI-confirmation gate. That gate was empty, and the reason is recorded below.

---

## 3. Findings

### 3.1 The model classifies its own output's provenance

`structure.ts` writes `provenance: result.problemTitle.provenance` — the value the model
returned. `packages/ai/src/tasks.ts` lets the model choose from the full `PROVENANCE`
enum. In this run it declared every field `ai_extracted`, so
`unconfirmedInferredFields` was empty and the `unconfirmed_ai_fields` blocker never fired.

This is *within* invariant 5, which permits AI to "structure, classify, summarise". It is
still worth stating plainly: **the confirmation gate is only as strong as the model's own
willingness to admit it inferred something.** A model that labels everything `ai_extracted`
publishes without a single confirmation, as far as that blocker is concerned.

What holds regardless is everything the model does not control: the graph validator, the
deterministic safety sweep, the environment-constraint requirement, the technology-slug
allow-list, and the fact that publication is a human pressing a button on a screen that
shows all of it.

### 3.2 The deterministic command classifier can raise a safety level but never lower one

`effectiveSafety(command, declared)` returns the **maximum** of `classifyCommand(command)`
and the model's label. The direction is right: AI cannot make a dangerous command look
safe.

The cost is that AI can make a safe command look dangerous, unchecked. In this run the
model rated three of four commands `destructive`, including:

```
node ./node_modules/wrangler/bin/wrangler.js d1 execute my-db --remote --command "SELECT 1"
```

A `SELECT 1` is a read. Nothing in the pipeline corrects that downward, and the reader
sees `destructive`.

This matters because of a defect already fixed in this repository for exactly the same
reason: `rm -rf ./node_modules` used to be rated `destructive`, identically to `rm -rf /`,
and the note recorded at the time was "that is how a safety warning stops being read."
The AI path can reintroduce that warning fatigue, and `packages/security` is structurally
unable to prevent it.

The mitigation that exists is real but weak: the author can change the level on the edit
screen (`contribute.$draftId.edit.tsx:456`). It relies on somebody overruling a red label,
which people are reluctant to do.

**Not fixed here.** Whether `classifyCommand` should be allowed to lower an AI-proposed
level — or whether the model should be shown the deterministic classification and asked to
justify a disagreement — is a design decision, not a bug fix, and this verification was
scoped to stop at reporting.

### 3.3 A draft is not a proposal, and is private

`/proposals` reads `change_proposals`; a new-playbook draft never appears there. `loadDraft`
filters on `author_id`, so no other signed-in user can read it, and there is no public
route to a draft at all. The test contribution is visible to its author and to the AI
Operations totals, and nowhere else.

---

## 4. Production records created

Exactly four kinds of row, all attributable to this test:

| Table | Rows | Identifier |
|---|---|---|
| `users` | 1 | `usr_01M0PJE3207J6WYHYMAJH9B8TD` (contributor, from GitHub sign-in) |
| `profiles` | 1 | handle `leelaravind` |
| `sessions` | 1 | live, from the real sign-in |
| `contribution_drafts` | 1 | `drf_01M0PK2YT8T597NK4ZW81YYCDD` — `awaiting_review` |
| `ai_tasks` | 1 | `aij_01M0PK2YTT14AWYQFRGHGFRXH2` — `succeeded` |
| `draft_field_provenance` | 22 | all `ai_extracted`, none confirmed |

### The corpus, before and after

| | Before | After |
|---|---|---|
| playbooks | 43 | **43** |
| published revisions | 44 | **44** |
| evidence records | 110 | **110** |
| reproduction reports | 0 | **0** |
| diagnostic nodes | 352 | **352** |
| revision confidence rows | 44 | **44** |
| moderation cases | 0 | **0** |

Nothing was published, rewritten, reverified, quarantined, suppressed or deprecated.

---

## 5. Idempotency and duplicate paid work

- `ai_tasks`: 1 row, 1 distinct `input_hash`, `repair_attempted = 0`. One paid call.
- The `ai_tasks` row is written **before** the queue send, so a duplicate message cannot
  create a second billable task.
- `structureContribution` returns immediately unless `draft.status === 'structuring'`. The
  draft is now `awaiting_review`, so a redelivery today would do nothing — no model call,
  no write. This is the guard that stops a late retry from replacing an author's edits
  with the model's proposal.
- A malformed message is `ack()`ed rather than retried; only an infrastructure fault calls
  `retry()`. Retrying a prompt problem would turn one bad submission into three paid calls.
- The dead letter queue was not exercised: the single message succeeded on first delivery.

---

## 6. How to re-check this

```
wrangler d1 execute devyou-db-production --remote --command \
  "SELECT id, status, model, input_tokens, output_tokens, cost_micro_usd FROM ai_tasks"

wrangler d1 execute devyou-db-production --remote --command \
  "SELECT provenance, COUNT(*) FROM draft_field_provenance GROUP BY provenance"

pnpm run test          # 16/16 suites; app 52, admin 134
```

The draft is deliberately left in place at `awaiting_review` rather than deleted. Deleting
the evidence of a verification to tidy up is how a verification becomes a claim.

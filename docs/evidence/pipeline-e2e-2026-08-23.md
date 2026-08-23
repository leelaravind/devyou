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

---

## 7. The three findings, fixed — 23 August 2026

### Finding 1: environment data recognised, then dropped

**Root cause, two independent losses on the same path.**

`apps/jobs/src/structure.ts` mapped the model's answer onto a draft with
`constraints: []` **hard-coded**. `StructureResult.technologies[].versionLabel` was
declared in the schema, validated by Zod, and then never read — `toDraft` mapped only
`slugify(name)` into `technologySlugs` and discarded the version beside it.

Separately, that slug was matched against canonical slugs only. The model said `Node`;
`slugify` gives `node`; the taxonomy stores `nodejs`; the match failed and the
technology was dropped in silence, taking its version with it. `technology_aliases`
holds 171 rows for exactly this — `node` **is** an alias of `nodejs` in production — and
the structuring path was the one place that never consulted it.

Nothing downstream was at fault. The editor already renders, parses, adds and removes
constraints (`contribute.$draftId.edit.tsx`, `parseConstraints`); the publish gate
already refuses without them. The gate did its job and made a transit loss look like
the author's omission.

**Fix.** `technologyResolver` builds a name→slug map from slugs *and* unambiguously
resolving aliases; an alias pointing at more than one technology is omitted rather than
guessed (`wrangler` is both a slug and an alias of `cloudflare-workers`, and the slug
wins). Versioned technologies become `known_affected` constraints pinned to the reported
version — the author said it broke *here*, not that it breaks from here onwards, and
widening belongs on the review screen.

**The gate was not weakened.** Only a technology *with a version* produces a constraint.
A version-less row would satisfy `constraints.length > 0` while carrying no
applicability, turning `no_environment_constraints` into a formality. Asserted directly
by `does NOT invent a constraint for a technology with no version`.

### Finding 2: the model classified its own provenance

**Root cause.** `toDraft` wrote `provenance: result.problemTitle.provenance` — the
model's own label — and hard-coded `ai_extracted` for node fields. The label deciding
whether a human must look was assigned by the thing being checked. In production the
model declared all 22 fields `ai_extracted` and `unconfirmed_ai_fields` never fired.

**A worse hole found while fixing it:** `commandText` had **no provenance row at all**.
The tracked list was `title`, `body`, `expectedOutput`. A fabricated command required no
confirmation and reached the gate indistinguishable from one the author typed — and a
command is the one field a reader copies and executes. Two of the four commands in this
very draft contain invented placeholders.

**Fix.** `packages/domain/src/grounding.ts`. `groundedProvenance` downgrades any claim
of `user_supplied` or `ai_extracted` that is not present in the submission, after
normalisation for case, whitespace, smart quotes and dashes. It can only ever *reduce*
trust; there is no input that raises it.

**Scope, chosen from measurement rather than taste.** Grounding is applied to literals —
commands, expected output, version labels — and not to prose. Against this submission,
normalised containment held for **1 of 22** prose fields and token coverage ran 0.00 to
1.00 with faithful text at both ends: the terminal step "Resolved, or cause lies
elsewhere" scores 0.00 and is harmless scaffolding. Any threshold over prose would
demand confirmation on nearly every field of a legitimate draft, which is the
warning-fatigue defect of Finding 3 rebuilt somewhere new. Prose keeps the model's label
and stays fully visible on the review screen.

Verified against the stored production draft with the deployed code:

```
node 0  verbatim     -> ai_extracted                        (genuine)
node 1  unsupported  -> ai_inferred_requires_confirmation   (invented placeholder)
node 4  verbatim     -> ai_extracted                        (genuine)
node 5  unsupported  -> ai_inferred_requires_confirmation   (invented placeholder)
```

### Finding 3: AI could escalate a read-only command with no correction

**Root cause.** `effectiveSafety` returned `max(classifyCommand, declared)`. Right
direction for danger, but it left an unsupported escalation permanent: the model marked
`wrangler ... d1 execute my-db --remote --command "SELECT 1"` — a read — `destructive`.

**Fix.** `isProvablyReadOnly` in `packages/security`. It is deliberately **not**
`classifyCommand` inverted: that function returning `informational` means "no rule
matched", which is absence of evidence (`curl x | sh` scores `informational`). This one
returns `true` only for forms it positively recognises and `false` for everything it does
not understand, which is what makes the `true` safe to act on. `effectiveSafety` keeps
the upward rule untouched and lowers only on a proof, never below what the classifier
itself found.

`isReadOnlySql` strips both comment syntaxes, splits on `;`, requires every statement to
head with `select`/`explain`/`with`, and bans every write, schema, transaction and
`attach` keyword anywhere in the string. `PRAGMA` is refused outright — several pragmas
write, and telling those apart is a larger surface than the value of proving one safe.
`--file` is refused because the SQL is then unreadable, and an unreadable statement is an
unproven one. Shell composition (`; && || | < > $( \n`) defeats the proof before the
allow-list is consulted.

Verified against the stored production draft with the deployed code:

```
node 0  destructive   -> informational   the false positive, corrected
node 1  destructive   -> destructive     multi-line; composition defeats the proof
node 4  informational -> informational   unchanged
node 5  destructive   -> destructive     contains `<...>`, which is redirection syntax
```

One of three false positives corrected; the other two stay flagged because they contain
invented placeholder syntax that is *also* shell metacharacter. That is the conservative
answer and the right one — those two are the commands the author never wrote.

### Test evidence

| Suite | Before | After |
|---|---|---|
| `@devyou/domain` | 66 | **84** |
| `@devyou/security` | 82 | **97** |
| `@devyou/app` | 52 | **58** |
| `@devyou/jobs` | 0 | **10** |
| `@devyou/admin` | 134 | 134 (unchanged, still green) |

typecheck 19/19, lint clean, 16/16 suites. Secret placement unchanged. No production
corpus row was modified: playbooks 43, published revisions 44, evidence 110, drafts 1,
ai_tasks 1 — identical before and after deployment.

### Remaining limitation

**The persisted draft cannot be migrated.** Only the mapped `DraftDocument` is stored,
never the raw `StructureResult`, so `versionLabel` — dropped at map time — is
unrecoverable for `drf_01M0PK2YT8T597NK4ZW81YYCDD`. Findings 1 and 2 therefore cannot be
retro-applied to it without a fresh structuring call.

Finding 3 needs no reprocessing: `effectiveSafety` is recomputed at render and at the
gate, so the correction above is live for that draft now.

---

## 8. Regression test on newly structured data — 23 August 2026

The fixes in §7 were verified on *stored* output. This is the same submission put through
the deployed pipeline again, so the corrections are proved on data the fixed code
produced rather than on data it was applied to afterwards.

Identical input, deliberately. The only variable is the code.

**Draft** `drf_01M0QD3DH937P2KMJW116WFTRK` · **Task** `aij_01M0QD3DHZ54ZW0M83QC26AYXQ`
`anthropic:claude-opus-5`, prompt `2026-08-22.1`, **4,036 in / 3,175 out**, 35,285 ms,
`repair_attempted = 0`, **99,555 µUSD ($0.0996)**. Distinct `input_hash` from the first
run, so no cache and no duplicate billing.

### Finding 1 — environment reached the draft

| | First run | This run |
|---|---|---|
| `constraints` | **0** | **2** |
| `technologySlugs` | wrangler, cloudflare-d1 | wrangler, **nodejs**, cloudflare-d1 |

```
wrangler  4.125 → 4.125   known_affected
nodejs    22.22 → 22.22   known_affected
```

`nodejs` is the one that matters. The model said "Node"; `slugify` gives `node`; the
taxonomy stores `nodejs`; the alias resolved it and the version came with it. Previously
both were discarded in silence.

`pnpm 11` is still absent, and correctly so — `pnpm` is not in the taxonomy, and an
approximate match would file the playbook where nobody searches.

### Finding 2 — provenance is no longer uniform

| Provenance | First run | This run |
|---|---|---|
| `ai_extracted` | 22 | 20 |
| `user_supplied` | 0 | 2 |
| `ai_inferred_requires_confirmation` | **0** | **2** |

The two downgraded fields are `/nodes/1/expectedOutput` and `/nodes/4/expectedOutput` —
descriptions the model wrote ("Per the author: the command succeeds when…", "The absolute
filesystem path to wrangler's package.json…") which appear nowhere in the submission.

The two `user_supplied` rows are the constraint versions `4.125` and `22.22`. The model
claimed the strongest provenance available and **kept it, because the claim is true** —
both strings are in the text. That is the check working in the direction that matters
least dramatically and matters most: it does not punish honesty.

**`commandText` now carries provenance at all** — three rows where there were none. All
three ground verbatim in this run, so all three stay `ai_extracted`. The model happened
not to invent a placeholder command this time; §7 shows what happens when it does.

### Finding 3 — the escalation was corrected

The model was less aggressive this run — `state_changing` rather than `destructive` — and
still wrong about the same read:

```
node 0  model=state_changing  shown=informational   CORRECTED
node 1  model=state_changing  shown=informational   CORRECTED
node 4  model=informational   shown=informational
```

### The gate now blocks for the right reason

```
constraints present: 2
allowed: false
BLOCKER  unconfirmed_ai_fields
```

`no_environment_constraints` **no longer fires**. The draft is still refused — by
`unconfirmed_ai_fields`, because two values the model could not ground need a human. That
is the whole point of the exercise: publication is blocked by an actual unverified claim
rather than by information the pipeline threw away.

### Records created, and the corpus

| Table | Rows |
|---|---|
| `contribution_drafts` | 1 — `drf_01M0QD3DH937P2KMJW116WFTRK`, `awaiting_review` |
| `ai_tasks` | 1 — `aij_01M0QD3DHZ54ZW0M83QC26AYXQ`, `succeeded` |
| `draft_field_provenance` | 24 |

| | Baseline | After |
|---|---|---|
| playbooks | 43 | **43** |
| published revisions | 44 | **44** |
| evidence records | 110 | **110** |
| reproduction reports | 0 | **0** |
| diagnostic nodes | 352 | **352** |
| moderation cases | 0 | **0** |

Cumulative AI spend across both runs: **218,101 µUSD ($0.218)**, against a $2/day ceiling.
Nothing published. Nothing in the corpus touched.

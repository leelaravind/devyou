# DEV.ITISYOU — End-to-End Implementation Plan

**Target:** `dev.itisyou.app`  
**Status:** Implementation authority after research + Stitch review  
**Build engine:** Claude Code  
**Deployment direction:** Cloudflare-first  
**Core product thesis:** A public, cross-vendor, version-aware engineering knowledge system where troubleshooting knowledge is represented as Problems → Environments → Symptoms → Diagnostic Tests → Observations → Root Causes → Fixes → Evidence → Reproductions, and verification is explicit and attributable.

---

## 0. Implementation principles and non-negotiable invariants

1. **Verification is the product, not a cosmetic badge.** AI assistance, author assertion, independent reproduction, CI/machine evidence, matrix evidence, and maintainer attestation are distinct signals.
2. **Evidence is revision-bound.** A reproduction or evidence record always points to the exact immutable playbook revision it validated. Editing a playbook never transfers old evidence to the new revision automatically.
3. **Failed reproductions are evidence.** They are retained and surfaced by environment/version instead of being discarded as downvotes.
4. **No arbitrary user code execution in V1.** Code and commands are inert content. Automated hosted execution is explicitly out of V1.
5. **AI is assistive, never authoritative.** AI can structure, classify, suggest duplicates, summarize, and help triage. AI cannot mark root cause/fix/playbook as verified.
6. **Search-first, not feed-first.** The home page is a diagnostic intake surface, not a social stream.
7. **Public read access is frictionless.** No sign-in requirement for searching or reading public playbooks.
8. **Contribution starts low-friction.** A developer can report Worked / Partial / Failed quickly; full playbook authoring is optional and AI-assisted.
9. **Product isolation by default.** Dev gets its own production data, storage, secrets, search indexes, queues, auth/session namespace, and deployment resources. Integration with the ITISYOU Admin Console occurs through an explicit contract, never direct cross-product DB coupling.
10. **Stitch is the visual authority, not generated production code.** Rebuild its design system as typed reusable components; do not paste generated HTML wholesale into production.
11. **MVP tests confidence and reduced trial-and-error, not feature breadth.** Do not add jobs, ads, enterprise, arbitrary code runners, a full reputation economy, or a chatbot before the core hypothesis is measured.

---

# 1. What the design package currently contains

The current Stitch ZIP contains nine implemented visual references plus one design-system specification:

1. `landing_diagnostic_omnibox`
2. `search_results_triage`
3. `active_diagnostic_session`
4. `root_cause_resolution`
5. `environment_management`
6. `contribution_ai_review`
7. `dev_admin_console_overview`
8. `mobile_landing`
9. `mobile_diagnostic_session`
10. `technical_precision/DESIGN.md`

The generated design system establishes a dark-first technical visual language with Geist headings, Inter body text, JetBrains Mono for code/data, compact spacing, border/tonal depth, and typed colors for evidence/status/warning/destructive semantics.

## Design gaps that must be completed during implementation

The original design brief requested more screens than Stitch actually returned. Missing or incomplete visual states include:

- Contribution raw-ingestion screen
- Full playbook editor
- Publication review
- Micro-contribution / missing-test proposal
- Contributor profile
- Revision history / compare revisions
- Deprecated / needs-reverification states
- Compatibility/evidence drill-down as a standalone view
- Sign-in / account screens
- Reproduction receipt
- Admin review queue
- Admin knowledge/verification inspector
- Admin duplicate merge
- Admin taxonomy
- Admin abuse/safety
- Admin search quality detail
- Admin AI operations
- Admin audit/health detail
- Mobile search and mobile resolution/reproduction states

**Implementation decision:** do not block the whole build. Build these missing states from the supplied design tokens/components, but place a visual-acceptance gate before production so they can be compared with the established Stitch style. If desired, a second Stitch generation can later replace only these missing references without changing the architecture.

## Explicit design conflict to resolve consistently

`DESIGN.md` states mobile is “not recommended for deep troubleshooting” and describes read-only status behaviour, while the package also contains an interactive mobile diagnostic screen and the original design requirement called for useful mobile diagnostics.

**Implementation authority:** mobile remains interactive for the core Test → Result → Next Step flow, but complex full-tree visualization is simplified behind a “View diagnostic map” drawer/sheet. Desktop remains the primary deep-troubleshooting experience.

---

# 2. Target product scope

## V1 must support

- Public indexable playbook pages
- Exact-error and ordinary-language search
- Stack-trace/log/error paste input
- Technology/package/runtime/OS/version metadata
- Environment presets and per-session override
- Branching diagnostic tests
- Explicit root-cause and fix nodes
- Evidence records attached to exact revisions
- Worked / Partial / Failed reproduction reports
- Independent-confirmation counts
- Last-verified state
- Revision history
- Supersession/deprecation
- Contributor attribution
- AI-assisted contribution structuring
- Safety/moderation workflow
- Dev-specific admin module
- Search-quality instrumentation
- SEO and machine-readable public content

## Explicitly not in V1

- General AI debugging chatbot
- Arbitrary hosted execution of user code
- Live collaborative editing
- Full graph database
- Social feed/comments
- Global karma/leaderboards
- Job marketplace
- Display advertising
- Paid verification
- Enterprise/private knowledge product
- Public agent API beyond minimal future-proof route boundaries

---

# 3. Recommended repository architecture

Create Dev as a separate repository unless an existing ITISYOU network monorepo is already authoritative. Do not place it inside ATS/Space source trees.

Suggested structure:

```text
dev-itisyou/
├─ apps/
│  ├─ web/                     # Public site + authenticated contributor UI
│  ├─ admin/                   # Dev admin module / standalone fallback admin shell
│  └─ jobs/                    # Async indexing, AI structuring, moderation support
│
├─ packages/
│  ├─ ui/                      # Stitch-derived reusable design system
│  ├─ db/                      # Drizzle schema, migrations, queries
│  ├─ schemas/                 # Zod contracts shared between apps/jobs
│  ├─ domain/                  # Playbook/evidence/revision/verification rules
│  ├─ search/                  # FTS/query parsing/ranking abstractions
│  ├─ ai/                      # Provider abstraction + structured output schemas
│  ├─ auth/                    # Product-local identity/session abstraction
│  ├─ security/                # Sanitization, URL safety, rate limits, safety labels
│  ├─ admin-contract/          # Shared-console integration contract/adapter
│  ├─ observability/           # Structured logs, metrics/event helpers
│  └─ config/                  # Feature flags, taxonomies, environment configuration
│
├─ docs/
│  ├─ research/
│  ├─ design/
│  ├─ decisions/
│  ├─ implementation/
│  ├─ security/
│  ├─ runbooks/
│  └─ evidence/
│
├─ scripts/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  ├─ e2e/
│  ├─ security/
│  ├─ search-eval/
│  └─ fixtures/
│
├─ .github/workflows/
├─ wrangler/
├─ IMPLEMENTATION.md
├─ IMPLEMENTATION_STATUS.md
├─ CLAUDE.md
├─ LAUNCH-GATE.md
└─ README.md
```

Use a pnpm workspace/Turborepo-style structure if the current ITISYOU engineering conventions already use it; otherwise plain pnpm workspaces are sufficient.

---

# 4. Application/runtime architecture

## Recommended runtime

Use:

- TypeScript
- React
- React Router framework/SSR mode with Vite, deployed on Cloudflare Workers
- Tailwind CSS or equivalent token-driven utility layer
- Drizzle ORM
- Cloudflare D1 as canonical relational persistence
- Cloudflare R2 for evidence attachments/artifacts only
- Cloudflare Queues for async jobs
- Cloudflare Workflows only for genuinely durable multi-step operations
- Cloudflare KV for read-heavy config/cache snapshots, not canonical knowledge
- Cloudflare Turnstile for abuse-sensitive anonymous/public actions
- Cloudflare Access only around privileged internal/admin surfaces if compatible with the actual shared Admin Console
- Cloudflare Vectorize as an experimental/optional semantic retrieval layer after lexical baseline evaluation
- Cloudflare AI Gateway if external LLM calls are routed through it

## Worker separation

```text
Browser / Search crawler / AI crawler
              ↓
      dev.itisyou.app
      Public Web Worker
       ├─ SSR/public HTML
       ├─ search
       ├─ diagnostic sessions
       ├─ contributor UI
       └─ authenticated API
              ↓
            D1
              ↓
         Queue events
              ↓
      Dev Jobs Worker
       ├─ AI structuring
       ├─ duplicate candidates
       ├─ indexing
       ├─ staleness jobs
       └─ moderation assistance

ITISYOU Admin / operator
              ↓
      Dev Admin boundary
       ├─ review/moderation
       ├─ taxonomy
       ├─ evidence disputes
       ├─ search quality
       └─ audit/health
```

Do not let the public Worker possess destructive admin permissions or reusable secrets it does not need.

---

# 5. Domain model

The application should expose a graph-like domain while keeping canonical persistence relational.

## Core entities

### `users`
Product-local account identity/reference.

Minimum fields:
- `id`
- `created_at`
- `status`
- `network_actor_id` nullable for future shared-identity linkage

### `profiles`
- `user_id`
- `display_name`
- `handle`
- `avatar_url` nullable
- `github_login` nullable
- `bio` nullable and short
- `created_at`

### `technologies`
Canonical technology/package/platform vocabulary.

- `id`
- `slug`
- `name`
- `type` (`language`, `runtime`, `framework`, `database`, `cloud`, `os`, `tool`, `library`, etc.)
- `official_url` nullable
- `status`

### `technology_aliases`
Maps common/error/log names to canonical technology.

### `versions`
- `id`
- `technology_id`
- `version_label`
- `semver_normalized` nullable
- `released_at` nullable
- `eol_at` nullable
- `status`

### `problems`
Stable conceptual problem identity.

- `id`
- `slug`
- `canonical_title`
- `summary`
- `status`
- `created_by`
- `created_at`

### `problem_signatures`
Exact/normalized error fingerprints.

- error code
- normalized message
- signature hash
- language/runtime hints

### `symptoms`
Reusable but initially simple problem symptoms.

### `playbooks`
Stable playbook identity.

- `id`
- `problem_id`
- `slug`
- `current_revision_id`
- `status`
- `visibility`
- `created_by`
- `created_at`

### `playbook_revisions`
Immutable published snapshots.

- `id`
- `playbook_id`
- `revision_number`
- `title`
- `summary`
- `change_summary`
- `status`
- `created_by`
- `created_at`
- `published_at`
- `supersedes_revision_id` nullable

After publication, content-bearing fields are immutable. Corrections create a new revision.

### `diagnostic_nodes`
Revision-scoped nodes.

Types:
- `start`
- `test`
- `observation`
- `root_cause`
- `fix`
- `verification`
- `terminal`

Fields:
- `id`
- `revision_id`
- `node_type`
- `title`
- `body`
- `command_text` nullable
- `expected_output` nullable
- `safety_level`
- `display_order`

### `diagnostic_edges`
- `id`
- `revision_id`
- `from_node_id`
- `to_node_id`
- `condition_type`
- `condition_label`
- `priority`

Supported result labels in V1:
- Passed
- Failed
- Different output
- Unknown
- Skip

### `revision_environment_constraints`
Defines applicability.

Link a revision to:
- technology/version/range
- OS
- architecture when needed
- provider/service when needed

Do not attempt to normalize every possible environment variable in V1.

### `source_references`
Official docs, issue/PR, changelog, advisory, blog, etc.

- `id`
- `url`
- `title`
- `source_type`
- `publisher`
- `retrieved_at`

### `evidence_records`
Append-only evidence attached to exact revision/node/claim.

Types:
- contributor_documentation
- independent_confirmation
- reproduction
- ci_execution
- matrix_execution
- maintainer_attestation
- official_reference
- failure_observation

Fields include:
- `revision_id`
- `node_id` nullable
- `evidence_type`
- `actor_id` nullable
- `environment_snapshot_id` nullable
- `source_reference_id` nullable
- `result`
- `created_at`
- `metadata_json`

### `environment_snapshots`
Immutable snapshot of the environment used for a specific reproduction/session.

Do not reference a mutable user preset directly from evidence.

### `environment_snapshot_components`
Technology/version facts for the snapshot.

### `environment_presets`
Mutable convenience presets owned by a user.

### `reproduction_reports`
Append-only user reports.

- `id`
- `revision_id`
- `actor_id`
- `environment_snapshot_id`
- `outcome` (`worked`, `partial`, `failed`)
- `notes` nullable
- `created_at`
- abuse/review metadata

### `contribution_drafts`
Mutable private workspace before publication.

- raw text
- parsed structure
- AI provenance
- author confirmations
- draft status

### `change_proposals`
For micro-contributions against an existing revision/node.

### `moderation_cases`
Safety/abuse/workflow state.

### `official_identity_claims`
Maintainer/company verification workflow.

### `admin_audit_events`
Append-only privileged-operation record.

### `search_events`
Privacy-minimized search quality telemetry.

Track only what is necessary for relevance/zero-result analysis; define retention before launch.

---

# 6. Verification model

Do not store a single authoritative `verified=true` field.

## Derived verification dimensions

For each playbook revision derive independent facts:

- Documented
- Independent confirmations count
- Successful reproduction count
- Failed reproduction count
- Unique environment count
- CI executions and recency
- Matrix coverage
- Maintainer/vendor attestation
- Official-source support
- Last successful verification
- Last failed verification
- Staleness state

## User-facing confidence

Use a derived coarse band rather than fake precision:

- **Unverified**
- **Limited evidence**
- **Moderate evidence**
- **Strong evidence**
- **Needs reverification**
- **Deprecated / superseded**

Every band must be explainable via `Why this confidence?`.

Never show a percentage unless sample-size rules are satisfied and the underlying environment segmentation is visible.

## Minimal positive signal

A recommended default threshold for a positive community-verification signal:

- author-tested/documented state, plus
- at least one independent successful reproduction,
- bound to a declared environment/version,
- with no unresolved critical safety dispute.

This is not “truth”; it is a stronger evidence state.

## Conflict handling

When reports disagree:

- preserve both
- segment by environment/version
- detect likely explanatory dimensions
- never average disagreement into a generic vote score
- flag for review when failures cluster unexpectedly

---

# 7. Search and retrieval architecture

## Stage 1: deterministic lexical baseline

Build search first with D1 FTS5 and structured filters.

Index:
- problem title
- aliases
- exact errors
- normalized error signatures
- summaries
- technology names
- version labels
- symptoms
- node titles/body

Query preprocessing:

1. Preserve exact error codes.
2. Strip volatile timestamps, UUIDs, request IDs, absolute local paths where safe.
3. Extract common stack frames/package names.
4. Extract versions/OS/runtime hints deterministically.
5. Generate normalized error fingerprint.
6. Search exact signatures first.
7. Search FTS next.
8. Apply environment/version filters and ranking boosts.

## Stage 2: semantic recall experiment

Add Vectorize only behind a feature flag after the lexical benchmark exists.

Use embeddings for:
- vague natural-language descriptions
- duplicate candidate discovery
- related playbooks

Do not use vector similarity to override exact-error matches.

## Search benchmark

Create a fixed evaluation dataset with:
- exact exceptions
- partial stack traces
- logs
- code fragments
- version-rich queries
- natural-language descriptions

Measure:
- MRR / top-1/top-3 hit rate
- exact-match success
- environment-match success
- zero-result rate
- reformulation rate

No search architecture is considered accepted without this benchmark.

---

# 8. Diagnostic session engine

A diagnostic session stores only session state; it does not mutate the playbook.

## Session state

- selected playbook revision
- active node
- visited nodes
- chosen branch results
- temporary environment snapshot
- timestamps
- completion/root-cause state

Anonymous reading should work without persistent server-side identity. Use short-lived/session-scoped state where possible. Authenticated users can opt to save progress.

## Engine invariants

- Only edges belonging to the same immutable revision may be traversed.
- A branch result is validated against allowed edge outcomes.
- Backtracking invalidates all downstream session outcomes from the changed node.
- Environment-incompatible nodes are de-emphasized but not deleted from the underlying graph.
- Reaching a root cause does not create evidence.
- A reproduction record is created only after the user submits a result against the specific revision/environment.

---

# 9. Public page implementation mapped to Stitch

## `/`
Landing/omnibox.

Build from `landing_diagnostic_omnibox` and `mobile_landing`.

Must include:
- multiline search intake
- example diagnostic tree
- recently verified seeded playbooks
- concise differentiation
- public crawlable links

## `/search`
Build from `search_results_triage`.

Query params should support stable/shareable filtering:
- `q`
- technology
- version
- OS/environment facets
- evidence state

## `/p/:playbookSlug`
Canonical public playbook route.

Default page should render server-visible summary, applicability, evidence summary, node overview, and full textual fallback for crawlers/accessibility.

Interactive client session can enhance this page without hiding core knowledge from HTML.

## `/p/:playbookSlug/diagnose`
Build from `active_diagnostic_session` / `mobile_diagnostic_session`.

This is the stateful interactive troubleshooting view.

## `/p/:playbookSlug/evidence`
Compatibility matrix + evidence detail.

## `/p/:playbookSlug/history`
Revision history and comparison.

## `/p/:playbookSlug/r/:revision`
Stable historical revision URL.

## `/environment`
Build from `environment_management`.

## `/contribute`
Raw contribution intake.

## `/contribute/:draftId/review`
Build from `contribution_ai_review`.

## `/contribute/:draftId/edit`
Visual playbook editor.

## `/contribute/:draftId/publish`
Publication review.

## `/profile/:handle`
Evidence-focused contributor profile.

## Authentication routes
Keep implementation-neutral in UI but provide:
- sign in
- callback
- sign out
- session management

---

# 10. Contribution pipeline

## Step A — Raw capture

Accept:
- rough notes
- terminal history
- stack trace/log
- Markdown
- GitHub issue URL as a future/feature-flagged importer

Do not demand normalized fields up front.

## Step B — Safety preprocessing

Before any LLM receives content:
- length limits
- Unicode control/confusable checks
- URL extraction
- obvious secret-pattern warning/redaction
- content/instruction boundary wrapping

Do not give the AI moderation/admin tools.

## Step C — AI structuring

The model receives a strict schema and may extract/propose:
- problem
- environment
- symptoms
- tests
- expected results
- branches
- root cause
- fix
- references

Every field carries provenance:
- `user_supplied`
- `ai_extracted`
- `ai_inferred_requires_confirmation`

AI cannot silently invent required facts.

## Step D — Human review

Use the Stitch `Structure Review` screen.

The author must explicitly confirm or correct AI-inferred fields.

## Step E — Draft editor

Validate graph constraints:
- one start node
- reachable terminal/root-cause route
- no illegal cross-revision edges
- branch labels defined
- destructive commands classified
- required environment applicability provided

## Step F — Publication safety gate

Before public publication:
- sanitizer pass
- link policy
- dangerous-command scan
- dependency/package recommendation checks where practical
- AI-assisted moderation suggestion
- deterministic rule checks

New content publishes as **Documented / Unverified**, unless stronger evidence already exists and passes review.

---

# 11. AI architecture

Create a provider abstraction even if only one provider is configured initially.

## Allowed V1 AI tasks

- contribution structuring
- duplicate candidate suggestions
- technology/tag classification
- query interpretation fallback
- concise cached summaries
- staleness text comparison assistance
- moderation assistance

## Forbidden authority

AI cannot directly:
- change verification state
- approve maintainer identity
- delete content
- suspend accounts
- publish a draft without required human confirmation
- execute user code
- run secret-bearing admin tools based on submission text

## Structured output

Every AI task uses:
- versioned prompt
- Zod/JSON schema
- token/input limits
- deterministic parser validation
- at most one bounded repair attempt for malformed structure
- stored model/provider/prompt version/cost/latency/result metadata

## Cost controls

- per-task model routing
- daily spend ceiling
- per-user/contributor limits
- queue-based async processing where possible
- cache by normalized input/content hash
- no AI call for ordinary playbook reads
- no AI call required for exact error search

---

# 12. Authentication and contributor identity

Public browsing/search requires no account.

For attributable contributions/reproductions, use product-local authentication unless an already-implemented shared ITISYOU identity contract is verified during Phase 0.

Preferred UX:
- GitHub sign-in as the lowest-friction developer identity
- optional additional account method if required by network policy

Do not couple GitHub identity to trust automatically. A GitHub-linked account proves control of that account, not technical correctness.

## Roles

Product roles should be capability-based, not merely decorative:

- `user`
- `contributor`
- `reviewer`
- `maintainer_verified` (claim state, not admin power)
- `support_admin`
- `dev_admin`
- `super_admin` only if required by the actual shared console

Role/capability decisions must be server-side.

---

# 13. ITISYOU Admin Console integration

The historical conversation does not establish a sufficiently authoritative technical contract for the shared console. Therefore integration begins with a **source audit**, not assumptions.

## Phase 0 Admin Console audit

Claude Code must locate/read the actual shared Admin Console source and document:
- repository/path
- admin domain
- auth/session mechanism
- role/capability model
- product switcher/registry
- navigation extension points
- API/service-to-service auth
- audit mechanism
- shared UI package
- deployment model

Produce `docs/implementation/ADMIN-CONSOLE-INTEGRATION-AUDIT.md` before modifying the console.

## Integration rules

1. Do not give central Admin direct SQL access to Dev D1 unless that is already the established, reviewed network architecture.
2. Prefer a narrow Dev Admin API/service contract.
3. Reuse the existing Admin shell/navigation if a real extension mechanism exists.
4. If no safe shared integration exists, deploy the Dev admin module separately but link it from the network Admin Console until federation is implemented.
5. Preserve separate Dev audit records and optionally mirror high-level events centrally.

## Dev admin capabilities

From the Stitch admin overview and research:

- actionable overview
- review queue
- playbook/revision review
- evidence/reproduction disputes
- safety reports
- duplicate merge/relationship review
- staleness/deprecation
- technology/version taxonomy
- contributor/account lookup
- official maintainer/company claim review
- search zero-result/relevance health
- AI job/cost/failure inspection
- feature flags/config
- abuse/security controls
- audit log
- health/background jobs

All destructive actions require reason codes and audit events. High-risk actions should support step-up authentication if the shared console already provides it.

---

# 14. Moderation and trust/safety

## Content rendering

- Markdown subset only or structured rich-text renderer
- no raw user HTML
- strict sanitizer
- CSP
- safe external-link attributes
- no inline script/event attributes
- code blocks always inert

## Dangerous command classification

Classify commands as:
- informational/read-only
- state-changing
- destructive
- credential/network-sensitive

The UI must reflect the class before the Copy action.

For destructive/sensitive commands:
- explicit warning
- explain effect
- optionally require acknowledgment before copy
- never auto-run

## Untrusted links/packages

- parse and normalize URLs
- flag suspicious domains
- apply UGC/nofollow-style semantics as appropriate
- warn for executable/download links when necessary
- never treat a package name as safe merely because the submission claims it is official

## Abuse controls

- Turnstile on abuse-sensitive anonymous actions
- edge/application rate limits
- account-age and behaviour weighting for reproduction evidence
- anomaly detection for clustered fake reproductions
- moderation queue for suspicious bursts
- link limits for low-trust contributors
- no reputation benefit from unverified bulk generation

---

# 15. Staleness and lifecycle model

Knowledge is never silently overwritten.

## Triggers for `needs_reverification`

- configured time since last successful verification
- new major/minor technology release
- changed dependency version applicability
- cluster of new failed reproductions
- maintainer report
- linked security advisory/change notice

V1 may trigger most of these deterministically from stored version metadata and admin actions. AI may assist comparing release notes later but cannot independently deprecate content.

## States

Playbook/revision:
- draft
- under_review
- published
- needs_reverification
- superseded
- deprecated
- quarantined

Problem:
- active
- merged
- resolved_upstream
- archived

---

# 16. SEO and machine-readable knowledge

Core public troubleshooting knowledge must be present in server-rendered HTML.

For each canonical playbook:
- stable canonical URL
- descriptive symptom-first title
- technology/version/environment metadata
- authorship
- published/revised date
- meaningful `lastmod`
- normal links to technologies/related playbooks
- breadcrumbs
- textual representation of the diagnostic path

Do not misuse QAPage structured data unless the page actually satisfies Q&A semantics.

Generate:
- `robots.txt`
- XML sitemaps split by playbooks/technologies if needed
- canonical tags
- Open Graph metadata
- optional `llms.txt`/machine-oriented index as a convenience, never as the only machine-access route

Design URLs so a future read API can expose the same stable IDs/revisions.

---

# 17. Observability and analytics

The product hypothesis is not page views.

## Core product metrics

Track privacy-minimized events needed to calculate:
- search success rate
- zero-result rate
- query reformulation/abandonment
- playbook open → diagnostic start
- successful resolution rate
- median time to resolution
- diagnostic attempts before resolution
- worked/partial/failed by version/environment
- independent verification rate
- author completion/abandonment rate
- staleness/failure rate
- return troubleshooting usage

Do not collect raw stack traces/logs into general analytics by default.

## Operational telemetry

Structured logs:
- request ID
- route
- status
- latency
- actor ID only where needed
- job ID
- AI task/provider/model/cost
- search timing/result count

Never log:
- secrets
- tokens
- private contribution raw text unnecessarily
- credentials/API keys found in logs/snippets

---

# 18. Accessibility implementation

Treat accessibility as a product requirement, not polish.

- keyboard access to all diagnostic actions
- visible focus
- WCAG AA contrast
- state conveyed by icon/text, not color alone
- semantic headings
- forms with labels/errors
- live regions for branch changes/result recording
- reduced motion
- code blocks keyboard-scrollable
- accessible alternative to graphical tree

The diagnostic tree may use ARIA tree/treegrid semantics only if interaction behaviour fully matches the ARIA pattern. If not, use simpler semantic lists/steps rather than incorrect ARIA.

---

# 19. Testing strategy

## Unit tests

Domain invariants:
- immutable revisions
- edge validity
- graph reachability
- evidence binding
- reproduction append-only logic
- confidence derivation
- staleness state
- environment matching
- backtracking invalidation

## Database tests

- migrations up/down strategy where supported
- foreign keys
- unique constraints
- append-only enforcement at application/query layer
- merge/supersession behaviour

## Search evaluation

Automated fixed corpus benchmark in CI.

## Integration tests

- publish revision
- create evidence
- submit reproduction
- revise playbook and prove evidence does not transfer
- deprecate/supersede
- search exact error
- environment mismatch
- AI structuring validation

## Security tests

- stored XSS payloads
- Markdown/URL injection
- Unicode bidi/zero-width/confusable content
- prompt injection strings inside contributions
- dangerous command labeling
- fake reproduction abuse/rate paths
- authz/IDOR
- CSRF/state-changing endpoints
- admin capability tests
- secret/log redaction

## E2E / Playwright

Desktop:
- landing → search → playbook → diagnostic branch → root cause → reproduction
- contribution raw input → AI review → edit → publish
- environment preset → search filtering
- admin review path

Mobile:
- landing
- search
- diagnostic test/result
- reproduction

## Visual regression

Use Stitch screenshots as baseline references for core pages. Compare at agreed viewport sizes.

---

# 20. Seed corpus and launch content

Cold-start is a first-order product risk, so do not launch with an empty taxonomy.

Start narrow and deep.

Recommended initial domains:
- Cloudflare/edge runtime problems
- PostgreSQL/database concurrency/configuration
- Docker/Kubernetes deployment/networking

Target approximately **30–50 high-quality seed playbooks** before public launch, with each having:
- explicit environment/version applicability
- at least one diagnostic branch
- cited primary/official source where available
- safety review
- a clear last-verified state

Do not fabricate community reproduction counts. Seed items can honestly start as Documented / Author tested / Official-reference-supported without pretending independent reproduction exists.

---

# 21. Deployment environments

Create distinct:

- local/dev
- staging
- production

## Cloudflare resources should be environment-specific

Example logical names:

```text
dev-itisyou-web-staging
dev-itisyou-admin-staging
dev-itisyou-jobs-staging
dev-itisyou-db-staging
dev-itisyou-evidence-staging
dev-itisyou-queue-staging

dev-itisyou-web-production
dev-itisyou-admin-production
dev-itisyou-jobs-production
dev-itisyou-db-production
dev-itisyou-evidence-production
dev-itisyou-queue-production
```

Use actual naming conventions from the user's Cloudflare account after inventory; do not overwrite existing resources based on guessed names.

## Secrets

Keep provider/auth/service secrets out of Git.

Local development:
- `.dev.vars` / local secret mechanism, gitignored

Production/staging:
- Cloudflare Worker secrets

Never expose plaintext keys through admin read APIs.

---

# 22. CI/CD

On pull request:
- install locked dependencies
- typecheck
- lint
- unit tests
- security/static tests
- search benchmark regression
- build all apps

On merge to main:
- deploy staging only
- apply expand-safe migrations first
- deploy jobs
- deploy admin
- deploy web
- run health checks
- run Playwright deployed smoke/E2E
- produce deployment evidence

Production deployment:
- explicit release workflow / owner gate
- migration check
- backup/checkpoint
- jobs → admin → web
- health
- smoke
- core diagnostic E2E
- rollback criteria

A successful deploy command is never enough to mark a release verified.

---

# 23. Documentation and decision discipline

Maintain continuously:

### `IMPLEMENTATION.md`
This plan, updated only through explicit architectural decisions.

### `IMPLEMENTATION_STATUS.md`
Per-phase current state:
- NOT STARTED
- IN PROGRESS
- IMPLEMENTED
- TESTED
- DEPLOYED STAGING
- VERIFIED STAGING
- PRODUCTION READY

### ADRs
Required early ADRs:

1. Product isolation and Admin Console integration boundary
2. React Router SSR/Workers runtime choice
3. D1 relational canonical store; no graph DB in V1
4. Immutable revision + append-only evidence model
5. Typed verification model; no binary verified field
6. No arbitrary code execution in V1
7. Search baseline: exact/FTS first; semantic experimental
8. AI assistive-only authority boundary
9. Authentication strategy after network-console audit
10. UGC rendering/sanitization policy
11. Evidence/reproduction anti-gaming policy
12. Public licensing/contribution terms decision before opening unrestricted UGC

### Evidence logs
Every phase gate should retain commands/test summaries/screenshots where useful.

---

# 24. Implementation phases and gates

## Phase 0 — Repository + existing-network audit

Tasks:
- create/open Dev repository
- inventory Cloudflare account/resources without modifying unrelated products
- locate/read shared ITISYOU Admin Console source
- document actual integration mechanism
- copy research docs and Stitch ZIP/screens into `docs/research` / `docs/design`
- establish CLAUDE.md boundaries
- create ADRs 1–3 draft

Gate:
- no Dev code written until existing network/admin boundaries are documented

Deliverable:
`docs/implementation/PHASE-0-NETWORK-BASELINE.md`

---

## Phase 1 — Monorepo + design system

Tasks:
- initialize workspace
- web/admin/jobs apps
- shared packages
- build token system from `technical_precision/DESIGN.md`
- implement Button/Input/Omnibox/Tag/CodeBlock/Status/Evidence/Sidebar/DiagnosticNode primitives
- dark mode first + functional light theme
- desktop/mobile shell

Gate:
- visual review against Stitch landing/search/diagnostic/admin screenshots
- accessibility baseline passes

---

## Phase 2 — Database and domain invariants

Tasks:
- Drizzle schema
- migrations
- seed technology taxonomy
- playbook/revision/node/edge model
- environment snapshots
- evidence/reproduction model
- moderation/audit skeleton
- domain unit tests

Critical gate tests:
- published revision cannot mutate in place
- evidence remains tied to old revision after edit
- failed reproductions remain queryable
- branch graph validation rejects invalid edges

---

## Phase 3 — Public landing + search baseline

Tasks:
- Stitch landing implementation
- SSR public layout
- FTS schema/index
- deterministic query normalization
- search result ranking/filtering
- triage UI
- no-result states
- initial search-event instrumentation

Gate:
- fixed search benchmark defined
- exact-error cases work reliably
- core pages server-render useful HTML

---

## Phase 4 — Playbook reader + diagnostic engine

Tasks:
- canonical playbook page
- split-view active diagnostic
- mobile simplified diagnostic
- state engine
- backtracking
- environment compatibility
- warnings/destructive states
- root-cause resolution screen
- reproduction prompt

Gate:
- desktop and mobile E2E from search to resolution
- accessibility keyboard path complete

---

## Phase 5 — Environment + evidence UX

Tasks:
- environment presets
- session overrides
- immutable environment snapshots
- compatibility/evidence matrix
- contradiction display
- `Why this confidence?`
- last verified

Gate:
- same playbook can show different evidence by version/OS without collapsing to one score

---

## Phase 6 — Authentication + contributor identity

Tasks:
- implement audited auth choice from Phase 0
- public reading remains anonymous
- authenticated contribution/reproduction identity
- profile basics
- session security
- account status and server-side capabilities

Gate:
- authz/IDOR tests
- no trust auto-granted merely from GitHub sign-in

---

## Phase 7 — Contribution pipeline + AI structuring

Tasks:
- raw contribution intake
- AI jobs queue
- strict output schema
- Structure Review from Stitch
- playbook editor
- publication review
- AI provenance
- draft save/resume

Gate:
- malicious prompt text remains data and cannot invoke tools/actions
- AI-inferred facts require confirmation
- malformed model output fails safely
- AI cannot create verification evidence

---

## Phase 8 — Reproduction and micro-contribution system

Tasks:
- Worked / Partial / Failed
- 10–30 second flow target
- prefilled environment
- reproduction receipt
- missing-test proposal
- correction proposal
- stale/safety report
- evidence aggregation

Gate:
- reproduction events append-only and revision-bound
- basic Sybil/rate controls in place

---

## Phase 9 — Revisioning, deprecation and staleness

Tasks:
- revision history
- compare revisions
- supersede/deprecate
- needs-reverification rules
- preserve historical URLs
- admin staleness queue

Gate:
- old evidence never visually validates changed text automatically

---

## Phase 10 — Dev Admin module

Tasks:
- integrate into existing network console according to Phase 0 findings
- Dev overview from Stitch
- review queue
- knowledge inspector
- evidence disputes
- duplicate handling
- taxonomy
- contributor/official claims
- abuse/safety
- search quality
- AI operations
- audit
- health

Gate:
- capability matrix tests
- every destructive action has reason + audit event
- no direct wallet/ATS/Space/News/Tools cross-product access

---

## Phase 11 — Security hardening

Tasks:
- full UGC sanitizer review
- CSP/security headers
- URL/link safety
- Unicode/confusable/bidi checks
- stored XSS corpus
- prompt-injection corpus
- rate/Turnstile coverage
- fake reproduction abuse tests
- session/authz/CSRF/IDOR testing
- dependency/supply-chain checks
- log/secret redaction

Gate:
- no unresolved critical/high issue for public launch

---

## Phase 12 — SEO, accessibility, performance and search quality

Tasks:
- metadata/sitemaps/canonicals
- public HTML audit
- Lighthouse/performance budget
- keyboard/screen-reader test
- reduced motion
- search relevance benchmark
- mobile viewport/device checks

Gate:
- search benchmark meets agreed target
- no core page depends on client JS for crawlable knowledge

---

## Phase 13 — Seed corpus + closed validation

Tasks:
- add 30–50 curated playbooks
- recruit small test group
- run structured-vs-unstructured experiment
- version-awareness experiment
- verification-signal experiment
- branch-vs-direct-fixes experiment

Measure:
- resolution rate
- time to resolution
- attempts
- confidence
- search success
- contribution completion
- independent verification rate

Gate:
- do not launch broadly if users consistently skip diagnostics, verification does not predict success, or search cannot reliably find relevant playbooks

---

## Phase 14 — Staging freeze + launch gate

Produce:
- `LAUNCH-GATE.md`
- `DEPLOYMENT-REPORT.md`
- security summary
- accessibility summary
- search benchmark
- data/retention summary
- admin capability matrix
- known limitations

Launch only after all P0/P1 issues are closed or explicitly owner-accepted.

---

# 25. Acceptance criteria for the core hypothesis

The product is successful enough to continue only if real users demonstrate that structured evidence provides value.

Provisional validation targets from research should be treated as experiments, not guaranteed industry benchmarks:

- majority preference for structured evidence-backed presentation on matched tasks
- measurable reduction in troubleshooting time or attempted fixes on genuinely branching problems
- materially higher confidence for evidence-backed fixes without increased unsafe execution
- high search success on the curated difficult query benchmark
- most structured submissions completable without moderator reconstruction
- matched-environment verification predicts later successful outcomes better than generic popularity

If developers achieve equal or better speed/confidence by simply asking their existing coding agent, or if contribution/verification maintenance is disproportionately expensive, pause expansion and reassess the product thesis.

---

# 26. V1 → later evolution boundaries

Only after the core hypothesis is validated consider:

### V1.1 / early growth
- Vectorize/hybrid semantic search if benchmark proves value
- GitHub issue import
- official maintainer/company flows
- richer compatibility matrices
- notifications for re-verification

### V2
- controlled CI-backed reproductions
- API/read endpoint for IDEs/agents
- richer staleness automation
- team/private playbooks

### Later / research-heavy
- isolated hosted reproduction sandbox
- machine-executable diagnostic steps
- cross-project dependency reasoning
- advanced evidence graph/ranking

Do not implement these early merely because the schema can support them.

---

# 27. Claude Code execution protocol

Claude Code should execute one phase at a time.

For every phase:

1. Read `IMPLEMENTATION.md`, `IMPLEMENTATION_STATUS.md`, research, relevant Stitch assets, and current ADRs.
2. Inspect existing code before changing it.
3. State the exact phase scope and protected/off-limits areas.
4. Implement only that phase.
5. Run the required test suite.
6. Inspect diffs.
7. Perform deployed staging acceptance where the phase requires it.
8. Update documentation honestly: distinguish IMPLEMENTED from TESTED and DEPLOYED/VERIFIED.
9. Commit/push only a green checkpoint.
10. Stop at the phase gate and report evidence.

Claude must not:
- rewrite research conclusions to fit implementation convenience
- silently change the verification semantics
- make AI authoritative
- add a graph DB prematurely
- enable arbitrary code execution
- couple Dev to ATS/Space/Tools/News databases
- copy Stitch HTML wholesale as production architecture
- mark a phase verified because a build succeeded

---

# 28. Final build definition

The V1 is complete when a real developer can:

```text
Open dev.itisyou.app
        ↓
Paste an error / stack trace / describe a problem
        ↓
Receive relevant environment-aware playbooks
        ↓
Open a playbook and see why it applies
        ↓
Run one diagnostic test at a time
        ↓
Report the observed result
        ↓
Follow the correct branch
        ↓
Reach a root cause
        ↓
Apply and verify the fix
        ↓
Report Worked / Partial / Failed
        ↓
Create revision-bound evidence for future developers
```

And a contributor can:

```text
Paste rough troubleshooting notes
        ↓
AI structures, but does not invent truth
        ↓
Contributor reviews/corrects
        ↓
Playbook is published as documented/unverified
        ↓
Independent developers reproduce it
        ↓
Evidence accumulates by environment/version
        ↓
Later revisions preserve the old evidence history
```

And the ITISYOU operator can:

```text
Open ITISYOU Admin → Dev
        ↓
Review unsafe/new/stale/disputed knowledge
        ↓
Inspect evidence and environment-specific contradictions
        ↓
Moderate with capability checks + reason codes
        ↓
Preserve immutable audit history
        ↓
Monitor search quality and platform health
```

That is the end-to-end V1 target. Everything else is secondary until this loop is proven.

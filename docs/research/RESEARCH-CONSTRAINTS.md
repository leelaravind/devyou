# What the research binds — traceable constraints

**Compiled:** 22 August 2026, Phase 0
**Sources:** the four documents in this directory, all dated 21 August 2026.

Research explains *why*; it does not override `IMPLEMENTATION.md`. This file exists so a
later phase can check a design against what the research actually said, rather than
against a memory of it. Where research and plan diverge, the divergence is named.

| Source | Short name used below |
|---|---|
| `claude.pdf` — *Deep Product Architecture and Verified Developer Knowledge Research* | **ARCH** |
| `DEV.ITISYOU — Current Market, Competitive Landscape and Technical Feasibility Research.pdf` | **MARKET** |
| `Developer Playbook UX Research.pdf` | **UX** |
| `03-GROK-DEV-COMMUNITY-ADOPTION-RESEARCH.md` | **ADOPTION** |

All four state they are research, not implementation plans. ARCH says explicitly
*"Do not select a database now"* — so the D1 decision comes from the plan and the account,
not from research, and must not be attributed to it.

---

## 1. Binding constraints — these change the build

### Verification and evidence

| # | Constraint | Source | Where it lands |
|---|---|---|---|
| R-1 | Evidence must be bound to **an immutable snapshot of the exact procedure it verified**. Editing a playbook attaches old reproductions to the prior revision. ARCH names this "the single most important architectural rule" and the Stack Overflow failure mode it prevents — an edited answer whose upvotes no longer reflect its text | ARCH | Phase 2 schema; ADR-0005 |
| R-2 | **No single "Verified" badge.** A multi-layer ladder, ascending: AI-structured → automated lint → sandbox execution → author-tested → independent reproduction → multi-environment → official-source-supported → maintainer-confirmed → continuously tested. AI-structured **never counts as verification** | ARCH ("AVOID" list), MARKET | Phase 2; ADR-0006 |
| R-3 | Minimum bar for *any* positive signal: **author-tested + at least one independent reproduction on a stated version**. Author-only claims are visibly marked unverified | ARCH | Domain layer, Phase 2 |
| R-4 | Confidence is a **discrete band, never a bare percentage**. Always show raw counts ("3 of 4 reproductions passed on Node 20"). **Suppress or caveat percentages below n < 5** | ARCH | Phase 5 UI + domain |
| R-5 | Confidence is scoped **per version/environment tuple**, never global. Evidence on v18 says nothing certain about v22 | ARCH | Phase 5 |
| R-6 | **Failed reproductions are first-class evidence.** Stored, shown, and they *lower* confidence. Conflicting reproductions are shown as a distribution — never averaged, never deleting the minority report | ARCH, plan §6 | Phase 5, Phase 8 |
| R-7 | `Reproduced ≠ Replicated` (ACM artifact-badge semantics: reproduced = independent team, author's artifacts; replicated = independent team, own artifacts). Evidence types must not blur these | ARCH | Phase 2 evidence taxonomy |
| R-8 | Reproducibility **decays**. A historical successful run is evidence for a dated environment, not a perpetual guarantee. "Last verified at / tested versions / known failures" is more meaningful than an evergreen badge | MARKET | Phase 9 staleness |
| R-9 | Reputation derives from **successful independent reproductions, not votes**, weighted by reproducer independence (account age, IP/ASN, environment fingerprint), with coordinated-cluster detection | ARCH | Phase 8; ADR-0012 |

### AI boundaries

| # | Constraint | Source | Where it lands |
|---|---|---|---|
| R-10 | Two AI tasks are **prohibited**, not merely discouraged: deciding a fix "works"/marking verified, and generating reproduction results. Enforce **architecturally** — verification rows are writable only by authenticated reproduction events or deterministic CI, never by an AI code path | ARCH, MARKET | Phase 7; ADR-0010 |
| R-11 | AI may flag staleness as a *signal only*. "AI flags; evidence decides" | ARCH | Phase 9 |
| R-12 | Every user submission is untrusted input to any AI feature. Content is separated from system instructions; submission text may never act as instructions or authorise a tool | ARCH, MARKET (OWASP LLM01) | Phase 7 |
| R-13 | AI economics should scale with **contributions, not reads** | MARKET | Phase 11 cost controls |

### Security

| # | Constraint | Source | Where it lands |
|---|---|---|---|
| R-14 | **Scan all submissions for hidden Unicode** — bidi controls, homoglyphs, zero-width characters ("Trojan Source", Cambridge 2021). Render visibly and warn | ARCH | Phase 7 + Phase 11 |
| R-15 | Static-scan snippets for destructive shell commands, credential exfiltration and known-malicious package references **before display** | ARCH | Phase 7 |
| R-16 | Never treat a package name as safe because the submission says it is official. Context: the npm "Qix" attack injected malware into 18 packages (~2.6B weekly downloads) within ~16 minutes; the Shai-Hulud worm hit 500+ packages | ARCH | Phase 11 |
| R-17 | No auto-execution of untrusted code with network access or secrets. Even microVMs are not infallible — 2026 saw the first Firecracker hypervisor-escape-class CVEs. Sandbox execution, if ever added, is a *supporting* signal and never the top of the ladder | ARCH | ADR-0007 |

### Search

| # | Constraint | Source | Where it lands |
|---|---|---|---|
| R-18 | **Error-signature fingerprinting is a first-class retrieval path**, alongside lexical search. Fingerprint by priority: stack trace → exception → message (the Sentry grouping model) | ARCH | Phase 3 |
| R-19 | Route input by type: fingerprints for errors, lexical for exact tokens, embeddings for prose. BM25-style lexical excels at exact tokens (`ECONNREFUSED`, API names) that embeddings dilute | ARCH, MARKET | Phase 3 |
| R-20 | D1 FTS5 + structured filtering is a credible lexical baseline; **a dedicated external search cluster is not justified for the MVP**. Revisit only if measured relevance, latency or corpus size outgrows it | MARKET | ADR-0008 |
| R-21 | Vectorize suits read-heavy, infrequently-written data. Semantic indexing must be a **derived, batch-rebuildable layer**, never a source of truth | MARKET | Phase 3 stage 2 |
| R-22 | Build the **labelled relevance benchmark before** committing to a stack, and measure lexical / vector / hybrid separately. Include queries where semantic similarity is actively *wrong* | MARKET | Phase 3 gate |

### UX

| # | Constraint | Source | Where it lands |
|---|---|---|---|
| R-23 | Intake is one omnivorous field accepting raw stack traces, logs and prose. **Forcing dropdown selection before search is a named abandonment trigger** | UX | Phase 3 |
| R-24 | A search result must be evaluable **in under three seconds**. Essential metadata only: symptom-first title, technology + version tags, verification status. Evidence detail and raw code are rated *overwhelming* on the results page | UX | Phase 3 |
| R-25 | **State-aware split view:** left = "the Map" (tree, active node, history, branches), right = "the Territory" (the active node's commands, expected output, warnings) | UX | Phase 4 |
| R-26 | Progressive disclosure. A 50-node tree shown at once "induces cognitive paralysis": active path at full opacity, immediate children visible, deep descendants hidden | UX | Phase 4 |
| R-27 | Non-binary outcomes are required: **Unknown / Skip / Output unclear** route to fallback heuristics, not to a dead end. Every terminal dead-end offers "none of these worked → contribute a branch" | UX, ARCH | Phase 4 |
| R-28 | Backtracking: click any completed node, invalidate the downstream path, choose another branch — **without resetting the whole session** | UX | Phase 4 |
| R-29 | Environment-incompatible branches are **dimmed or struck through, still discoverable** — never silently hidden | UX | Phase 4/5 |
| R-30 | Compatibility matrix modelled on MDN browser-compat-data: verified working / verified failing / **untested — as an explicit call to action** | UX | Phase 5 |
| R-31 | Reproduction reporting **must complete in 10–30 seconds**; beyond that, abandonment spikes. Environment fields pre-populated; notes **entirely optional** — "forcing justification guarantees they will close the tab" | UX | Phase 8 gate |
| R-32 | Lowest-friction contribution is **paste rough notes → AI structures them**, with the LLM "strictly as a structural parser, not a generator". Guided structured forms and "import Markdown" are explicitly rejected as high-friction | UX, ADOPTION | Phase 7 |

### Accessibility

| # | Constraint | Source | Where it lands |
|---|---|---|---|
| R-33 | Focus rings **minimum 2px solid border**, high contrast — not a subtle colour shift. Minimum **4.5:1** contrast | UX | Phase 1 tokens |
| R-34 | Status never by colour alone — icon or text prefix required | UX, plan §18 | Phase 1 |
| R-35 | Respect `prefers-reduced-motion` | UX | Phase 1 |
| R-36 | Split view collapses to a stacked layout **below 1024px** | UX | Phase 1 |
| R-37 | Arrow-key navigation and Enter/Space activation on the tree. **Plan §18 constrains this:** ARIA `tree`/`treegrid` roles only if interaction behaviour fully matches the pattern; otherwise use semantic lists/steps. Incorrect ARIA is worse than none | UX + plan §18 | Phase 4 |

### Product scope and governance

| # | Constraint | Source | Where it lands |
|---|---|---|---|
| R-38 | **No reputation economy.** Raw upvotes, view counts and generic points "invariably deteriorate into popularity contests". "Speed of contribution" and "generic upvotes" are flagged *dangerous* — rewarding first-to-answer incentivises unverified LLM slop | UX, ADOPTION | Whole build |
| R-39 | Badges, if any, must be **evidence-derived** ("used successfully in 50+ environments"), never activity-derived. Badge overload is itself a named risk | ADOPTION | Phase 5 |
| R-40 | Disagreement is funnelled into **proposing a new branch or test** — not open comment threads. No 500-word argumentative comments | UX | Phase 8 |
| R-41 | The homepage must not resemble a social feed, a generic AI chatbot, or a static documentation wiki. All three are named archetypes to avoid | UX | Phase 3 |
| R-42 | Let weak playbooks **sink in ranking** via success-rate metrics rather than by editorial gatekeeping. High-reputation users unilaterally closing content "breeds intense resentment and toxic moderation cultures" | UX, ADOPTION | Phase 3 ranking, Phase 10 |
| R-43 | **DCO sign-off, not a CLA.** CC BY-SA-family content licence. Prefer deprecation over hard delete; hard delete reserved for legal/abuse, with tombstones | ARCH | ADR-0013 — **owner decision** |
| R-44 | Resolve licensing **before importing anything**. Stack Overflow content is CC BY-SA and revision-tied; GitHub content defaults to full copyright absent a licence. Neither is scrapeable seed data | MARKET | Phase 13 |
| R-45 | Seed **one narrow ecosystem deeply**. Broad coverage is "a trap for a solo builder" | ARCH, ADOPTION | Phase 13 |
| R-46 | UK Online Safety Act and UK GDPR obligations require a real compliance assessment. **UNKNOWN** whether DevYou is in scope | MARKET | Phase 14 — owner |

---

## 2. Targets and kill criteria

Explicitly provisional. MARKET calls them *"provisional success criteria for the
experiment, not industry benchmarks"*, and that framing must survive into the launch gate.

| Metric | Target | Source |
|---|---|---|
| Preference for structured evidence-backed presentation on matched tasks | **≥ 60%** | MARKET |
| Reduction in median troubleshooting time / attempts on branching tasks | **~20%+** | MARKET |
| Search success on the deliberately difficult benchmark | **≥ 70%** before relying on internal search | MARKET |
| Structured submissions completable without moderator reconstruction | a majority | MARKET |
| Reproduction report completion time | **10–30 s** | UX |
| Search result triage | **< 3 s** | UX |

**Kill criteria — the project stops or pivots if:**

1. The ratio of **independent reproductions to posted playbooks stays near zero** after
   seeding one ecosystem. ARCH: *"no amount of AI or UX will save it."*
2. Fewer than ~30–50 high-quality, actively used playbooks exist in the target vertical
   after 4–6 months of focused seeding, with organic Worked/Failed reports near zero.
3. Users who try it still prefer Discord + an LLM for the same problems.

---

## 3. Where research and plan diverge — plan wins, divergence recorded

| Topic | Research says | Plan says | Resolution |
|---|---|---|---|
| Trust display | UX proposes three badge tiers: Gold (human-verified) / Silver (machine-tested) / Warning | §6 derives **six confidence bands** from typed evidence, each explainable | **Plan wins.** Three tiers collapse distinct signals and edge back toward a single badge, which ARCH explicitly puts on its AVOID list. The bands *are* the badge |
| Mobile | UX says mobile is triage/read-only; `DESIGN.md` agrees | §1 makes mobile **interactive** for Test → Result → Next Step, full tree behind a drawer | **Plan wins.** Recorded in `CLAUDE.md` |
| ARIA | UX mandates `tree`/`treegrid` roles | §18 permits them **only if** interaction fully matches the ARIA pattern | **Plan wins.** Incorrect ARIA is worse than semantic lists |
| Seed corpus size | ARCH and MARKET give **no number**. ADOPTION names "<50 after 6 months" as a *failure* signal | §20 targets **30–50** seed playbooks | Plan's judgement call. **Not research-derived** — do not cite research as its source. It is consistent with ADOPTION's failure threshold |
| Database | ARCH: *"Do not select a database now"* | §4: D1 as canonical relational store | Plan + account evidence decide this, not research. ADR-0004 |

---

## 4. Competitive fact that sets urgency

**Stack Overflow for Agents launched in beta on 10 June 2026** — built on the premise that
generating answers is cheap but verifying production truth is hard. It ships TIL records
(what broke / what was tried / what worked / root cause), reusable "Blueprints", agent
APIs, `llms.txt`, and ties reputation to verification rather than creation. MARKET rates
it a **VERY HIGH** threat and notes it is converging on DevYou's differentiation directly,
not adjacently.

This constrains **timeline**, not architecture. It is recorded here so a later phase does
not rediscover it as a surprise.

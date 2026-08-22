# ADR-0006 — Typed verification model; no binary verified field

- **Status:** Accepted
- **Date:** 2026-08-22
- **Phase:** 2

## Context

Plan §6 states the rule directly: do not store a single authoritative `verified=true`
field. Four research constraints shape what replaces it:

- R-2 requires a multi-layer ladder of evidence, ascending from AI-structured (which
  never counts as verification) through sandbox execution, author-tested, independent
  reproduction, multi-environment, official-source-supported, to maintainer-confirmed.
- R-4 requires confidence shown as a discrete band with raw counts, never a bare
  percentage below n < 5.
- R-3 sets the floor for any positive signal at author-tested plus at least one
  independent reproduction on a stated version.
- R-5 requires confidence scoped per version/environment — evidence on v18 says
  nothing certain about v22.
- R-6 requires failed reproductions kept as first-class evidence, shown as a
  distribution and never averaged away.

## Decision

**No `verified` column exists anywhere in the schema**, and this is enforced
mechanically, not just by convention. `eslint.config.js` carries a `no-restricted-syntax`
rule scoped to `packages/db`, `packages/domain`, `packages/schemas` and
`packages/search` that rejects any property, property definition or TypeScript
property signature named `verified`, `isVerified` or `is_verified`, with the message
*"No `verified` flag. Confidence is derived from typed evidence records at read time —
ADR-0006."* The rule is scoped to those packages rather than global — it was briefly
global, and fired on a Material icon literally named `verified` used in
`EVIDENCE_TYPE_META.maintainer_attestation` (`packages/ui/src/evidence.tsx`), which is
why the scoping exists.

### Six derived bands

`CONFIDENCE_BANDS` (`packages/core/src/vocabulary.ts`): `unverified`,
`limited_evidence`, `moderate_evidence`, `strong_evidence`, `needs_reverification`,
`deprecated`. Every band must be explainable — `packages/ui/src/evidence.tsx`'s
`ConfidenceBadge` component cannot be constructed without both a `counts: EvidenceCounts`
prop and a required `explainHref` string; the props are typed as required, not
optional, so "render the badge without the numbers that produced it" is not a state
the type system allows.

### `deriveConfidenceBand` is a decision procedure, not a score

`packages/domain/src/confidence.ts` derives the band through an ordered sequence of
threshold checks, not a weighted sum. The file's own comment states why a weighted sum
is wrong here: it "lets three weak signals outvote one strong contradiction," which is
exactly what R-6 forbids — a contradiction (a cluster of recent failures) must be able
to pull the band down regardless of how many older successes exist, and a score that
sums signals cannot express that asymmetry. Lifecycle state (`deprecated`,
`superseded`, `needs_reverification`) is checked first and overrides all evidence
unconditionally — a deprecated playbook with fifty successful reproductions is still
deprecated.

Evidence types are not ranked. The comment in `packages/db/src/schema/evidence.ts` on
`evidenceType` is explicit: "Not a rank." A CI run and an independent reproduction
answer different questions, and the derivation uses each for what it actually shows
rather than placing one above the other on a single scale.

### Thresholds

All from `packages/domain/src/confidence.ts::THRESHOLDS`:

| Threshold | Value | Meaning |
|---|---|---|
| `LIMITED_PASSES` | 1 | Independent passes needed to leave `unverified` |
| `MODERATE_PASSES` | 3 | Independent passes (plus environment threshold) for `moderate_evidence` |
| `MODERATE_UNIQUE_ENVIRONMENTS` | 2 | Distinct environments needed alongside `MODERATE_PASSES` |
| `STRONG_PASSES` | 6 | Independent passes needed for `strong_evidence` |
| `STRONG_UNIQUE_ENVIRONMENTS` | 3 | Distinct environments needed alongside `STRONG_PASSES` |
| `FAILURE_RATIO_FORCES_REVIEW` | 1/3 | Failure ratio at which recent failures force `needs_reverification` regardless of accumulated successes |
| `FAILURE_RATIO_MIN_SAMPLE` | 4 | Minimum total reports before the failure-ratio rule applies |

These are recorded as judgements, open to revision, not physical constants — the
source comment says as much: "every threshold is named, and every one of them is a
judgement that can be argued with." `MODERATE_UNIQUE_ENVIRONMENTS = 2` gets its own
justification in the source: the band's claim is "this has worked somewhere other than
where it was written," and two environments is the smallest number that can support
that claim. Three would be a stronger, more honest claim, but on a corpus of thirty
seed playbooks it would mean almost nothing ever leaves `limited_evidence` — "a scale
that is honest and useless teaches readers to ignore the band."

### Regenerable cache, segmented by environment

`revision_confidence` (`packages/db/src/schema/evidence.ts`) is documented as strictly
a cache: every field is regenerable from `evidence_records`, recomputed by a job and by
any evidence-adding write, and a test regenerates the whole table from raw evidence and
asserts it matches. `revision_confidence_segments` implements R-5 directly — confidence
per technology / version bucket / OS family, so the compatibility matrix can show
"works on 20, fails on 22" instead of a single global band averaging the two into
"mostly works."

## Consequences

- **Authority alone stays `unverified`.** A revision with a maintainer attestation and
  an official reference but zero reproductions does not reach `moderate_evidence` —
  the code comment states the reasoning: a maintainer confirming the cause is genuine
  evidence about the cause, but not evidence that the written procedure works on
  somebody else's machine, "which is the specific thing this product measures.
  Letting authority alone reach the top band would reintroduce the badge." R-3's floor
  — author-tested plus at least one independent reproduction — is enforced by this
  path, not merely stated.
- **Recent failure clustering overrides accumulated success.** Once total reports
  reach `FAILURE_RATIO_MIN_SAMPLE` (4) and the failure ratio reaches
  `FAILURE_RATIO_FORCES_REVIEW` (1/3), the band becomes `needs_reverification`
  regardless of how many earlier passes exist. The source comment frames this as a
  statement about what is currently known, not a penalty: reproducibility decays
  (R-8), and a procedure that worked in March can genuinely stop working in August
  without anyone having lied about the earlier result.
- **The author's own reproduction never counts.** `tallyEvidence` in
  `packages/domain/src/confidence.ts` excludes any row where `actorId` matches the
  revision's author — not down-weighted, excluded outright, because an author
  confirming their own playbook has confirmed nothing a reader did not already assume.
- **A zero-weight actor's failure still counts; their success does not.** In
  `tallyEvidence`, `evidenceType === "failure_observation"` always increments
  `reproducedFailed`, even from the author and even from an actor with
  `actorWeight === 0`, while every success path requires `counts = !isAuthor &&
  actorWeight > 0`. The asymmetry is deliberate and named in the source: "a suspected
  sockpuppet reporting 'it worked' is worthless; the same account reporting 'it
  failed' is at minimum a signal worth a maintainer's attention, and suppressing it is
  the direction of error this product must not make."

## Alternatives considered

- **A single `verified` boolean.** Rejected outright — this is the specific failure
  the product exists to avoid, and plan §6 forbids it by name.
- **A 0–100 score.** Rejected. False precision, and a scalar hides which signal moved
  it — the whole point of `explainConfidence` returning structured reasons rather than
  a formatted string is that a reader can see which evidence produced the band, which
  a single number cannot show.
- **Gold/Silver/Warning badge tiers**, as the UX research proposed. Rejected. Three
  tiers collapse distinct signals and edge back toward a single badge — exactly what
  `ARCH`'s AVOID list warns against. `RESEARCH-CONSTRAINTS.md` §3 records this
  divergence explicitly: "Plan wins. Three tiers collapse distinct signals and edge
  back toward a single badge, which ARCH explicitly puts on its AVOID list. The bands
  *are* the badge."

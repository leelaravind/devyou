# Technology taxonomy

`technologies.json` is the seed data for the `technologies`, `technology_aliases`
and `versions` tables (see `packages/db/src/schema/taxonomy.ts`). It is the
vocabulary a playbook is scoped against and the vocabulary a pasted error
message is matched against.

## Scope

DevYou launches narrow and deep, per `IMPLEMENTATION.md` §20: Cloudflare/edge
runtime, PostgreSQL/database concurrency, and Docker/Kubernetes deployment and
networking, plus the runtimes and operating systems those three domains sit
on. Covering the whole software world is a documented anti-goal — this file
should stay a tight, high-quality set rather than grow broad.

## How it is applied

A loader (not part of this package) reads this file and upserts rows: one
`technologies` row per entry, one `technology_aliases` row per alias, one
`versions` row per version. `type` must be a value from `TECHNOLOGY_TYPES` in
`packages/core/src/vocabulary.ts`.

Aliases are what make the exact-error search path work at all. Nobody
searches for "PostgreSQL" — they paste `SQLSTATE 40001` or
`too many clients already`. Each alias has a `kind` (`name` | `package` |
`binary` | `error_token` | `import_path`); `error_token` matches are weighted
far more heavily in ranking than a `name` match, because nobody pastes an
error token by accident. Alias strings must be genuine — an invented error
string is worse than a missing one, because it will confidently match the
wrong technology.

`versions.isMinorOrMajor` marks a release as a deterministic re-verification
trigger (R-8, plan §15): a playbook scoped to a range that a new minor falls
outside of becomes stale the moment that minor ships.

## The permanence rule

**A `slug` is permanent once it has been seeded.** Playbook URLs are built
from technology slugs, and evidence is segmented and aggregated by
`technology_id` (resolved via slug). Renaming or reassigning a slug after
playbooks and evidence exist against it breaks published URLs and silently
splits or merges evidence history that must stay intact for the confidence
bands to mean anything. If a technology is renamed, superseded, or merged
into another (e.g. a product rename), add a new row and use `status` /
`mergedIntoId` to link them — never rewrite the old slug in place.

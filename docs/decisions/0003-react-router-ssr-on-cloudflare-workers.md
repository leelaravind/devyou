# ADR-0003 — React Router SSR on Cloudflare Workers

- **Status:** Accepted
- **Date:** 2026-08-22
- **Phase:** 0

## Context

`IMPLEMENTATION.md` §4 recommends TypeScript, React, React Router in framework/SSR mode
with Vite on Cloudflare Workers, Tailwind, Drizzle and D1. Two independent constraints
make this more than a preference.

**1. Server-rendered knowledge is a hard requirement, not an optimisation.**
Plan §16 requires core troubleshooting knowledge to be present in server-rendered HTML,
and the Phase 12 gate is explicit: *"no core page depends on client JS for crawlable
knowledge."* Plan §18 additionally requires a textual fallback for the diagnostic tree.
The market research reinforces it from a different direction — structured, crawlable,
machine-readable content is what makes the corpus retrievable by search engines and AI
agents at all. A client-only SPA fails this outright.

**2. The network already runs this exact stack.**
ATSYou's `apps/app` is React 19 + React Router 8 framework mode + Vite 8 +
`@cloudflare/vite-plugin` + Tailwind 4 + Drizzle + D1 + Vitest 4, deployed with Wrangler
4. Choosing a different framework would mean a second set of conventions, a second
deployment shape and a second set of mistakes, for no gain DevYou can name.

## Decision

Build all three DevYou apps as React Router 8 framework-mode applications on Cloudflare
Workers, pinned to the versions ATSYou runs.

| Concern | Choice |
|---|---|
| Runtime | Cloudflare Workers (`workerd`), `nodejs_compat` |
| Framework | React 19.2, React Router 8.3 (framework/SSR mode) |
| Bundler | Vite 8 + `@cloudflare/vite-plugin` |
| Styling | Tailwind CSS 4 via `@tailwindcss/vite`, driven by design tokens |
| Data | Drizzle ORM 0.45 over D1 |
| Validation | Zod 4 at every boundary |
| Tests | Vitest 4; `@cloudflare/vitest-pool-workers` for Worker APIs |
| Deploy | Wrangler 4 |
| Monorepo | pnpm 11 workspaces + Turborepo 2 |

### Three Workers

Matching plan §4 and ATSYou's three-Worker topology:

- **`devyou-app`** — public SSR site, search, diagnostic sessions, contributor UI,
  authenticated API. Holds no destructive admin capability.
- **`devyou-admin`** — admin only, behind Cloudflare Access, separate cookie namespace,
  `workers_dev: false`, `preview_urls: false`.
- **`devyou-jobs`** — queue consumer: AI structuring, duplicate detection, indexing,
  staleness, moderation assistance. **The only Worker bound to the AI provider
  credential**, so no public request path can be made to spend it.

### The rendering rule, enforced by test

Every public knowledge route renders its full textual content server-side. Interactivity —
the diagnostic session, the omnibox, the tree — *enhances* a page whose knowledge is
already in the HTML. A Phase 12 test fetches core pages with JavaScript disabled and
asserts the diagnostic content is present. Without that test this decision decays into an
intention.

## Consequences

- SEO, accessibility and AI-crawler readability follow from the architecture rather than
  from a retrofit.
- Workspace packages are source-only (`exports` → `src/`), as in ATSYou, so there is no
  build-ordering problem between packages.
- **Cost:** SSR on Workers means CPU time per request. Mitigated by keeping AI out of read
  paths entirely (plan §11: *"no AI call for ordinary playbook reads"*) and by KV-cached
  config snapshots. The market research's cost model puts a corpus of this shape well
  inside the paid Workers allowance at 100k MAU.
- **Constraint carried forward:** D1 is capped at 10 GB per database and is
  single-threaded per database. Not a V1 blocker for a corpus of 30–50 seed playbooks, but
  recorded as a Medium risk requiring partitioning if the corpus grows large and hot.
- **Unconfirmed (U-3):** whether the account's plan permits `limits.cpu_ms`. ATSYou's
  ADR-0013 records that `limits` is rejected outright on the Free plan, so a deploy that
  accepts the block is itself the plan check. DevYou will set a CPU ceiling and treat a
  rejection as the answer.

## Alternatives considered

- **Next.js on Workers.** Rejected: a second framework in the network for no stated gain,
  and a heavier adapter surface on `workerd`.
- **Client-rendered SPA + API.** Rejected: fails plan §16 and the Phase 12 gate outright.
- **Node or container hosting.** Rejected: the plan is Cloudflare-first, the data lives in
  D1, and no other network product runs containers.

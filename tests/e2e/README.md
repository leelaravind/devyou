# @devyou/e2e

End-to-end, accessibility and visual acceptance tests for DevYou, run against the
**deployed** site rather than a local dev server.

## Why the deployed Worker, not `pnpm dev`

The thing under test here is not "does the React code render" — that is what the
unit tests in each package already cover. This suite exists to verify the things
that only exist once the app is actually deployed to Cloudflare:

- **The real Content-Security-Policy**, with its nonce and `strict-dynamic` script
  source. A local dev server does not send the same headers a Worker in front of it
  does, and a diagnostic session that quietly depends on an inline script would pass
  locally and break in production.
- **The real cache headers** (`Cache-Control: public, max-age=60, s-maxage=300,
  stale-while-revalidate=86400`) and the edge cache behaviour they imply.
- **The real D1 database**, seeded with the actual playbook corpus — 43 playbooks at
  the time this suite was written — rather than a fixture. Search relevance,
  confidence bands and revision history are all data-shaped assertions that only
  mean something against real rows.
- **The real Worker runtime**, not Node pretending to be one. `wrangler dev` gets
  close; it is still not the thing a reader's browser actually talks to.

In short: this is an acceptance suite for the deployed artifact, and it is
deliberately slower and more expensive than a unit test in exchange for testing the
thing that actually ships. `playwright.config.ts` points at
`https://dev-staging.itisyou.app` by default; override it with `BASE_URL` to run
against any other deployment (a preview URL, production once it exists, or a local
`wrangler dev` instance if you specifically want to debug against one).

## Running it

From the repository root:

```sh
pnpm install --no-frozen-lockfile
cd tests/e2e
npx playwright install chromium
pnpm exec playwright test --reporter=list
```

Or, from the repository root, via the workspace script:

```sh
pnpm run e2e:staging
```

Useful variants:

```sh
# Point at a different deployment
BASE_URL=https://dev.itisyou.app pnpm run e2e

# Interactive UI mode, for debugging a single spec
pnpm run e2e:ui

# One spec file only
pnpm exec playwright test specs/diagnostic-flow.spec.ts
```

`playwright-report/` (HTML report) and `test-results/` (traces, retained on
first-retry failures) are both git-ignored — see the root `.gitignore`.

## What each spec covers

- **`specs/public-knowledge.spec.ts`** — the knowledge surface a reader gets without
  starting a session: the landing page is a search intake surface rather than a feed
  or a chatbot (R-41); an exact error paste lands on `/search` with the matching
  playbook badged as an exact/error-code match; a result card never shows a bare
  percentage (R-4); a playbook page renders every diagnostic step with its branches
  stated as prose; `robots.txt` and `sitemap.xml` are correct; a historical revision
  URL (`/p/:slug/r/:n`) keeps resolving (plan §9).
- **`specs/diagnostic-flow.spec.ts`** — the core loop: landing → search → playbook →
  `/diagnose` → a branch → a conclusion → the report form. Covers the state-aware
  split view and its responsive collapse below 1024px (R-25, R-36), the URL-encoded
  session advancing on each answer, the required "I can't tell" route on a test node
  (R-27), backtracking-by-truncation (R-28), the fact that reaching a conclusion
  records nothing by itself (the report is a separate URL and form), and that a
  destructive command's `CodeBlock` requires acknowledgement before its copy button
  is usable (plan §14).
- **`specs/accessibility.spec.ts`** — `@axe-core/playwright` against five
  representative pages, failing on any `serious` or `critical` violation, plus
  hand-written checks this repo's own constraints call out specifically: exactly one
  `h1` per page, a skip link that becomes visible on focus, full keyboard operability
  of the diagnostic flow (Tab and Enter, not a mouse), a minimum 2px visible focus
  ring (R-33), and no status conveyed by colour alone (R-34).
- **`specs/no-javascript.spec.ts`** — the Phase 12 gate. Runs an entire browser
  context with `javaScriptEnabled: false` and asserts the landing page, a playbook
  page and search results all render their real content, that a playbook's full
  diagnostic steps are present in the server-rendered HTML (not injected after
  hydration), that the search form is a genuine GET form, and that the diagnostic
  session still advances — because every control on `/diagnose` is a plain link.
- **`specs/visual.spec.ts`** — screenshots of four key pages at 1440×900 and
  390×844, plus a direct check that the "Technical Precision" design tokens actually
  resolve (dark background, Geist/Inter headline font). See below for baselines.

## Visual baselines

Screenshots are compared with `toHaveScreenshot()` against baselines committed at
`tests/e2e/screenshots/<project>/<name>.png` (`<project>` is `desktop` or `mobile`,
matching `playwright.config.ts`'s two projects). `maxDiffPixelRatio` is set
deliberately generously — this file is a change detector for structural
regressions, not a pixel-perfect gate, because real font loading and real corpus
content on a live edge deployment will never render byte-identical twice.

**Baselines are never regenerated by a normal run.** A missing or mismatched
baseline fails the test on purpose. To regenerate them deliberately, after
confirming a visual change is intentional:

```sh
cd tests/e2e
pnpm exec playwright test specs/visual.spec.ts --update-snapshots
```

Review the resulting diff in `git diff --stat tests/e2e/screenshots/` before
committing it — a baseline update is a real change to what "correct" means for this
suite, and it should be reviewed as carefully as any other change to expected
behaviour.

## A note on honesty

Where a spec fails because the deployed app does not do what the constraint it is
named after requires, the fix is in the app, not in the test. This suite is not
supposed to be permanently green at the cost of meaning nothing.

# Evidence — legal document set (ADR-0013)

**Date:** 23 August 2026
**Scope:** the six legal routes, the footer legal nav, terms exposure on every
submission surface, and the guards that keep them honest.

## What was verified, and against what

### Local (wrangler dev, empty local D1)

All six legal routes render without a database and without a session — asserting the
documents depend on nothing that could gate them:

```
/privacy            -> 200  address=1  effective-date=1
/terms              -> 200  address=1  effective-date=1
/contribution-terms -> 200  address=1  effective-date=1
/content-policy     -> 200  address=1  effective-date=1
/acceptable-use     -> 200  address=1  effective-date=1
/ai                 -> 200  address=1  effective-date=1
Cache-Control on /privacy: no-store   (same policy as /about — safe default)
```

`/contribute` and `/sitemap.xml` return 500 locally because the local D1 holds no
schema; both query the database by design. They are covered by the staging checks
below.

### Staging — `https://dev-staging.itisyou.app`, version `d8a042f2`

Anonymous curl, no cookies:

```
all six legal routes            -> 200, approved address present, effective date present
home page footer                -> all 6 legal links present, nav aria-label="Legal"
sitemap.xml                     -> 6 legal <loc> entries
/contribute                     -> links /contribution-terms
/sign-in                        -> unconfigured branch (staging holds no OAuth secrets),
                                   so the terms sentence correctly does not render there;
                                   it is in the configured branch, which production has.
                                   Asserted at source by test/legal.node.test.ts.
```

Playwright, desktop (1440×900) and mobile (390×844) projects:

```
specs/legal.spec.ts             -> 18/18
full suite                      -> 116/116 after visual baselines were deliberately
                                   regenerated: the footer legal row is an intended
                                   change to every page, and 7 full-page screenshots
                                   moved with it. 109/109 functional tests passed
                                   before the regeneration; only toHaveScreenshot
                                   assertions were affected.
```

### CI-shape checks

```
pnpm run typecheck              -> 19/19 projects
pnpm run lint                   -> clean
pnpm run test                   -> all suites pass; apps/app 125/125, of which
                                   test/legal.node.test.ts contributes 67 guards
pnpm run build                  -> clean
```

The guards in `apps/app/test/legal.node.test.ts` assert: every legal route is
registered and in the sitemap; no legal route has a loader (nothing to gate); the
approved postal address exists in exactly one module (`app/lib/legal.tsx`) and every
document renders through it; no document claims a company number, VAT number, ICO
reference, DPO or telephone number (comments stripped before matching, so the comment
*listing* those forbidden identifiers is not a false positive); every submission
surface links the contribution terms; the capture form names Anthropic and links
`/ai`; and no route hard-codes a pre-ticked checkbox — `defaultChecked={expression}`
restoring the author's own saved state is deliberately allowed.

## Repository sweep

- No pre-existing legal address anywhere in the repository — the postcode-pattern
  matches are icon codepoints, corpus JSON and Stitch design fixtures. Nothing to
  replace; the approved address is the first and only one.
- No contact email address exists anywhere in the repository, so none is claimed in
  the documents; contact is postal. An owner decision on a public contact email is
  recorded as open.
- No company/ICO/VAT/phone identifiers anywhere in the new documents, by test.

## Production — `https://dev.itisyou.app`, version `ac6aa652`

The production deploy could not be run by the implementing session (blocked by its
permission gate, twice, and not worked around); the owner ran
`pnpm run deploy:production` in-session on 23 August 2026. Verified immediately
afterwards, anonymously:

```
all six legal routes            -> 200, approved address present, effective date present
home page footer                -> all 6 legal links present
sitemap.xml                     -> 6 legal <loc> entries
/contribute                     -> links /contribution-terms
/sign-in                        -> configured branch renders "Signing in is covered by
                                   the terms of use and the privacy notice"
/p/<real playbook>/report       -> renders the contribution-terms line
full Playwright suite           -> 116/116 with BASE_URL=https://dev.itisyou.app
```

The legal document set is therefore **VERIFIED PRODUCTION**.

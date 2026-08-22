import { test, expect } from "@playwright/test";

/**
 * Visual acceptance against the "Technical Precision" design system
 * (packages/ui/src/styles/theme.css, docs/design/stitch/*\/screen.png).
 *
 * These are change detectors, not pixel-perfect gates: `maxDiffPixelRatio` is
 * deliberately generous, because a live edge-cached page (real fonts loading over
 * the network, real corpus content, anti-aliasing differences between CI runs) will
 * always drift by a few pixels even when nothing meaningful changed. The point of
 * this file is to catch a *structural* regression — a broken layout, a missing
 * stylesheet, a token that stopped resolving — not to chase single-pixel diffs.
 *
 * Baselines are committed under `tests/e2e/screenshots/<project>/*.png`. They are
 * **not** regenerated automatically by a normal run — see README.md for the
 * deliberate `--update-snapshots` step to refresh them after an intentional visual
 * change.
 */

// The dark palette is the product's actual default (theme.css sets it on bare
// `:root`, unconditionally; the light palette only applies when the OS prefers
// light and no explicit theme has been chosen). Playwright's own default emulated
// `colorScheme` is "light", so it has to be pinned here to test the real default.
test.use({ colorScheme: "dark" });

const SLUG = "d1-sqlite-busy-concurrent-writes";

const PAGES: ReadonlyArray<{ path: string; name: string }> = [
  { path: "/", name: "landing" },
  { path: `/search?q=${encodeURIComponent("SQLITE_BUSY: database is locked")}`, name: "search" },
  { path: `/p/${SLUG}`, name: "playbook" },
  { path: `/p/${SLUG}/diagnose`, name: "diagnose" },
];

for (const { path, name } of PAGES) {
  test(`${name} matches its visual baseline`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      animations: "disabled",
      // Generous: a change-detector, not a flake generator (see file header).
      maxDiffPixelRatio: 0.05,
    });
  });
}

test("the Technical Precision dark surface and headline font are actually applied", async ({ page }) => {
  await page.goto("/");

  // #0b1326 — theme.css's `--dv-background`, the "Deep Charcoal" dark surface.
  const backgroundColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(backgroundColor).toBe("rgb(11, 19, 38)");

  const headlineFontFamily = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    return h1 ? getComputedStyle(h1).fontFamily : "";
  });
  expect(headlineFontFamily.toLowerCase()).toMatch(/geist|inter/);
});

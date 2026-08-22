import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const SLUG = "d1-sqlite-busy-concurrent-writes";

const PAGES: ReadonlyArray<{ path: string; label: string }> = [
  { path: "/", label: "landing" },
  { path: "/search?q=SQLITE_BUSY", label: "search results" },
  { path: `/p/${SLUG}`, label: "playbook" },
  { path: `/p/${SLUG}/diagnose`, label: "diagnose" },
  { path: "/environment", label: "environment" },
];

for (const { path, label } of PAGES) {
  test(`axe: ${label} has no serious or critical violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );

    expect(
      blocking,
      blocking
        .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)\n  ${v.helpUrl}`)
        .join("\n"),
    ).toEqual([]);
  });
}

test.describe("document structure", () => {
  for (const { path, label } of PAGES) {
    test(`${label} has exactly one h1`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
    });
  }

  test("the skip link becomes visible on focus", async ({ page }) => {
    // Not "/": home.tsx's omnibox is deliberately autofocused (good UX on its own
    // terms), and a browser's native `autofocus` resumes the Tab sequence from that
    // element rather than the document start even after an explicit `.blur()` —
    // that is a property of autofocus, not of the skip link. The skip link itself
    // is rendered once in root.tsx's <body> for every page, so a page without an
    // autofocused control is the honest way to test that it is the first Tab stop.
    await page.goto("/environment");

    await page.keyboard.press("Tab");

    const active = page.locator(":focus");
    await expect(active).toHaveText("Skip to content");
    await expect(active).toHaveAttribute("href", "#main");

    // Off-screen until focused (`left: -9999px` in theme.css), then pulled onto the
    // visible canvas.
    const left = await active.evaluate((el) => getComputedStyle(el).left);
    expect(left).not.toBe("-9999px");
    const box = await active.boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  });
});

test.describe("keyboard operability of the diagnostic flow (plan §18)", () => {
  test("Tab to the first outcome link and activate it with Enter", async ({ page }) => {
    await page.goto(`/p/${SLUG}/diagnose`);
    await expect(page).not.toHaveURL(/steps=/);

    const outcome = page.getByRole("link", { name: "Passed" });

    // Tab from the top of the page until the outcome link itself has focus, rather
    // than jumping to it with `.focus()` — the point of this test is that a real
    // keyboard user can reach it, not merely that it is focusable.
    let reached = false;
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      const isFocused = await outcome.evaluate((el) => el === document.activeElement);
      if (isFocused) {
        reached = true;
        break;
      }
    }
    expect(reached).toBe(true);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/steps=/);
  });

  test("focus rings are visible: outline-width is at least 2px (R-33)", async ({ page }) => {
    await page.goto(`/p/${SLUG}/diagnose`);

    let outlineWidth = -1;
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      const active = page.locator(":focus");
      // Skip the skip-link itself (a deliberately special case) so this measures the
      // ordinary focus ring used across the rest of the interface.
      const isOrdinaryLink = await active
        .evaluate((el) => (el.tagName === "A" || el.tagName === "BUTTON") && !el.className.includes("dv-skip-link"))
        .catch(() => false);
      if (isOrdinaryLink) {
        outlineWidth = await active.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth));
        break;
      }
    }

    expect(outlineWidth).toBeGreaterThanOrEqual(2);
  });
});

test("no state is conveyed by colour alone on result cards (R-34)", async ({ page }) => {
  await page.goto("/search?q=SQLITE_BUSY");

  const cards = page.locator("main ol > li article");
  const cardCount = await cards.count();
  expect(cardCount).toBeGreaterThan(0);

  // Every "chip" — the match badge, the technology tags, the reproduction count, the
  // confidence band — pairs an icon with a text label (search.tsx, evidence.tsx).
  // Sampling the first few cards is enough to catch a chip that regressed to an
  // icon- or colour-only indicator.
  const sample = Math.min(cardCount, 3);
  for (let i = 0; i < sample; i += 1) {
    const chips = cards.nth(i).locator("span:has(svg)");
    const chipCount = await chips.count();
    expect(chipCount).toBeGreaterThan(0);
    for (let c = 0; c < chipCount; c += 1) {
      const text = (await chips.nth(c).innerText()).trim();
      expect(text.length).toBeGreaterThan(0);
    }
  }
});

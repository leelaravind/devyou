import { test, expect } from "@playwright/test";

/**
 * The Phase 12 gate: "no core page depends on client JavaScript for crawlable
 * knowledge." Everything below runs in a browser context with JavaScript switched
 * off entirely — not merely slow, not merely un-hydrated, actually disabled — which
 * is what a crawler, a text browser, or a reader on a locked-down corporate machine
 * sees. `session-path.ts` explains the architectural choice this validates: the
 * whole diagnostic session is plain links and GET forms, precisely so this file can
 * pass.
 */

test.use({ javaScriptEnabled: false });

const SLUG = "d1-sqlite-busy-concurrent-writes";

test("the landing page renders its knowledge content", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Don't guess. Test." })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Describe the problem, or paste an error or stack trace" }),
  ).toBeVisible();
  await expect(page.getByText("What makes an answer here different")).toBeVisible();
});

test("a playbook page renders its full diagnostic steps in the HTML — the crawlable-knowledge gate", async ({
  page,
}) => {
  await page.goto(`/p/${SLUG}`);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const stepsRegion = page.getByRole("region", { name: "The diagnostic path" });
  const countText = await stepsRegion.locator("p").first().innerText();
  const expectedCount = Number(countText.match(/(\d+)\s+steps?/)?.[1]);
  expect(expectedCount).toBeGreaterThan(0);

  // The steps are present in the markup itself, not injected after hydration —
  // this is the whole point of the gate. Each step's title is visible text, and at
  // least one step's branches are stated as prose ("What happens next").
  const steps = stepsRegion.locator("> ol > li");
  await expect(steps).toHaveCount(expectedCount);
  await expect(stepsRegion.getByText("What happens next").first()).toBeVisible();
});

test("a search result page renders its knowledge content", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent("SQLITE_BUSY: database is locked")}`);
  const firstCard = page.locator("main ol > li").first();
  await expect(firstCard.getByRole("heading", { level: 2 })).toBeVisible();
});

test("the search form is a real GET form and submits without JavaScript", async ({ page }) => {
  await page.goto("/");

  const omnibox = page.getByRole("textbox", {
    name: "Describe the problem, or paste an error or stack trace",
  });
  await omnibox.fill("SQLITE_BUSY: database is locked");
  await page.getByRole("button", { name: "Diagnose" }).click();

  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.locator("main ol > li").first()).toBeVisible();
});

test("the diagnostic session advances with JavaScript disabled — every control is a link", async ({
  page,
}) => {
  await page.goto(`/p/${SLUG}/diagnose`);
  await expect(page.getByRole("heading", { level: 2, name: "D1 write throws SQLITE_BUSY" })).toBeVisible();

  await page.getByRole("link", { name: "Passed" }).click();

  await expect(page).toHaveURL(/steps=/);
  await expect(
    page.getByRole("heading", { level: 2, name: "Check whether two writes are landing at the same moment" }),
  ).toBeVisible();
});

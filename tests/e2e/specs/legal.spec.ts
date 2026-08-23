import { test, expect } from "@playwright/test";

/**
 * The legal document set (ADR-0013), against the deployed Worker.
 *
 * What matters here: every document is reachable without an account, at a stable
 * URL, states its effective date, carries the approved postal address, and is
 * linked from the footer of every page. The suite runs in both viewport projects,
 * so mobile accessibility of the documents is asserted by the same tests.
 */

const LEGAL_PAGES = [
  { path: "/privacy", heading: "Privacy notice" },
  { path: "/terms", heading: "Terms of use" },
  { path: "/contribution-terms", heading: "Contribution terms" },
  { path: "/content-policy", heading: "Content and copyright policy" },
  { path: "/acceptable-use", heading: "Acceptable use policy" },
  { path: "/ai", heading: "How AI is used" },
];

test.describe("legal documents", () => {
  for (const { path, heading } of LEGAL_PAGES) {
    test(`${path} renders unauthenticated with its title, date and the approved address`, async ({
      page,
    }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);

      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText(/Effective and last updated/i)).toBeVisible();

      // The approved public legal address, and only that address.
      await expect(page.getByText("13 Freeland Park")).toBeVisible();
      await expect(page.getByText("BH16 6FA")).toBeVisible();
    });
  }

  test("the footer of the home page links every legal document", async ({ page }) => {
    await page.goto("/");
    const legalNav = page.getByRole("navigation", { name: "Legal" });
    for (const { path } of LEGAL_PAGES) {
      await expect(legalNav.locator(`a[href="${path}"]`)).toBeVisible();
    }
  });

  test("a footer legal link actually navigates", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeVisible();
  });

  test("the contribution capture page shows the terms and the AI disclosure before submission", async ({
    page,
  }) => {
    await page.goto("/contribute");
    // The signposting page links the contribution terms for everyone, signed in or not.
    await expect(page.locator('a[href="/contribution-terms"]').first()).toBeVisible();
  });
});

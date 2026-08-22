import { test, expect } from "@playwright/test";

/**
 * The knowledge surface a reader gets without ever starting a diagnostic session:
 * the landing page, search, a playbook, and the crawl surface (robots/sitemap).
 *
 * Selectors here are role- and text-based against the real staging corpus (43 seeded
 * playbooks) rather than Tailwind classes — see `apps/app/app/routes/home.tsx`,
 * `search.tsx` and `p.$slug.tsx` for the markup this asserts against.
 */

const D1_SLUG = "d1-sqlite-busy-concurrent-writes";
const EXACT_ERROR = "SQLITE_BUSY: database is locked";

test.describe("landing page (R-41)", () => {
  test("renders the omnibox and does not render a feed or a chat UI", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Don't guess. Test." })).toBeVisible();

    // The omnibox: a real textarea named "q", not a chat composer.
    const omnibox = page.getByRole("textbox", {
      name: "Describe the problem, or paste an error or stack trace",
    });
    await expect(omnibox).toBeVisible();

    // Not a feed: the landing page's own copy is static explanatory content, and it
    // links to zero playbooks directly. A feed would be a scrolling list of `/p/`
    // cards; this page has none until the reader actually searches.
    await expect(page.locator('a[href^="/p/"]')).toHaveCount(0);

    // Not a chat UI: no message history, no "send" affordance framed as a
    // conversation turn. The one input on the page submits to /search as a normal
    // form, which the no-javascript suite separately verifies.
    await expect(page.locator('[role="log"]')).toHaveCount(0);
  });
});

test.describe("search (R-18, R-19, R-24)", () => {
  test("an exact error lands on /search with the D1 playbook first, badged as an exact/error match", async ({
    page,
  }) => {
    await page.goto("/");
    const omnibox = page.getByRole("textbox", {
      name: "Describe the problem, or paste an error or stack trace",
    });
    await omnibox.fill(EXACT_ERROR);
    await page.getByRole("button", { name: "Diagnose" }).click();

    await expect(page).toHaveURL(/\/search\?q=/);

    const firstCard = page.locator("main ol > li").first();
    await expect(firstCard.getByRole("link", { name: /Fixing D1 SQLITE_BUSY/ })).toHaveAttribute(
      "href",
      `/p/${D1_SLUG}`,
    );

    // "exact/error-code match" — the app's own vocabulary is "Exact error match" for
    // a fingerprint hit and "Error code match" for a code hit (search.tsx's
    // MATCH_LABEL). Either counts; a bare "Related" on the top result would not.
    await expect(firstCard.getByText(/Exact error match|Error code match/)).toBeVisible();
  });

  test("a result card shows title, technology tags and reproduction counts, and never a percentage (R-4)", async ({
    page,
  }) => {
    await page.goto(`/search?q=${encodeURIComponent(EXACT_ERROR)}`);

    const firstCard = page.locator("main ol > li").first();
    await expect(firstCard.getByRole("heading", { level: 2 })).toBeVisible();

    // Technology tags — the D1 playbook is tagged with the technologies it's about.
    await expect(firstCard.getByText("Cloudflare D1", { exact: true })).toBeVisible();
    await expect(firstCard.getByText("Cloudflare Workers", { exact: true })).toBeVisible();

    // Reproduction counts as raw numbers or an honest "no reproductions" — never a
    // rate. R-4 is specifically about not dressing arithmetic as knowledge on a
    // results page.
    await expect(firstCard.getByText(/reproduced|no reproductions/)).toBeVisible();

    const cardText = (await firstCard.innerText()).trim();
    expect(cardText).not.toContain("%");
  });
});

test.describe("playbook page (plan §16, R-27)", () => {
  test("renders every diagnostic step, with each step's branches stated as text", async ({ page }) => {
    await page.goto(`/p/${D1_SLUG}`);

    const stepsRegion = page.getByRole("region", { name: "The diagnostic path" });
    await expect(stepsRegion).toBeVisible();

    const countText = await stepsRegion.locator("p").first().innerText();
    const expectedCount = Number(countText.match(/(\d+)\s+steps?/)?.[1]);
    expect(expectedCount).toBeGreaterThan(0);

    const steps = stepsRegion.locator("> ol > li");
    await expect(steps).toHaveCount(expectedCount);

    // Every step's own heading is rendered ("Step 1 · Start", etc.) and at least
    // one step states its outgoing branches as prose, exactly what a crawler or a
    // reader without JavaScript depends on (see p.$slug.tsx's own comment on this).
    await expect(steps.first().getByText(/Step 1/)).toBeVisible();
    await expect(stepsRegion.getByText("What happens next").first()).toBeVisible();
  });
});

test.describe("crawl surface (plan §16)", () => {
  test("robots.txt disallows /search and references the sitemap", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toMatch(/Disallow:\s*\/search/);
    expect(body).toMatch(/Sitemap:\s*https?:\/\/\S+\/sitemap\.xml/);
  });

  test("sitemap.xml is valid XML with <url> entries", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("xml");

    const body = await response.text();
    expect(body.startsWith('<?xml version="1.0"')).toBe(true);
    expect(body).toContain("<urlset");

    const openTags = body.match(/<url>/g)?.length ?? 0;
    const closeTags = body.match(/<\/url>/g)?.length ?? 0;
    expect(openTags).toBeGreaterThan(0);
    expect(openTags).toBe(closeTags);
    expect(body).toContain("<loc>");
  });
});

test.describe("historical revisions survive (plan §9)", () => {
  // The superseded-revision surface — banners, evidence scoping, history, and the
  // fact that revision 1 keeps serving revision 1's text — is covered in
  // `revision-lifecycle.spec.ts` against the one playbook that has actually been
  // revised. This asserts the part that must hold for *every* playbook, revised or
  // not: a revision URL never stops resolving.
  test("/p/:slug/r/1 returns 200", async ({ request }) => {
    const response = await request.get(`/p/${D1_SLUG}/r/1`);
    expect(response.status()).toBe(200);
  });
});

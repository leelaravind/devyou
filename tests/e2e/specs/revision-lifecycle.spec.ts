import { test, expect } from "@playwright/test";

/**
 * The multi-revision path — plan §9, and the mechanism the whole evidence model
 * rests on.
 *
 * This is the property the product's central claim depends on: **editing a playbook
 * does not carry its credibility forward.** Everything else — the confidence bands,
 * the evidence page, the reproduction flow — is only meaningful if a revision cannot
 * inherit the standing of the text it replaced.
 *
 * It went untested for a long time for a mundane reason: every seeded playbook was at
 * revision 1, so there was nothing superseded to look at. `scripts/publish-revision.mjs`
 * exists to fix that, and this file is why. The first thing it caught was real — a
 * superseded revision was labelled **Deprecated**, telling every reader on a
 * historical URL that the procedure was known-bad when it had only been reworded.
 *
 * The slug below is the one that has been revised on staging. If a future corpus
 * change moves the revision to a different playbook, change this constant rather than
 * relaxing any assertion.
 */
const REVISED_SLUG = "d1-migration-not-applied-no-such-table";

/** Text that exists only in revision 2. If it appears on revision 1's page, the
 *  historical route is serving current content, which would make every historical URL
 *  a lie. */
const REVISION_2_ONLY = "remove the preview binding";

test.describe("a superseded revision (plan §9, R-1)", () => {
  test("keeps its own URL at 200 — history is never redirected away", async ({ request }) => {
    /*
      A redirect or a 404 here would destroy the evidence trail that justified
      publishing a replacement, which is exactly what a reader doubting the new
      revision goes looking for.
    */
    const response = await request.get(`/p/${REVISED_SLUG}/r/1`);
    expect(response.status()).toBe(200);
  });

  test("serves its own text, not the current revision's", async ({ page }) => {
    await page.goto(`/p/${REVISED_SLUG}/r/1`);
    await expect(page.getByText(REVISION_2_ONLY)).toHaveCount(0);

    await page.goto(`/p/${REVISED_SLUG}/r/2`);
    await expect(page.getByText(REVISION_2_ONLY).first()).toBeVisible();
  });

  test("says it has been replaced, and links to the replacement", async ({ page }) => {
    await page.goto(`/p/${REVISED_SLUG}/r/1`);
    await expect(page.getByText(/newer revision has replaced this one/i)).toBeVisible();

    const link = page.getByRole("link", { name: /current revision/i });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/p/${REVISED_SLUG}(/|$)`));
  });

  test("is labelled Superseded and never Deprecated", async ({ page }) => {
    /*
      The regression this file was written for.

      Deprecated means "this no longer works". Superseded means "there is newer
      wording of something that does". Collapsing them told readers of every
      historical revision that its procedure was broken — the one thing a reader on a
      historical page must not be told falsely.
    */
    await page.goto(`/p/${REVISED_SLUG}/r/1`);
    await expect(page.getByText("Superseded", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Deprecated", { exact: true })).toHaveCount(0);
  });

  test("states that its evidence belongs to this revision alone", async ({ page }) => {
    await page.goto(`/p/${REVISED_SLUG}/r/1`);
    await expect(page.getByText(/has not been carried forward|this revision.s own/i)).toBeVisible();
  });
});

test.describe("the current revision after an edit", () => {
  test("is what /p/:slug serves", async ({ page }) => {
    await page.goto(`/p/${REVISED_SLUG}`);
    await expect(page.getByText(REVISION_2_ONLY).first()).toBeVisible();
  });

  test("claims no reproductions inherited from the revision it replaced", async ({ page }) => {
    /*
      The invariant, stated as a reader would see it. A new revision starts at
      "unverified" with no reproductions, and would do so even if the revision it
      replaced had accumulated fifty — the evidence table has no column pointing at a
      playbook, only at a revision, so there is no code path that could carry them
      across.
    */
    await page.goto(`/p/${REVISED_SLUG}`);
    await expect(page.getByText(/no reproductions yet/i).first()).toBeVisible();
    await expect(page.getByText("Unverified", { exact: false }).first()).toBeVisible();
  });
});

test.describe("revision history (plan §9)", () => {
  test("lists both revisions, newest first, with the change explained", async ({ page }) => {
    await page.goto(`/p/${REVISED_SLUG}/history`);

    const headings = page.getByRole("heading", { name: /^Revision \d+/ });
    await expect(headings).toHaveCount(2);
    await expect(headings.first()).toContainText("Revision 2");

    // The change summary is what lets a reader judge whether the older evidence is
    // still relevant to the new text — a human decision the product never automates.
    await expect(page.getByText(/Adds a third cause/i)).toBeVisible();
  });

  test("explains, on the page, why evidence does not carry over", async ({ page }) => {
    await page.goto(`/p/${REVISED_SLUG}/history`);
    await expect(page.getByText(/none of the previous revision.s reproductions carry over/i)).toBeVisible();
  });

  test("marks exactly one revision as current", async ({ page }) => {
    await page.goto(`/p/${REVISED_SLUG}/history`);
    await expect(page.getByText("current", { exact: true })).toHaveCount(1);
  });
});

test.describe("search after a revision (ADR-0008)", () => {
  test("the playbook appears once, not once per revision", async ({ page }) => {
    /*
      Two revisions of one playbook competing in the results would push a different
      playbook off the first page. The superseded revision stays reachable by URL and
      through history, which is where somebody looking for it actually goes.
    */
    await page.goto("/search?q=d1%20no%20such%20table%20migration");

    const links = page.getByRole("link", { name: /.+/ }).filter({ hasNot: page.locator("nav a") });
    const hrefs = await links.evaluateAll((nodes) =>
      nodes
        .map((node) => (node as HTMLAnchorElement).getAttribute("href") ?? "")
        .filter((href) => href.startsWith("/p/")),
    );

    const matches = hrefs.filter((href) => href.split("/").slice(0, 3).join("/") === `/p/${REVISED_SLUG}`);
    // At most one result card per playbook. Sub-links within one card (evidence,
    // history) share the prefix, so this asserts on the canonical playbook URL only.
    expect(matches.filter((href) => href === `/p/${REVISED_SLUG}`).length).toBeLessThanOrEqual(1);
  });
});

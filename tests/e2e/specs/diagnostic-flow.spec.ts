import { test, expect, type Page } from "@playwright/test";

/**
 * The core loop: landing → search → playbook → /diagnose → a branch → a conclusion
 * → the report form.
 *
 * The path walked here is real and was traced against the deployed staging corpus
 * before this file was written (see `session-path.ts` for the URL encoding it
 * exercises): the D1 SQLITE_BUSY playbook's start node has a single "passed" edge,
 * its second node ("Check whether two writes are landing at the same moment") is
 * the one with a genuine three-way branch — Passed / Failed / "I can't tell" — and
 * following Passed all the way through reaches a "Resolved" conclusion.
 */

const SLUG = "d1-sqlite-busy-concurrent-writes";
const DIAGNOSE_URL = `/p/${SLUG}/diagnose`;

const N1_TITLE = "D1 write throws SQLITE_BUSY";
const N2_TITLE = "Check whether two writes are landing at the same moment";
const N3_TITLE = "Retry the write with backoff";
const N7_TITLE = "Re-run under the same concurrent load";

test.describe("split view layout (R-25, R-36)", () => {
  test("both panes sit side by side above 1024px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(DIAGNOSE_URL);
    await expect(page.getByRole("region", { name: "Steps taken" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Current step" })).toBeVisible();

    const direction = await splitContainerFlexDirection(page);
    expect(direction).toBe("row");
  });

  test("the panes stack below 1024px, territory first", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(DIAGNOSE_URL);

    const direction = await splitContainerFlexDirection(page);
    expect(direction).toBe("column-reverse");

    // "Territory first" (plan §1: Test → Result → Next Step is the phone flow) means
    // the current-step pane's box sits above the map's in the stacked layout, even
    // though the map is first in visual reading order of... no: DOM order has
    // territory second but `column-reverse` paints it first. Assert the rendered
    // position, not the DOM order.
    const territoryTop = await page
      .getByRole("region", { name: "Current step" })
      .evaluate((el) => el.getBoundingClientRect().top);
    const mapTop = await page
      .getByRole("region", { name: "Steps taken" })
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(territoryTop).toBeLessThan(mapTop);
  });
});

async function splitContainerFlexDirection(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const map = document.querySelector('section[aria-label="Steps taken"]');
    const parent = map?.parentElement ?? null;
    return parent ? getComputedStyle(parent).flexDirection : null;
  });
}

/**
 * Click an outcome link and wait for the resulting step's heading before returning.
 *
 * Each answer is a full page navigation via a plain `<a href>` — see
 * `session-path.ts` — but React Router still resolves it as a client-side
 * transition when JavaScript is available (loader fetch, then re-render). Firing
 * the *next* click immediately after `.click()` returns races that transition: the
 * next `getByRole("link", { name: "Passed" })` query can still resolve to the
 * *previous* step's identically-named link a moment before React unmounts it,
 * silently repeating the previous answer instead of advancing. Waiting for the
 * next heading closes that window.
 */
async function chooseOutcome(page: Page, outcome: string, nextHeading: string): Promise<void> {
  await page.getByRole("link", { name: outcome, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: nextHeading })).toBeVisible();
}

test("choosing an outcome advances the URL's steps parameter and shows the next step", async ({
  page,
}) => {
  await page.goto(DIAGNOSE_URL);
  await expect(page.getByRole("heading", { level: 2, name: N1_TITLE })).toBeVisible();

  await chooseOutcome(page, "Passed", N2_TITLE);

  await expect(page).toHaveURL(/steps=[^&]*n1\.passed/);
});

test('an "I can\'t tell" route exists on a test node (R-27)', async ({ page }) => {
  await page.goto(DIAGNOSE_URL);
  await chooseOutcome(page, "Passed", N2_TITLE);

  // Non-binary outcomes are required on a genuine test node — not a dead end.
  const unknown = page.getByRole("link", { name: "I can't tell" });
  await expect(unknown).toBeVisible();
  await expect(unknown).toHaveAttribute("href", /\.unknown/);
});

test('backtracking via "change this answer" truncates steps and later steps disappear (R-28)', async ({
  page,
}) => {
  await page.goto(DIAGNOSE_URL);
  await chooseOutcome(page, "Passed", N2_TITLE); // n1 -> n2
  await chooseOutcome(page, "Passed", N3_TITLE); // n2 -> n3
  await expect(page).toHaveURL(/n1\.passed.*n2\.passed/);

  // Two distinct labels nest here: the section is "Steps taken" (SplitView's
  // `mapLabel`), the `<ol>` inside it is "Steps you have taken" (DiagnosticTree).
  const stepsTaken = page.getByRole("list", { name: "Steps you have taken" });
  await expect(stepsTaken.getByText(N3_TITLE)).toBeVisible();

  const n2Item = stepsTaken.locator("li", { hasText: N2_TITLE });
  await n2Item.getByRole("link", { name: /Change this answer/ }).click();

  // The n2 step and everything after it is gone: the URL truncates to n1 only, the
  // territory pane goes back to asking n2's question, and n3 no longer appears
  // among the steps taken.
  await expect(page).toHaveURL(/steps=[^&]*n1\.passed$/);
  await expect(page.getByRole("heading", { level: 2, name: N2_TITLE })).toBeVisible();
  await expect(stepsTaken.getByText(N3_TITLE)).toHaveCount(0);
});

test("reaching a conclusion offers Worked/Partial/Failed and records nothing by itself", async ({
  page,
}) => {
  await page.goto(DIAGNOSE_URL);
  await chooseOutcome(page, "Passed", N2_TITLE); // n1 -> n2
  await chooseOutcome(page, "Passed", N3_TITLE); // n2 -> n3
  await chooseOutcome(page, "Passed", N7_TITLE); // n3 -> n7 (auto-advanced)
  await page.getByRole("link", { name: "Passed", exact: true }).click(); // n7 -> conclusion

  await expect(page.getByText("Did this work for you?")).toBeVisible();
  const worked = page.getByRole("link", { name: "Worked" });
  const partly = page.getByRole("link", { name: "Partly" });
  const failed = page.getByRole("link", { name: "Failed" });
  await expect(worked).toBeVisible();
  await expect(partly).toBeVisible();
  await expect(failed).toBeVisible();

  // The diagnose page itself must not have written anything: it is a GET-only
  // sequence of links (asserted independently by no-javascript.spec.ts), and
  // "Worked" here is a link to a *separate* report URL/form, not a same-page
  // one-click submit.
  await worked.click();
  await expect(page).toHaveURL(/\/report\?/);
  await expect(page).toHaveURL(/outcome=worked/);

  // A real, un-submitted form: the outcome is prefilled but nothing has been
  // recorded yet — the receipt ("Recorded") only appears after an actual POST.
  await expect(page.getByRole("heading", { level: 1, name: "What happened?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recorded" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /Worked/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "Submit the report" })).toBeVisible();
});

test("a destructive command's CodeBlock shows its safety class and requires acknowledgement before copy (plan §14)", async ({
  page,
}) => {
  // A different playbook: the D1 SQLITE_BUSY playbook's own commands are only
  // informational/state-changing. This one carries a genuinely destructive command,
  // confirmed by reading its rendered HTML before writing this test.
  await page.goto("/p/postgres-too-many-clients-connection-pool-exhausted");

  await expect(page.getByText("Destructive", { exact: true })).toBeVisible();

  const acknowledge = page.getByRole("checkbox", { name: /I understand what this command does/ });
  await expect(acknowledge).toBeVisible();
  await expect(acknowledge).not.toBeChecked();

  // The CodeBlock root: the one `div` that contains both the acknowledgement
  // checkbox and a "Copy" button — narrower ancestors (the header, the warning
  // block) each contain only one of the two, so the innermost `div` satisfying
  // both is the component's own wrapper.
  const codeBlock = page
    .locator("div")
    .filter({ has: page.getByRole("checkbox", { name: /I understand what this command does/ }) })
    .filter({ has: page.getByRole("button", { name: "Copy" }) })
    .last();

  const copyButton = codeBlock.getByRole("button", { name: "Copy" });
  await expect(copyButton).toBeDisabled();

  await acknowledge.check();
  await expect(copyButton).toBeEnabled();
});

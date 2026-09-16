import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

test.setTimeout(60000);

const WRITING_CONTENT_SOURCE = readFileSync(
  new URL("../docs/chapters/02-writing-content.md", import.meta.url),
  "utf8",
);

const CHURN_TOC = '.chapter-item-wrapper[data-chapter-idx="1"] .chapter-toc';

async function activeTarget(toc) {
  const active = toc.locator(".toc-item.active");
  if ((await active.count()) === 0) return null;
  return active.first().getAttribute("data-target");
}

/**
 * Click a spread of TOC entries while Shiki/diagrams/KaTeX are still rendering,
 * and assert the scroll-spy follows each click. The predecessors of this test
 * clicked every entry 2-6 times with a fixed wait after each click; the same
 * invariant is covered here by polling for the settled state instead.
 */
async function clicksSettleOnTheClickedEntry(page, viewport) {
  await page.setViewportSize(viewport);
  // Deliberately no wait after goto: click mid-render.
  await page.goto("/#writing-content");
  const toc = page.locator(CHURN_TOC);
  const items = toc.locator(".toc-item");
  await items.first().waitFor({ state: "visible", timeout: 30000 });

  const count = await items.count();
  expect(count).toBeGreaterThan(2);

  const order = [0, count - 1, 1, Math.floor(count / 2), 0];
  for (const i of order) {
    const item = items.nth(i);
    const target = await item.getAttribute("data-target");
    expect(target).toBeTruthy();
    await item.click();
    await expect.poll(() => activeTarget(toc), { timeout: 2000 }).toBe(target);
  }
}

test("TOC clicks during initial render churn settle on the clicked entry", async ({
  page,
}) => {
  await clicksSettleOnTheClickedEntry(page, { width: 1280, height: 720 });
});

test("TOC clicks settle on the clicked entry at a small viewport", async ({ page }) => {
  await clicksSettleOnTheClickedEntry(page, { width: 800, height: 550 });
});

test("TOC click navigates after an edit replaces headings in place", async ({ page }) => {
  await page.goto("/#writing-content");
  await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });

  // Add indexed terms across two editor flushes, with the ## Lists heading
  // between the edited paragraphs. The first flush rebuilds the TOC (no
  // prior fingerprint). The second flush replaces every block between the
  // first and last changed block — including that heading element — but it
  // does not rebuild the TOC, because the heading text is unchanged.
  const round1 = WRITING_CONTENT_SOURCE.replace(
    "Ordered lists use numbers:",
    "Ordered lists use ==zebratwo== numbers:",
  );
  const round2 = round1
    .replace(
      "headings are automatically numbered across the whole coursebook.",
      "headings are automatically numbered across the whole coursebook. ==zebraone==",
    )
    .replace("==zebratwo==", "==zebrathree==");
  expect(round2).not.toBe(round1);

  await page.locator("#toggleEditBtn").click();
  const editor = page.locator("#editor");
  await editor.waitFor({ state: "visible", timeout: 30000 });

  const typeAndSettle = async (markdown, proofId) => {
    await editor.locator(".cm-content").fill(markdown);
    // Wait past the 300ms onChange debounce plus the async enhance pass,
    // until the new index anchor proves the refreshed section has rendered.
    await page.waitForTimeout(900);
    await expect(page.locator(proofId)).toBeAttached({ timeout: 10000 });
  };
  await typeAndSettle(round1, "#idx-zebratwo");
  await typeAndSettle(round2, "#idx-zebraone");
  await expect(page.locator("#idx-zebrathree")).toBeAttached({ timeout: 10000 });

  const tocItem = page.locator('.toc-item[data-target="lists"]');
  await expect(tocItem).toBeVisible();
  await tocItem.click();

  await expect(page).toHaveURL(/#writing-content\/lists$/);
  await page.waitForFunction(
    () => {
      const pane = document.querySelector("#previewPane");
      const el = document.getElementById("lists");
      if (!pane || !el) return false;
      return el.getBoundingClientRect().top - pane.getBoundingClientRect().top < 120;
    },
    { timeout: 15000 },
  );
});

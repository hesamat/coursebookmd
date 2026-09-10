import { test, expect } from "@playwright/test";

test.setTimeout(60000);

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

import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 800, height: 550 } });

test("toc clicks at small viewport", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto("/#writing-content");
  const toc = page.locator('.chapter-item-wrapper[data-chapter-idx="1"] .chapter-toc');
  const items = toc.locator(".toc-item");
  await items.first().waitFor({ state: "visible", timeout: 30000 });
  const count = await items.count();

  const mismatches = [];
  for (let round = 0; round < 2; round++) {
    const order =
      round === 0 ? [...Array(count).keys()] : [...Array(count).keys()].reverse();
    for (const i of order) {
      await items.nth(i).click();
      await page.waitForTimeout(400);
      const active = toc.locator(".toc-item.active");
      const activeText = (await active.count())
        ? ((await active.textContent()) || "").trim()
        : "(none)";
      const want = (await items.nth(i).textContent()).trim();
      if (activeText !== want) {
        mismatches.push(`round${round} click[${i}] "${want}" -> "${activeText}"`);
      }
    }
  }
  console.log(
    mismatches.length
      ? `MISMATCHES (${mismatches.length}):\n` + mismatches.join("\n")
      : `all clicks OK at small viewport`,
  );
});

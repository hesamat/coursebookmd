import { test, expect } from "@playwright/test";

test("a table shares the reading measure with the prose, not the whole pane", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });
  await page
    .locator("#chapterList .chapter-item", { hasText: "Writing Content" })
    .click();

  const table = page.locator("#writing-content .table-scroll").first();
  const prose = page.locator("#writing-content p").first();
  await expect(table).toBeVisible();

  const [tableBox, proseBox] = await Promise.all([
    table.boundingBox(),
    prose.boundingBox(),
  ]);

  // Width and position both matter: a table wider than the column, or one that
  // is the right width but left-aligned against it, is the regression this
  // guards.
  expect(Math.abs(tableBox.width - proseBox.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(tableBox.x - proseBox.x)).toBeLessThanOrEqual(1);
  // Still inside the pane, and the pane itself never gains a scrollbar.
  const pane = await page.locator("#previewPane").evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
  }));
  expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth + 1);
});

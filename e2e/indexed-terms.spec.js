import { test, expect } from "@playwright/test";

test.setTimeout(120000);

async function openCoursebookAt(page, url) {
  await page.goto(url);
  await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });
}

test.describe("Indexed terms", () => {
  test("terms render with a dotted underline and appear in the index", async ({
    page,
  }) => {
    await openCoursebookAt(page, "/#writing-content");

    const term = page.locator("#writing-content .idx").first();
    await expect(term).toHaveText("indexed terms");

    // The sidebar exposes the generated index section.
    await expect(page.locator(".index-nav-item")).toBeVisible();
    const decoration = await term.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return `${style.textDecorationLine} ${style.textDecorationStyle}`;
    });
    expect(decoration).toContain("underline dotted");

    // The generated index section exists and lists the terms.
    const indexSection = page.locator("#index");
    await expect(indexSection).toBeAttached();
    const links = indexSection.locator(".idx-link");
    const linkTexts = await links.allTextContents();
    expect(linkTexts).toContain("indexed terms");
    expect(linkTexts).toContain("index");
  });

  test("an index link navigates to the term's chapter and heading", async ({ page }) => {
    await openCoursebookAt(page, "/#index");
    await expect(page.locator("#index")).toBeVisible();

    const link = page.locator('#index .idx-link[data-target="idx-indexed-terms"]');
    await expect(link).toBeVisible();
    await link.click();

    // The term's chapter becomes active and the term scrolls into view.
    await expect(page.locator("#writing-content")).toBeVisible();
    await expect(page.locator("#idx-indexed-terms")).toBeVisible();
    await page.waitForFunction(() => {
      const pane = document.querySelector("#previewPane");
      const term = document.getElementById("idx-indexed-terms");
      if (!pane || !term) return false;
      const rect = term.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= pane.clientHeight;
    });
    expect(await page.evaluate(() => location.hash)).toContain("idx-indexed-terms");
  });

  test("index anchors survive an editor live re-render", async ({ page }) => {
    await openCoursebookAt(page, "/#writing-content");

    await page.locator("#toggleEditBtn").click();
    const editor = page.locator("#editor");
    await editor.waitFor({ state: "visible", timeout: 30000 });

    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("A new ==zebra mango== term.");
    await page.waitForTimeout(600);

    const indexSection = page.locator("#index");
    await expect(indexSection).toBeAttached();
    await expect(
      indexSection.locator('.idx-link[data-target="idx-zebra-mango"]'),
    ).toHaveCount(1);
    // The new anchor id exists exactly once across the whole content.
    await expect(page.locator("#idx-zebra-mango")).toHaveCount(1);
  });
});

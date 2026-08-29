import { test, expect } from "@playwright/test";

test.setTimeout(120000);

async function openCoursebookAt(page, url) {
  await page.goto(url);
  await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });
}

test.describe("Indexed terms", () => {
  test("terms render with a dotted underline and all occurrences appear in the index", async ({
    page,
  }) => {
    await openCoursebookAt(page, "/#writing-content");

    const section = page.locator("#writing-content");
    const term = section.locator(".idx").first();
    await expect(term).toHaveText("lists");

    // The sidebar exposes the generated index section.
    await expect(page.locator(".index-nav-item")).toBeVisible();
    const decoration = await term.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return `${style.textDecorationLine} ${style.textDecorationStyle} ${style.textDecorationColor}`;
    });
    expect(decoration).toContain("underline dotted");

    // The generated index section exists and lists every term.
    const indexSection = page.locator("#index");
    await expect(indexSection).toBeAttached();
    const termTexts = await indexSection.locator(".index-term").allTextContents();
    expect(termTexts).toEqual(["command flags", "file names", "lists", "nested items"]);

    // "lists" occurs in two sections: the entry carries two occurrence links.
    const listsEntry = indexSection.locator(".index-item", { hasText: "lists" });
    const occLinks = listsEntry.locator(".idx-link");
    await expect(occLinks).toHaveCount(2);
    await expect(occLinks.nth(0)).toHaveText("2.2");
    await expect(occLinks.nth(1)).toHaveText("2.4");
    await expect(occLinks.nth(0)).toHaveAttribute("data-target", "idx-lists");
    await expect(occLinks.nth(1)).toHaveAttribute("data-target", "idx-lists-2");
  });

  test("an index link navigates to the occurrence and flashes the term", async ({
    page,
  }) => {
    await openCoursebookAt(page, "/#index");
    await expect(page.locator("#index")).toBeVisible();

    // The second "lists" occurrence lives in the Tables section.
    const link = page.locator('#index .idx-link[data-target="idx-lists-2"]');
    await expect(link).toBeVisible();
    await link.click();

    // The term's chapter becomes active and the term scrolls into view.
    await expect(page.locator("#writing-content")).toBeVisible();
    await expect(page.locator("#idx-lists-2")).toBeVisible();
    await page.waitForFunction(() => {
      const pane = document.querySelector("#previewPane");
      const term = document.getElementById("idx-lists-2");
      if (!pane || !term) return false;
      const rect = term.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= pane.clientHeight;
    });
    expect(await page.evaluate(() => location.hash)).toContain("idx-lists-2");

    // The target term flashes once the scroll settles, so it is easy to spot.
    await expect(page.locator("#idx-lists-2")).toHaveClass(/idx-highlight/, {
      timeout: 3000,
    });
    // Hovering any occurrence shows a CSS tooltip with all index locations.
    await expect(page.locator("#idx-lists-2")).toHaveAttribute(
      "data-locations",
      "2.2, 2.4",
    );
  });

  test("a deep link to a term anchor also flashes it", async ({ page }) => {
    await openCoursebookAt(page, "/#writing-content/idx-lists");

    await page.waitForFunction(() => {
      const pane = document.querySelector("#previewPane");
      const term = document.getElementById("idx-lists");
      if (!pane || !term) return false;
      const rect = term.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= pane.clientHeight;
    });
    await expect(page.locator("#idx-lists")).toHaveClass(/idx-highlight/, {
      timeout: 3000,
    });
    await expect(page.locator("#idx-lists")).toHaveAttribute(
      "data-locations",
      "2.2, 2.4",
    );
  });

  test("hovering a term shows the index-locations tooltip", async ({ page }) => {
    await openCoursebookAt(page, "/#writing-content");

    const term = page.locator("#writing-content .idx").first();
    await expect(term).toBeVisible();
    await term.hover();

    // The ::after tooltip content comes from the data-locations attribute.
    const tooltip = await term.evaluate((el) => {
      const style = window.getComputedStyle(el, "::after");
      return { content: style.content, visibility: style.visibility };
    });
    expect(tooltip.content).toContain("In the index: 2.2, 2.4");
    expect(tooltip.visibility).toBe("visible");
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

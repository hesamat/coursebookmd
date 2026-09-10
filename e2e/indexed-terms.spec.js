import { test, expect } from "@playwright/test";

test.setTimeout(120000);

async function openCoursebookAt(page, url) {
  await page.goto(url);
  await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });
}

test.describe("Indexed terms", () => {
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
    // Hovering an occurrence tooltips with its OTHER locations only.
    await expect(page.locator("#idx-lists-2")).toHaveAttribute("data-locations", "2.2");
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

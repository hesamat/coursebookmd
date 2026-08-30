import { test, expect } from "@playwright/test";

test.setTimeout(120000);

test.describe("Link preview", () => {
  test("pre-cooked Wikipedia preview appears instantly on hover", async ({ page }) => {
    let wikiRequestCount = 0;
    await page.route("https://en.wikipedia.org/**", (route) => {
      wikiRequestCount += 1;
      route.continue();
    });

    await page.goto("/");
    await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });

    await page
      .locator("#chapterList .chapter-item", { hasText: "Writing Content" })
      .first()
      .click();
    await expect(page.locator("#writing-content")).toBeVisible();

    const link = page.locator('a[href="https://en.wikipedia.org/wiki/Cat"]');
    await expect(link).toBeVisible();
    await link.hover();

    const popup = page.locator(".link-preview");
    await expect(popup).toBeVisible({ timeout: 1000 });
    await expect(popup.locator(".link-preview__title")).toHaveText("Cat");

    expect(wikiRequestCount).toBe(0);
  });
});

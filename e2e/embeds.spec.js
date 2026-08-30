import { test, expect } from "@playwright/test";

test.describe("Embedded content", () => {
  test("external iframes load on click, srcdoc frames render inline", async ({
    page,
  }) => {
    await page.goto("/#rich-content");
    const section = page.locator("#rich-content");
    await expect(section).toBeVisible();

    // External embeds start as click-to-load facades — no third-party frame
    // is fetched until the reader clicks.
    const facade = section.locator(".embed-facade").first();
    await expect(facade).toBeVisible();
    await expect(section.locator("iframe[src]")).toHaveCount(0);

    // srcdoc iframes are self-contained and render inline as before.
    await expect(section.locator("iframe[srcdoc]")).toHaveCount(1);

    // Clicking the facade swaps in the real embed.
    await facade.locator(".embed-facade__play").click();
    await expect(section.locator("iframe[src]").first()).toBeVisible();
  });
});

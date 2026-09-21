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

  test("same-workbook chapter link shows a preview on hover", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });

    // The landing page's chapter list links are rewritten to #chapter-slug
    // hash links; hovering one previews the target chapter locally.
    const link = page.locator('#overview a[href="#getting-started"]');
    await expect(link).toBeVisible();
    await link.hover();

    const popup = page.locator(".link-preview");
    await expect(popup).toBeVisible({ timeout: 1000 });
    await expect(popup).toHaveClass(/link-preview--internal/);
    await expect(popup.locator(".link-preview__title")).toHaveText("Getting Started");
    await expect(popup.locator(".link-preview__summary")).toContainText(
      "turns a folder of Markdown files",
    );
  });

  test("index locator link previews the subsection containing the term", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });

    // The index lives in its own coursebook section: open it via the Index
    // nav entry, then hover a locator. Index entries link each term to its
    // ==occurrence== span (#idx-… ids); hovering one previews the subsection
    // the occurrence lives in — the ==index== term sits under "Indexed
    // Terms".
    await page.locator("#chapterList .index-nav-item").click();
    await expect(page.locator("#index")).toBeVisible();

    const link = page.locator('a[href="#idx-index"]');
    await expect(link).toBeVisible();
    await link.hover();

    const popup = page.locator(".link-preview");
    await expect(popup).toBeVisible({ timeout: 1000 });
    await expect(popup).toHaveClass(/link-preview--internal/);
    await expect(popup.locator(".link-preview__title")).toHaveText("Indexed terms");
  });
});

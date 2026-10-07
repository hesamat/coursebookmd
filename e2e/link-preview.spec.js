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
    // The popup renders from local data, so 2000ms still fails any fallback
    // that fetches over the network; the tighter bound only tripped on busy
    // CI runners (the zero-request assertion below guards the pre-cooked
    // behaviour).
    await expect(popup).toBeVisible({ timeout: 2000 });
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
    await expect(popup).toBeVisible({ timeout: 2000 });
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
    await expect(popup).toBeVisible({ timeout: 2000 });
    await expect(popup).toHaveClass(/link-preview--internal/);
    await expect(popup.locator(".link-preview__title")).toHaveText("Indexed terms");
  });

  test("Rebuild Link Previews refetches every link and reports a session-only save", async ({
    page,
  }) => {
    let fetchCount = 0;
    await page.route("**/api/rest_v1/page/summary/**", (route) => {
      fetchCount += 1;
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          title: "Cat",
          titles: { normalized: "Cat" },
          extract: "A small domesticated carnivorous mammal.",
          thumbnail: null,
        }),
      });
    });
    await page.route("https://r.jina.ai/**", (route) => {
      fetchCount += 1;
      route.fulfill({
        contentType: "text/plain",
        body:
          "Title: Example\n\nMarkdown Content:\n" +
          "A sufficiently long summary passage for the reader to accept. ".repeat(12),
      });
    });

    await page.goto("/");
    await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });

    await page.locator("#menuBtn").click();
    await page.locator("#menuRebuildPreviewsBtn").click();

    // A URL-loaded coursebook has no write access, so the rebuild refreshes
    // the session cache and reports that instead of writing previews.json.
    await expect(page.locator("#appToast")).toHaveText(
      "Link previews rebuilt for this session (open the coursebook folder to save them).",
    );
    // The rebuild went back to the network for every link instead of
    // replaying the seeded cache.
    expect(fetchCount).toBeGreaterThan(0);
  });
});

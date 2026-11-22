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

  test("python builtin mention previews the local docs entry on hover", async ({
    page,
  }) => {
    let docsRequestCount = 0;
    await page.route("https://docs.python.org/**", (route) => {
      docsRequestCount += 1;
      route.continue();
    });
    await page.route("**/builtin-hover-fixture.md", (route) => {
      route.fulfill({
        contentType: "text/markdown",
        body: [
          "# Built-in functions",
          "",
          "The `len` function counts items, so `len(name)` is a number.",
          "",
          "A plain `subtotal` mention stays unlinked.",
          "",
          "Prefer `sorted` and `print` with explicit keyword settings when formatting.",
          "",
          "`zip` pairs items from two sequences.",
          "",
        ].join("\n"),
      });
    });

    await page.goto("/?coursebook=builtin-hover-fixture.md");
    await page.locator("#content h1").waitFor({ state: "visible", timeout: 30000 });

    // Bare name and call form both link; a non-builtin chip stays plain.
    await expect(page.locator("a.doc-card")).toHaveCount(5);
    await expect(page.locator('a.doc-card[href$="#len"]')).toHaveCount(2);
    await expect(page.locator('a.doc-card[href$="#print"]')).toHaveCount(1);
    await expect(page.locator('a.doc-card[href$="#sorted"]')).toHaveCount(1);
    await expect(page.locator('a.doc-card[href$="#zip"]')).toHaveCount(1);
    await expect(
      page.locator("code", { hasText: "subtotal" }).locator("xpath=ancestor::a"),
    ).toHaveCount(0);

    const link = page.locator("a.doc-card").first();
    await link.hover();

    const popup = page.locator(".link-preview");
    await expect(popup).toBeVisible({ timeout: 2000 });
    await expect(popup).toHaveClass(/link-preview--docs/);
    // The official signature form, with its structural marker.
    await expect(popup.locator(".link-preview__sig")).toHaveText("len(object, /)");
    await expect(popup.locator(".link-preview__sig-name")).toHaveText("len");
    await expect(popup.locator(".link-preview__summary")).toContainText(
      "number of items",
    );
    await expect(popup.locator(".link-preview__domain")).toHaveText("docs.python.org");
    // Generated cards carry no example, so the example line stays hidden.
    await expect(popup.locator(".link-preview__example")).toBeHidden();
    // The provider serves the card from the local dataset; docs.python.org
    // is never fetched.
    expect(docsRequestCount).toBe(0);

    // A builtin with keyword defaults shows them pulled out in the strip.
    // The len card covers the next mention and stays open under the
    // pointer, so park the pointer somewhere neutral and let it hide first.
    await page.mouse.move(10, 400);
    await expect(popup).toBeHidden({ timeout: 2000 });
    await page.locator('a.doc-card[href$="#print"]').hover();
    await expect(popup).toBeVisible({ timeout: 2000 });
    await expect(popup.locator(".link-preview__sig")).toHaveText(
      "print(*objects, sep=' ', end='\\n', file=None, flush=False)",
    );
    await expect(
      popup.locator(".link-preview__sig-default").filter({ hasText: "False" }),
    ).toHaveCount(1);
    // A starred parameter is a parameter, not a structural marker.
    await expect(popup.locator(".link-preview__sig-marker")).toHaveCount(0);

    // sorted shows the bare `/` and `*` markers dimmed, plus its defaults.
    await page.mouse.move(10, 400);
    await expect(popup).toBeHidden({ timeout: 2000 });
    await page.locator('a.doc-card[href$="#sorted"]').hover();
    await expect(popup).toBeVisible({ timeout: 2000 });
    await expect(popup.locator(".link-preview__sig")).toHaveText(
      "sorted(iterable, /, *, key=None, reverse=False)",
    );
    await expect(popup.locator(".link-preview__sig-marker")).toHaveCount(2);
    await expect(popup.locator(".link-preview__sig-default")).toHaveCount(2);

    // zip's generated card carries its signature and no invented example.
    await page.mouse.move(10, 400);
    await expect(popup).toBeHidden({ timeout: 2000 });
    await page.locator('a.doc-card[href$="#zip"]').hover();
    await expect(popup).toBeVisible({ timeout: 2000 });
    await expect(popup.locator(".link-preview__sig")).toHaveText(
      "zip(*iterables, strict=False)",
    );
    await expect(popup.locator(".link-preview__example")).toBeHidden();
  });

  test("tapping a builtin mention on a phone shows the docs card instead of navigating", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    let docsRequestCount = 0;
    await context.route("https://docs.python.org/**", (route) => {
      docsRequestCount += 1;
      route.continue();
    });
    await context.route("**/builtin-hover-fixture.md", (route) => {
      route.fulfill({
        contentType: "text/markdown",
        body: [
          "# Built-in functions",
          "",
          "The `len` function counts items, so `len(name)` is a number.",
          "",
          "`zip` pairs items from two sequences.",
          "",
        ].join("\n"),
      });
    });

    const page = await context.newPage();
    await page.goto("/?coursebook=builtin-hover-fixture.md");
    await page.locator("#content h1").waitFor({ state: "visible", timeout: 30000 });

    const popup = page.locator(".link-preview");
    const lenLink = page.locator('a.doc-card[href$="#len"]').first();
    await lenLink.tap();

    // The tap reveals the local signature card; it must not follow the
    // anchor to the online docs.
    await expect(popup).toBeVisible({ timeout: 2000 });
    await expect(popup).toHaveClass(/link-preview--docs/);
    await expect(popup.locator(".link-preview__sig")).toHaveText("len(object, /)");
    expect(docsRequestCount).toBe(0);
    expect(page.url()).toContain("builtin-hover-fixture.md");

    // A second tap on the same chip dismisses the card.
    await lenLink.tap();
    await expect(popup).toBeHidden({ timeout: 2000 });

    // Tapping another chip switches the card.
    await page.locator('a.doc-card[href$="#zip"]').tap();
    await expect(popup).toBeVisible({ timeout: 2000 });
    await expect(popup.locator(".link-preview__sig")).toHaveText(
      "zip(*iterables, strict=False)",
    );

    // A tap on plain content dismisses the card.
    await page.locator("#content h1").tap();
    await expect(popup).toBeHidden({ timeout: 2000 });

    await context.close();
  });
});

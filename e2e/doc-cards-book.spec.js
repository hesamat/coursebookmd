import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test.setTimeout(120000);

const COURSEBOOK_URL = "/e2e/fixtures/doc-cards-book/coursebook.md";

test.describe("Author-defined doc cards", () => {
  // One hover interaction per test: each opens a fresh page so the first
  // hover on a chip is never shadowed by a previous card's popup state.
  async function openBasicsChapter(page) {
    await page.goto(`/?coursebook=${encodeURIComponent(COURSEBOOK_URL)}`);
    await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });
    await page
      .locator("#chapterList .chapter-item", { hasText: "Basics" })
      .first()
      .click();
    await expect(page.locator("#basics")).toHaveClass(/active/);
  }

  test("the disabled python pack leaves mentions plain and author chips render", async ({
    page,
  }) => {
    await openBasicsChapter(page);
    // packs=none: the python mention stays plain code, author chips render.
    const lenMention = page.locator("#basics code", { hasText: "len" }).first();
    await expect(lenMention).toBeVisible();
    expect(await lenMention.evaluate((el) => el.closest("a.doc-card") === null)).toBe(
      true,
    );
    await expect(page.locator("a.doc-card")).toHaveCount(3);
    // The URL-less entry anchors to the glossary chapter's own section slug.
    await expect(page.locator('a.doc-card[data-doc-card="book:double"]')).toHaveAttribute(
      "href",
      "#function-reference",
    );
  });

  test("hovering an external author chip shows its signature card offline", async ({
    page,
  }) => {
    await page.route("https://www.postgresql.org/**", (route) => {
      route.fulfill({ status: 500, body: "must never be fetched" });
    });
    await openBasicsChapter(page);

    const countChip = page.locator('a.doc-card[data-doc-card="book:count"]');
    await expect(countChip).toBeVisible();
    await countChip.hover();
    const popup = page.locator(".link-preview");
    await expect(popup).toBeVisible({ timeout: 2000 });
    await expect(popup).toHaveClass(/link-preview--docs/);
    // COUNT has two signature lines; each renders as its own strip row.
    const sigs = popup.locator(".link-preview__sig");
    await expect(sigs).toHaveCount(2);
    await expect(sigs.first()).toHaveText("COUNT(*)");
    await expect(sigs.nth(1)).toHaveText("COUNT(expression)");
    await expect(popup.locator(".link-preview__domain")).toHaveText("www.postgresql.org");
  });

  test("hovering a URL-less author chip shows its term card in this window", async ({
    page,
  }) => {
    await openBasicsChapter(page);

    const doubleChip = page.locator('#basics a.doc-card[data-doc-card="book:double"]');
    await doubleChip.hover();
    const popup = page.locator(".link-preview");
    await expect(popup).toBeVisible({ timeout: 2000 });
    await expect(popup).not.toHaveClass(/link-preview--docs/);
    await expect(popup.locator(".link-preview__title")).toHaveText("double");
    await expect(popup.locator(".link-preview__domain")).toHaveText("This workbook");
    // In-window navigation: no new-tab treatment on the title link.
    await expect(popup.locator(".link-preview__title")).not.toHaveAttribute(
      "target",
      /./,
    );
  });

  test("tapping a chip on a touch device shows the card instead of navigating", async ({
    browser,
  }) => {
    const touchContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const touchPage = await touchContext.newPage();
    await touchPage.goto(`/?coursebook=${encodeURIComponent(COURSEBOOK_URL)}`);
    await expect(touchPage.locator("#chapterNav")).toBeVisible({ timeout: 60000 });
    // On phones the chapter list lives in the drawer, which starts closed:
    // open it before picking a chapter (it closes again after navigation).
    await touchPage.locator("#sidebarToggleBtn").click();
    await touchPage
      .locator("#chapterList .chapter-item", { hasText: "Basics" })
      .first()
      .click();
    await expect(touchPage.locator("#basics")).toHaveClass(/active/);
    const touchChip = touchPage.locator('a.doc-card[data-doc-card="book:double"]');
    await touchChip.scrollIntoViewIfNeeded();
    await touchChip.tap();
    await expect(touchPage.locator(".link-preview")).toBeVisible({ timeout: 2000 });
    await expect(touchPage.locator(".link-preview__title")).toHaveText("double");
    await touchContext.close();
  });

  test("the exported book embeds the author registry and resolves its cards", async ({
    page,
  }, testInfo) => {
    await page.goto(`/?coursebook=${encodeURIComponent(COURSEBOOK_URL)}`);
    await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });

    await page.locator("#menuBtn").click();
    const downloadPromise = page.waitForEvent("download", { timeout: 90000 });
    await page.locator("#menuExportHtmlBtn").click();
    const download = await downloadPromise;
    const targetPath = testInfo.outputPath("doc-cards-export.html");
    await download.saveAs(targetPath);

    const html = await fs.readFile(targetPath, "utf8");
    // Author chips carry registry ids without baked preview data, and the
    // payload embeds the author registry.
    const chipTag = html.match(/<a [^>]*data-doc-card="book:count"[^>]*>/);
    expect(chipTag).not.toBeNull();
    expect(chipTag[0]).not.toContain("data-preview");
    expect(html).toContain('"docCards":{"entries":');
    expect(html).toContain('"book:count"');
    // packs=none: no python entries in the embedded registry.
    expect(html).not.toContain('"python:len"');

    // The exported viewer rehydrates the registry and resolves the author's
    // cards offline.
    await page.goto(`file://${targetPath}#basics`);
    await expect(page.locator("#basics")).toHaveClass(/active/, { timeout: 30000 });
    const chip = page.locator('#basics a[data-doc-card="book:count"]');
    await expect(chip).toBeVisible();
    await chip.hover();
    const popup = page.locator(".link-preview");
    await expect(popup).toBeVisible({ timeout: 2000 });
    const exportSigs = popup.locator(".link-preview__sig");
    await expect(exportSigs).toHaveCount(2);
    await expect(exportSigs.first()).toHaveText("COUNT(*)");
    await expect(exportSigs.nth(1)).toHaveText("COUNT(expression)");

    // The URL-less card navigates to the glossary chapter inside the export.
    await page.mouse.move(10, 400);
    await expect(popup).toBeHidden({ timeout: 2000 });
    await page.locator('a[data-doc-card="book:double"]').click();
    await expect(page.locator("#function-reference")).toBeVisible({ timeout: 5000 });
  });
});

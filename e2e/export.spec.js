import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test.setTimeout(120000);

test.describe("HTML export", () => {
  test("Export HTML downloads a standalone document containing chapter content", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });

    await page.locator("#menuBtn").click();
    const exportBtn = page.locator("#menuExportHtmlBtn");
    await expect(exportBtn).toBeVisible();

    const downloadPromise = page.waitForEvent("download", { timeout: 90000 });
    await exportBtn.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^coursebookmd-.*\.html$/);

    const targetPath = testInfo.outputPath("exported-coursebook.html");
    await download.saveAs(targetPath);
    const html = await fs.readFile(targetPath, "utf8");

    // A complete, standalone HTML document with an inline title
    expect(html.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
    expect(html).toMatch(/<title>[^<]*User Guide<\/title>/);
    expect(html).toContain('id="coursebook-data"');

    // No external stylesheet references: all CSS is inlined
    expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/i);

    // Every section of the coursebook is embedded
    for (const id of [
      "overview",
      "getting-started",
      "writing-content",
      "rich-content",
      "present-and-export",
      "image-credits",
    ]) {
      expect(html).toContain(`<section id="${id}"`);
    }

    // The front-matter link to image-credits.md is rewritten to an in-page
    // hash link instead of pointing at a file that does not exist next to
    // the exported HTML.
    expect(html).toContain('href="#image-credits"');
    expect(html).not.toContain('href="image-credits.md"');
    expect(html).toContain("original project assets");

    // Chapter body content made it into the export
    expect(html).toContain("What is a coursebook?");
    expect(html).toContain("Opening a coursebook");
  });

  test("the exported file boots as a standalone viewer with working navigation", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });

    await page.locator("#menuBtn").click();
    const downloadPromise = page.waitForEvent("download", { timeout: 90000 });
    await page.locator("#menuExportHtmlBtn").click();
    const download = await downloadPromise;

    const targetPath = testInfo.outputPath("standalone-export.html");
    await download.saveAs(targetPath);

    await page.goto(`file://${targetPath}`);

    // The export runtime boots: sidebar is built and the landing page shows.
    await expect(page.locator("#chapterList .chapter-item-wrapper")).toHaveCount(6, {
      timeout: 30000,
    });
    await expect(page.locator("#overview")).toHaveClass(/active/);

    // Chapter navigation works inside the standalone document.
    await page
      .locator("#chapterList .chapter-item", { hasText: "Writing Content" })
      .click();
    await expect(page.locator("#writing-content")).toHaveClass(/active/);
    await expect(page).toHaveURL(/#writing-content$/);
  });

  test("D2 diagram styles are consolidated in the exported document", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });

    // Two identical-theme D2 diagrams on the landing page.
    await page.locator("#toggleEditBtn").click();
    const editor = page.locator("#editor");
    await editor.waitFor({ state: "visible", timeout: 30000 });
    const markdown = [
      "# Diagrams",
      "",
      "```d2",
      "a -> b",
      "```",
      "",
      "```d2",
      "c -> d",
      "```",
    ].join("\n");
    await editor.locator(".cm-content").fill(markdown);

    const content = page.locator("#content");
    await content
      .locator(".d2-diagram svg.d2-svg")
      .first()
      .waitFor({ state: "attached", timeout: 60000 });
    // The live app pre-renders every section's diagrams, so the rich-content
    // chapter's two diagrams make this exactly four. The exported overview
    // section still contains only the landing page's two editor diagrams.
    await expect(content.locator(".d2-diagram svg.d2-svg")).toHaveCount(4);

    await page.locator("#menuBtn").click();
    const downloadPromise = page.waitForEvent("download", { timeout: 90000 });
    await page.locator("#menuExportHtmlBtn").click();
    const download = await downloadPromise;
    const targetPath = testInfo.outputPath("d2-consolidated-export.html");
    await download.saveAs(targetPath);

    await page.goto(`file://${targetPath}`);
    const overviewSvgs = page.locator("#overview .d2-diagram svg.d2-svg");
    await expect(overviewSvgs).toHaveCount(2);

    // No per-SVG stylesheets remain; the CSS is hoisted into the head.
    await expect(page.locator(".d2-diagram svg style")).toHaveCount(0);
    const hoisted = await page.evaluate(() =>
      Array.from(document.querySelectorAll("style"))
        .map((el) => el.textContent)
        .join("\n"),
    );
    // Theme rules from both diagrams are merged into grouped selectors
    // (".d2-<salt-a> .fill-Nx,.d2-<salt-b> .fill-Nx{...}", compacted).
    expect(hoisted).toMatch(/\.d2-\d+ \.fill-N\d+,\s?\.d2-\d+ \.fill-N\d+\{/);
    // Per-diagram @font-face data survives the consolidation.
    expect(hoisted).toContain("font-woff");

    // Both diagrams remain fully styled by the consolidated block (same
    // computed fill, not the unstyled default).
    const fills = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll("#overview .d2-diagram svg.d2-svg"),
      ).map((svg) => {
        const el = svg.querySelector("[class*='fill-']");
        return el ? getComputedStyle(el).fill : null;
      });
    });
    expect(fills).toHaveLength(2);
    expect(fills[0]).toBeTruthy();
    expect(fills[0]).not.toBe("none");
    expect(fills[0]).toBe(fills[1]);
  });

  test("the exported shell renders header, left sidebar, and actions", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });

    await page.locator("#menuBtn").click();
    const downloadPromise = page.waitForEvent("download", { timeout: 90000 });
    await page.locator("#menuExportHtmlBtn").click();
    const download = await downloadPromise;
    const targetPath = testInfo.outputPath("shell-export.html");
    await download.saveAs(targetPath);

    await page.goto(`file://${targetPath}`);
    await expect(page.locator("#chapterList .chapter-item-wrapper").first()).toBeVisible({
      timeout: 30000,
    });

    // Header with the coursebook title and a sidebar toggle.
    await expect(page.locator(".export-header__title")).toContainText("User Guide");
    await expect(page.locator("#sidebarToggleBtn")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // Sidebar sits LEFT of the content column.
    const sidebarBox = await page.locator("#tocPane").boundingBox();
    const contentBox = await page.locator("#content").boundingBox();
    expect(sidebarBox.x).toBeLessThan(contentBox.x);

    // Floating actions bottom-right: present + theme — the same cluster
    // (and ids) as the live app.
    await expect(page.locator("#presentBtn")).toBeVisible();
    await expect(page.locator("#themeToggleBtn")).toBeVisible();
    const actionsBox = await page.locator(".action-cluster").boundingBox();
    expect(actionsBox.x + actionsBox.width).toBeGreaterThan(1000);

    // The header toggle slides the sidebar almost fully out of view; the
    // toggle itself stays put in the header (no peek-out tab) and clicking
    // it again restores the sidebar.
    await page.locator("#sidebarToggleBtn").click();
    await expect(page.locator("#sidebarToggleBtn")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.locator("#tocPane .toc-pane__title")).toBeHidden();
    // The panel slides fully out of view — no peek tab remains. The slide
    // is animated, so poll until the transition settles.
    await expect
      .poll(async () => {
        const closedBox = await page.locator("#tocPane").boundingBox();
        return closedBox.x + closedBox.width;
      })
      .toBeLessThanOrEqual(0);
    await expect(page.locator(".export-header #sidebarToggleBtn")).toBeVisible();
    await page.locator("#sidebarToggleBtn").click();
    await expect(page.locator("#tocPane .toc-pane__title")).toBeVisible();

    // Print: the whole book, sequential, no chrome.
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("#overview")).toBeVisible();
    await expect(page.locator("#getting-started")).toBeVisible();
    await expect(page.locator("#tocPane")).toBeHidden();
    await expect(page.locator(".action-cluster")).toBeHidden();
    await page.emulateMedia({ media: null });
  });

  test("the exported header search finds and jumps to other chapters", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });

    await page.locator("#menuBtn").click();
    const downloadPromise = page.waitForEvent("download", { timeout: 90000 });
    await page.locator("#menuExportHtmlBtn").click();
    const download = await downloadPromise;
    const targetPath = testInfo.outputPath("search-export.html");
    await download.saveAs(targetPath);

    await page.goto(`file://${targetPath}`);
    await expect(page.locator("#chapterList .chapter-item-wrapper").first()).toBeVisible({
      timeout: 30000,
    });

    // Start on the overview; the searched text lives in a later chapter.
    await expect(page.locator("#overview")).toBeVisible();

    await page.locator("#searchInput").fill("Opening a coursebook");
    const firstResult = page.locator(".export-search__item").first();
    await expect(firstResult).toBeVisible();
    await expect(firstResult.locator(".export-search__chapter")).toContainText(
      /Getting Started/i,
    );
    await expect(firstResult.locator(".export-search__mark")).toContainText(
      "Opening a coursebook",
    );

    await firstResult.click();

    // The hit's chapter becomes active and the hit text is scrolled into
    // view; the dropdown closes.
    await expect(page.locator("#searchResults")).toBeHidden();
    const activeItem = page.locator("#chapterList .chapter-item.active");
    await expect(activeItem).toContainText(/Getting Started/i);
    await expect(page.locator("#getting-started")).toBeVisible();
    const hitText = page
      .locator("#getting-started")
      .getByText("Opening a coursebook")
      .first();
    await expect(hitText).toBeVisible();
    // The smooth scroll to the hit needs a moment to settle before the
    // viewport position is meaningful.
    await expect
      .poll(async () => {
        const textBox = await hitText.boundingBox();
        const paneBox = await page.locator("#previewPane").boundingBox();
        return textBox.y > paneBox.y && textBox.y < paneBox.y + paneBox.height;
      })
      .toBe(true);

    // A nonsense query shows the empty state; Escape closes the dropdown.
    await page.locator("#searchInput").fill("zzzqqqxxx");
    await expect(page.locator(".export-search__empty")).toContainText("No results");
    await page.locator("#searchInput").press("Escape");
    await expect(page.locator("#searchResults")).toBeHidden();
  });

  test("the exported file is readable with JavaScript disabled", async ({
    page,
    browser,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });

    await page.locator("#menuBtn").click();
    const downloadPromise = page.waitForEvent("download", { timeout: 90000 });
    await page.locator("#menuExportHtmlBtn").click();
    const download = await downloadPromise;
    const targetPath = testInfo.outputPath("nojs-export.html");
    await download.saveAs(targetPath);

    const noJsContext = await browser.newContext({ javaScriptEnabled: false });
    const noJsPage = await noJsContext.newPage();
    await noJsPage.goto(`file://${targetPath}`);

    // Every section unfolds sequentially — not a blank page.
    await expect(noJsPage.locator("#overview")).toBeVisible();
    await expect(noJsPage.locator("#getting-started")).toBeVisible();
    await expect(noJsPage.locator("#present-and-export")).toBeVisible();

    // Interactive chrome is hidden; the header title still shows.
    await expect(noJsPage.locator(".export-header__title")).toContainText("User Guide");
    await expect(noJsPage.locator("#tocPane")).toBeHidden();
    await expect(noJsPage.locator("#themeToggleBtn")).toBeHidden();

    await noJsContext.close();
  });

  test("the exported theme toggle re-skins code blocks without re-highlighting", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });

    // A non-terminal code fence guarantees a dual-theme Shiki block.
    await page.locator("#toggleEditBtn").click();
    const editor = page.locator("#editor");
    await editor.waitFor({ state: "visible", timeout: 30000 });
    const markdown = ["# Theme Demo", "", "```js", 'console.log("hi");', "```"].join(
      "\n",
    );
    await editor.locator(".cm-content").fill(markdown);
    await page
      .locator("#content")
      .locator("pre.shiki")
      .first()
      .waitFor({ state: "attached", timeout: 60000 });

    await page.locator("#menuBtn").click();
    const downloadPromise = page.waitForEvent("download", { timeout: 90000 });
    await page.locator("#menuExportHtmlBtn").click();
    const download = await downloadPromise;
    const targetPath = testInfo.outputPath("theme-export.html");
    await download.saveAs(targetPath);

    await page.goto(`file://${targetPath}`);
    const pre = page.locator("#overview pre.shiki:not(.command)").first();
    await expect(pre).toBeVisible();

    const before = await pre.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.locator("#themeToggleBtn").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const after = await pre.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(after).not.toBe(before);
  });

  test("the exported presentation mode enters, blacks out, and exits", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });

    await page.locator("#menuBtn").click();
    const downloadPromise = page.waitForEvent("download", { timeout: 90000 });
    await page.locator("#menuExportHtmlBtn").click();
    const download = await downloadPromise;
    const targetPath = testInfo.outputPath("present-export.html");
    await download.saveAs(targetPath);

    await page.goto(`file://${targetPath}`);
    await expect(page.locator("#chapterList .chapter-item-wrapper").first()).toBeVisible({
      timeout: 30000,
    });

    await page.locator("#presentBtn").click();
    await expect(page.locator("body")).toHaveClass(/presenting/);
    await expect(page.locator("#overlay")).toBeVisible();
    await expect(page.locator("#overlayProgress")).toHaveText(/Section 1 of \d+/);

    // Black-out, then any key wakes the screen.
    await page.keyboard.press("b");
    await expect(page.locator("body")).toHaveClass(/blacked-out/);
    await page.keyboard.press("x");
    await expect(page.locator("body")).not.toHaveClass(/blacked-out/);

    // Escape exits presentation mode; chrome returns.
    await page.keyboard.press("Escape");
    await expect(page.locator("body")).not.toHaveClass(/presenting/);
    await expect(page.locator("#overlay")).toBeHidden();
  });
});

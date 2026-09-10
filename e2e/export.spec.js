import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test.setTimeout(120000);

/**
 * Scroll to the end of the chapter and report whether the floating action
 * cluster covers the Next control. The cluster is fixed to the viewport's
 * bottom-right corner, which is where the nav lands at the end of a chapter.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{overlap: boolean, gap: number}>}
 */
async function nextButtonClearance(page) {
  await page.evaluate(() => {
    const pane = document.getElementById("previewPane");
    pane.scrollTop = pane.scrollHeight;
  });
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const next = document.getElementById("nextChapterBtn").getBoundingClientRect();
    const theme = document.getElementById("themeToggleBtn").getBoundingClientRect();
    const overlap =
      next.left < theme.right &&
      next.right > theme.left &&
      next.top < theme.bottom &&
      next.bottom > theme.top;
    return { overlap, gap: Math.round(theme.left - next.right) };
  });
}

/**
 * Export the unmodified coursebook once per worker and share the result.
 *
 * Most tests in this file only *read* the exported document, and building one
 * renders every chapter, highlights every block and inlines the whole book —
 * so paying for it per test dominated this file. Created lazily so a filtered
 * run that only touches the state-editing tests never builds it.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string>} Path to the shared exported document.
 */
let sharedExportPromise = null;
function getSharedExport(page) {
  if (!sharedExportPromise) {
    sharedExportPromise = (async () => {
      await page.goto("/");
      await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });
      await page.locator("#menuBtn").click();
      const exportBtn = page.locator("#menuExportHtmlBtn");
      await expect(exportBtn).toBeVisible();
      const downloadPromise = page.waitForEvent("download", { timeout: 90000 });
      await exportBtn.click();
      const download = await downloadPromise;
      // Unique per worker: fullyParallel can hand each worker a different
      // subset of this file's tests.
      const target = path.join(
        os.tmpdir(),
        `coursebookmd-e2e-export-${test.info().workerIndex}.html`,
      );
      await download.saveAs(target);
      return target;
    })();
  }
  return sharedExportPromise;
}

/**
 * Load the shared export into a fresh page, optionally at a given viewport.
 * @param {import("@playwright/test").Page} page
 * @param {{viewport?: {width: number, height: number}}} [options]
 * @returns {Promise<string>} Path to the shared exported document.
 */
async function loadSharedExport(page, { viewport } = {}) {
  const target = await getSharedExport(page);
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(`file://${target}`);
  return target;
}

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
  }) => {
    await loadSharedExport(page);

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
  }) => {
    await loadSharedExport(page);
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

    // The end-of-chapter Next control keeps clear of the floating cluster.
    const clearance = await nextButtonClearance(page);
    expect(clearance.overlap).toBe(false);
    expect(clearance.gap).toBeGreaterThan(0);

    // Print: the whole book, sequential, no chrome.
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("#overview")).toBeVisible();
    await expect(page.locator("#getting-started")).toBeVisible();
    await expect(page.locator("#tocPane")).toBeHidden();
    await expect(page.locator(".action-cluster")).toBeHidden();
    await page.emulateMedia({ media: null });
  });

  test("the exported mobile layout hides Present and opens the TOC as a drawer", async ({
    page,
  }) => {
    await loadSharedExport(page, { viewport: { width: 390, height: 844 } });
    await expect(page.locator("#chapterList .chapter-item-wrapper").first()).toBeAttached(
      {
        timeout: 30000,
      },
    );

    // Present mode has no touch waypoint navigation yet, so its button is not
    // offered on phones (the theme toggle stays).
    await expect(page.locator("#presentBtn")).toBeHidden();
    await expect(page.locator("#themeToggleBtn")).toBeVisible();

    // A table wider than the reading column is marked so the stylesheet can
    // show that it scrolls sideways instead of looking clipped.
    await expect(page.locator("#overview .table-scroll").first()).toHaveClass(
      /is-scrollable/,
    );

    // The runtime starts with the sidebar closed; the app's responsive CSS
    // hides the pane entirely, so the header toggle must open the drawer
    // rather than doing nothing. The closed default is set before the pane is
    // parsed, so it holds even before the runtime runs.
    await expect(page.locator("body")).toHaveClass(/sidebar-closed/);
    await expect(page.locator("#tocPane .toc-pane__title")).toBeHidden();
    await expect
      .poll(async () =>
        page.locator("#tocPane").evaluate((el) => el.getBoundingClientRect().right <= 1),
      )
      .toBe(true);

    // The toggle keeps its 36x36 hit target rather than being squeezed down
    // to the icon width by the header's fixed-width search box.
    const toggleBox = await page.locator("#sidebarToggleBtn").boundingBox();
    expect(Math.round(toggleBox.width)).toBe(36);
    expect(Math.round(toggleBox.height)).toBe(36);

    await page.locator("#sidebarToggleBtn").click();
    await expect(page.locator("body")).not.toHaveClass(/sidebar-closed/);
    await expect(page.locator("#tocPane .toc-pane__title")).toBeVisible();
    await expect
      .poll(async () =>
        page.locator("#tocPane").evaluate((el) => el.getBoundingClientRect().left >= 0),
      )
      .toBe(true);

    // The open drawer dims the page behind it, and the scrim starts below the
    // header so the toggle stays usable as the close button.
    await expect(page.locator("#tocScrim")).toBeVisible();
    const scrimTop = await page
      .locator("#tocScrim")
      .evaluate((el) => Math.round(el.getBoundingClientRect().top));
    const toggleBottom = await page
      .locator("#sidebarToggleBtn")
      .evaluate((el) => Math.round(el.getBoundingClientRect().bottom));
    expect(scrimTop).toBeGreaterThanOrEqual(toggleBottom);

    // Drawer rows keep comfortable tap targets on phones: chapter rows stay
    // near the 44px guideline, while the indented section rows are tightened
    // so the list does not read as airy.
    const chapterRow = await page
      .locator("#chapterList .chapter-item")
      .first()
      .boundingBox();
    const tocRow = await page
      .locator('.chapter-item-wrapper[data-chapter-idx="-1"] .toc-item')
      .first()
      .boundingBox();
    expect(Math.round(chapterRow.height)).toBeGreaterThanOrEqual(40);
    expect(Math.round(tocRow.height)).toBeGreaterThanOrEqual(32);

    // Narrower than the 260px desktop rail's share of the screen, so the page
    // stays readable behind the drawer.
    const drawerWidth = await page
      .locator("#tocPane")
      .evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(drawerWidth).toBeLessThanOrEqual(260);
    expect(drawerWidth).toBeLessThan(390 * 0.75);

    // Tapping the scrim outside the drawer dismisses it.
    await page.locator("#tocScrim").click({ position: { x: 360, y: 300 } });
    await expect(page.locator("body")).toHaveClass(/sidebar-closed/);
    await expect(page.locator("#tocPane .toc-pane__title")).toBeHidden();
    await expect(page.locator("#tocScrim")).toBeHidden();

    // The drawer honors the OS "reduce motion" setting.
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator("#tocPane")
        .evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe("0s");
    await page.emulateMedia({ reducedMotion: null });

    // Picking a section from the drawer's table of contents dismisses it too,
    // and still navigates to that heading.
    await page.locator("#sidebarToggleBtn").click();
    await expect(page.locator("body")).not.toHaveClass(/sidebar-closed/);
    await page
      .locator('.chapter-item-wrapper[data-chapter-idx="-1"] .toc-item')
      .first()
      .click();
    await expect(page.locator("body")).toHaveClass(/sidebar-closed/);
    await expect(page).toHaveURL(/#overview\//);

    // Picking a chapter navigates and dismisses the drawer.
    await page.locator("#sidebarToggleBtn").click();
    await expect(page.locator("body")).not.toHaveClass(/sidebar-closed/);
    await page
      .locator("#chapterList .chapter-item", { hasText: "Writing Content" })
      .first()
      .click();
    await expect(page.locator("#writing-content")).toHaveClass(/active/);
    await expect(page.locator("body")).toHaveClass(/sidebar-closed/);
    await expect(page.locator("#tocPane .toc-pane__title")).toBeHidden();

    // The floating theme button must not cover the end-of-chapter Next control.
    const clearance = await nextButtonClearance(page);
    expect(clearance.overlap).toBe(false);
    expect(clearance.gap).toBeGreaterThan(0);

    // The chapter controls meet the 44px touch-target guideline on phones.
    const nextBox = await page.locator("#nextChapterBtn").boundingBox();
    const prevBox = await page.locator("#prevChapterBtn").boundingBox();
    expect(Math.round(nextBox.height)).toBeGreaterThanOrEqual(44);
    expect(Math.round(prevBox.height)).toBeGreaterThanOrEqual(44);

    // Two images with different aspect ratios in one table row render at the
    // same height: on a narrow column nothing reaches the old max-height cap,
    // so each image used to keep its own ratio and the row went ragged.
    const imageHeights = await page.evaluate(async () => {
      const section =
        document.querySelector(".coursebook-section.active") ||
        document.getElementById("content");
      const wrap = document.createElement("div");
      wrap.className = "table-scroll";
      const table = document.createElement("table");
      const tbody = document.createElement("tbody");
      const row = document.createElement("tr");
      const probes = [
        [400, 400],
        [1200, 300],
      ];
      for (const [w, h] of probes) {
        const cell = document.createElement("td");
        const img = document.createElement("img");
        img.alt = "";
        img.src =
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
              `<rect width="${w}" height="${h}" fill="#345"/></svg>`,
          );
        cell.appendChild(img);
        row.appendChild(cell);
      }
      tbody.appendChild(row);
      table.appendChild(tbody);
      wrap.appendChild(table);
      section.appendChild(wrap);
      const imgs = Array.from(wrap.querySelectorAll("img"));
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? null
            : new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
              }),
        ),
      );
      const heights = imgs.map((img) => Math.round(img.getBoundingClientRect().height));
      wrap.remove();
      return heights;
    });
    expect(imageHeights).toHaveLength(2);
    expect(imageHeights[0]).toBeGreaterThan(0);
    expect(imageHeights[0]).toBe(imageHeights[1]);
  });

  test("the exported document is screen-reader friendly on mobile", async ({ page }) => {
    await loadSharedExport(page, { viewport: { width: 390, height: 844 } });
    await expect(page.locator("#chapterList .chapter-item-wrapper").first()).toBeAttached(
      {
        timeout: 30000,
      },
    );

    // A closed drawer is off-screen AND out of the accessibility tree, so a
    // screen reader never lands inside an invisible chapter list.
    await expect(page.locator("#tocPane")).toBeHidden();

    // The toggle describes its next action and the panel it controls.
    const toggle = page.locator("#sidebarToggleBtn");
    await expect(toggle).toHaveAttribute("aria-controls", "tocPane");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("aria-label", "Show navigation");

    await toggle.click();
    await expect(page.locator("#tocPane")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAttribute("aria-label", "Hide navigation");

    // The open drawer is modal: the page behind it is out of reach for the
    // keyboard too, and Escape dismisses it back to the toggle.
    expect(await page.locator("#previewPane").evaluate((el) => el.inert)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator("#tocPane")).toBeHidden();
    expect(await page.locator("#previewPane").evaluate((el) => el.inert)).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.id ?? "")).toBe(
      "sidebarToggleBtn",
    );

    await toggle.click();
    await expect(page.locator("#tocPane")).toBeVisible();

    // Picking a chapter announces it and moves focus into the new chapter
    // rather than dropping it on <body> when the drawer disappears.
    await page
      .locator("#chapterList .chapter-item", { hasText: "Writing Content" })
      .first()
      .click();
    await expect(page.locator("#writing-content")).toHaveClass(/active/);
    await expect(page.locator("#tocPane")).toBeHidden();
    await expect(page.locator("#srStatus")).toContainText("Writing Content. Chapter 2");
    const focusAfterChapter = await page.evaluate(() => ({
      id: document.activeElement?.id ?? "",
      inContent: document.getElementById("content").contains(document.activeElement),
    }));
    expect(focusAfterChapter.id === "content" || focusAfterChapter.inContent).toBe(true);

    // Picking a section moves focus onto that heading.
    await toggle.click();
    await expect(page.locator("#tocPane")).toBeVisible();
    const tocItem = page
      .locator('.chapter-item-wrapper[data-chapter-idx="1"] .toc-item')
      .first();
    const targetId = await tocItem.getAttribute("data-target");
    await tocItem.click();
    await expect(page.locator("#tocPane")).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.id ?? "")).toBe(targetId);

    // The header search reports itself as a combobox that opens and closes,
    // and names the option the arrow keys are on.
    const search = page.locator("#searchInput");
    await expect(search).toHaveAttribute("role", "combobox");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await search.fill("coursebook");
    await expect(page.locator(".export-search__item").first()).toBeVisible();
    await expect(search).toHaveAttribute("aria-expanded", "true");
    await expect(search).toHaveAttribute("aria-activedescendant", /searchResult-\d+/);
    await page.keyboard.press("Escape");
    await expect(search).toHaveAttribute("aria-expanded", "false");
  });

  test("the exported header search finds and jumps to other chapters", async ({
    page,
  }) => {
    await loadSharedExport(page);
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
  }) => {
    const targetPath = await getSharedExport(page);

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
  }) => {
    await loadSharedExport(page);
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

  test("the exported viewer moves between chapters with N/P", async ({ page }) => {
    await loadSharedExport(page);
    await expect(page.locator("#chapterList .chapter-item-wrapper").first()).toBeVisible({
      timeout: 30000,
    });

    const activeId = () => page.locator(".coursebook-section.active").getAttribute("id");
    const before = await activeId();

    // Normal reading mode: plain N/P change chapters.
    await page.locator("#previewPane").click({ position: { x: 20, y: 20 } });
    await page.keyboard.press("n");
    await expect.poll(activeId).not.toBe(before);
    await page.keyboard.press("p");
    await expect.poll(activeId).toBe(before);

    // Present mode still handles them through the shared engine.
    await page.locator("#presentBtn").click();
    await expect(page.locator("body")).toHaveClass(/presenting/);
    await page.keyboard.press("n");
    await expect.poll(activeId).not.toBe(before);
  });

  test("with a second display, Present opens a separate presentation window", async ({
    page,
  }) => {
    // Headless Chromium is single-screen; pretend a projector is attached so
    // the export opens its projection window instead of presenting in place.
    await page.addInitScript(() => {
      try {
        Object.defineProperty(window.screen, "isExtended", {
          get: () => true,
          configurable: true,
        });
      } catch {
        // Leave the real value if the property cannot be shadowed.
      }
    });
    await loadSharedExport(page);
    await expect(page.locator("#chapterList .chapter-item-wrapper").first()).toBeVisible({
      timeout: 30000,
    });

    const popupPromise = page.waitForEvent("popup");
    await page.locator("#presentBtn").click();
    const popup = await popupPromise;
    await expect(popup.locator("body")).toHaveClass(/presenting/, { timeout: 30000 });
    await expect(popup.locator("#overlay")).toBeVisible();

    // The reader page keeps its normal view while the extra window presents.
    await expect(page.locator("body")).not.toHaveClass(/presenting/);

    // Escape closes the projection window. The press can reject when the
    // close lands mid-keypress, so tolerate that and wait for the close.
    await Promise.all([
      popup.waitForEvent("close", { timeout: 15000 }),
      popup.keyboard.press("Escape").catch(() => {}),
    ]);
    expect(popup.isClosed()).toBe(true);
  });

  test("tapping an image or a diagram in the export expands it", async ({ page }) => {
    await loadSharedExport(page);
    await expect(page.locator("#chapterList .chapter-item-wrapper").first()).toBeVisible({
      timeout: 30000,
    });

    const overlay = page.locator(".media-zoom.is-open");

    // An image expands to the full picture instead of the column width.
    await page
      .locator("#chapterList .chapter-item", { hasText: "Writing Content" })
      .click();
    const image = page.locator("#writing-content img").first();
    await image.waitFor({ state: "visible", timeout: 30000 });
    // Zoomable media is reachable by keyboard too.
    await expect(image).toHaveAttribute("tabindex", "0");

    const inColumn = await image.boundingBox();
    await image.click();

    await expect(overlay).toBeVisible();
    const expanded = overlay.locator(".media-zoom__stage img");
    await expect(expanded).toBeVisible();
    const full = await expanded.boundingBox();
    expect(full.width).toBeGreaterThan(inColumn.width);
    // The page behind the dialog is out of the tab order and the a11y tree.
    await expect(page.locator(".export-header")).toHaveAttribute("inert", "");

    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
    await expect(image).toBeVisible();
    await expect(page.locator(".export-header")).not.toHaveAttribute("inert", "");

    // A presentation started from the keyboard dismisses the dialog instead of
    // running behind it with the reading pane inert and its scroll locked.
    // Mirror the app's platform detection (isShortcut in src/export-runtime.js)
    // rather than the user-agent string alone: Playwright's emulated desktop
    // profile reports Windows in the UA while navigator.platform stays
    // MacIntel, and the app goes by the platform first.
    const isMac = await page.evaluate(() => {
      const nav = navigator;
      return Boolean(
        (nav.userAgentData?.platform && /mac/i.test(nav.userAgentData.platform)) ||
        /mac/i.test(nav.platform || "") ||
        /macintosh|mac os x|macos/i.test(nav.userAgent),
      );
    });
    const presentShortcut = isMac ? "Meta+Control+p" : "Control+Alt+p";
    await image.click();
    await expect(overlay).toBeVisible();
    await page.keyboard.press(presentShortcut);
    await expect(page.locator("body")).toHaveClass(/presenting/);
    await expect(overlay).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("body")).not.toHaveClass(/presenting/);

    // A diagram is moved (not cloned) and returns to its figure on close.
    await page.locator("#chapterList .chapter-item", { hasText: "Rich Content" }).click();
    const diagram = page.locator("#rich-content .d2-diagram svg.d2-svg").first();
    await diagram.waitFor({ state: "visible", timeout: 60000 });
    await diagram.click();

    await expect(overlay).toBeVisible();
    await expect(overlay.locator(".media-zoom__stage svg.d2-svg")).toHaveCount(1);
    await expect(overlay.locator(".media-zoom__caption")).toContainText(/^Figure \d+\./);

    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
    await expect(page.locator("#rich-content .d2-diagram svg.d2-svg")).toHaveCount(2);
  });
});

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
    ]) {
      expect(html).toContain(`<section id="${id}"`);
    }

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
    await expect(page.locator("#chapterList .chapter-item-wrapper")).toHaveCount(5, {
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
    // chapter's diagram makes this exactly three; the exported overview must
    // contain exactly two.
    await expect(content.locator(".d2-diagram svg.d2-svg")).toHaveCount(3);

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
});

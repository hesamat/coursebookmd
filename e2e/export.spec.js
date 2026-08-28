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
});

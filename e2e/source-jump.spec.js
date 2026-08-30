import { test, expect } from "@playwright/test";

test.setTimeout(120000);

const SOURCE_JUMP_MARKDOWN = [
  "# Jump Target",
  "",
  "Paragraph one alpha.",
  "",
  "## Middle Heading",
  "",
  "Paragraph two beta.",
  "",
  "```js",
  "const n = 42;",
  "```",
  "",
  "Paragraph three gamma.",
].join("\n");

// The editor marks the line holding the caret via the active-line gutter
// (highlightActiveLineGutter + lineNumbers), so the gutter cell of the
// selected line exposes the 1-based line number as observable DOM.
async function activeLineNumber(page) {
  return page.evaluate(() => {
    const gutter = document.querySelector(".cm-activeLineGutter");
    const line = gutter ? parseInt(gutter.textContent, 10) : Number.NaN;
    return Number.isNaN(line) ? null : line;
  });
}

async function openEditorWithMarkdown(page, markdown, sectionId, url = "/") {
  await page.goto(url);
  // Wait for the requested section to actually be the active one before
  // touching the editor, or the edit races the initial render/navigation
  // and gets overwritten.
  const section = page.locator(`#${sectionId}`);
  await expect(section).toHaveClass(/active/, { timeout: 60000 });
  await page.locator("#toggleEditBtn").click();
  const editor = page.locator("#editor");
  await editor.waitFor({ state: "visible", timeout: 30000 });
  await editor.locator(".cm-content").fill(markdown);

  const headingText = markdown.split("\n")[0].replace(/^#+\s*/, "");
  // The re-render is debounced; wait until the preview shows the content
  // with its source-line annotations before clicking anything.
  await expect(section.locator("h1", { hasText: headingText })).toHaveAttribute(
    "data-src-line",
    "1",
    { timeout: 30000 },
  );
  return section;
}

test.describe("Source jump", () => {
  test("clicking a paragraph scrolls the editor to its source line", async ({ page }) => {
    const section = await openEditorWithMarkdown(page, SOURCE_JUMP_MARKDOWN, "overview");

    const para = section.locator("p").filter({ hasText: "Paragraph two beta" });
    await expect(para).toHaveAttribute("data-src-line", "7");
    await para.click();
    await expect.poll(() => activeLineNumber(page)).toBe(7);

    // The jumped-to line is visibly highlighted after the jump...
    const editorEl = page.locator("#editor");
    await expect(editorEl).toHaveClass(/cm-jumped/);
    const activeBackground = await page.evaluate(() => {
      const line = document.querySelector(".cm-activeLine");
      return line ? window.getComputedStyle(line).backgroundColor : "";
    });
    expect(activeBackground).not.toBe("rgba(0, 0, 0, 0)");

    // ...and the highlight is dropped as soon as the user interacts.
    await page.locator(".cm-content").click();
    await expect(page.locator(".cm-jumped")).toHaveCount(0);
  });

  test("clicking a heading and a code block jump to their source lines", async ({
    page,
  }) => {
    const section = await openEditorWithMarkdown(page, SOURCE_JUMP_MARKDOWN, "overview");

    await section.locator("h2", { hasText: "Middle Heading" }).click();
    await expect.poll(() => activeLineNumber(page)).toBe(5);

    const pre = section.locator("pre");
    await expect(pre).toHaveAttribute("data-src-line", "9");
    await pre.click();
    await expect.poll(() => activeLineNumber(page)).toBe(9);
  });

  test("go-up links still work in edit mode without moving the editor", async ({
    page,
  }) => {
    const markdown = [
      "# Rewritten Chapter",
      "",
      "Intro paragraph.",
      "",
      "## Alpha Section",
      "",
      "Alpha content.",
      "",
      "## Beta Section",
      "",
      "Beta content.",
    ].join("\n");
    const section = await openEditorWithMarkdown(
      page,
      markdown,
      "writing-content",
      "/#writing-content",
    );

    await expect(section.locator(".go-up-link")).toHaveCount(2, { timeout: 30000 });

    // Scroll deep into the chapter so the go-up link has work to do.
    await page.evaluate(() => {
      const pane = document.querySelector("#previewPane");
      pane.scrollTop = pane.scrollHeight;
    });

    const before = await activeLineNumber(page);
    expect(before).not.toBeNull();

    await section.locator(".go-up-link").first().click();
    await page.waitForFunction(
      () => document.querySelector("#previewPane").scrollTop < 50,
      { timeout: 15000 },
    );

    // The click was a reading aid, not a source jump: the caret stays put.
    expect(await activeLineNumber(page)).toBe(before);
  });
});

import { test, expect } from "@playwright/test";

test.setTimeout(120000);

const MARKDOWN = [
  "# Code Tab",
  "",
  "```js",
  "const a = 1;",
  "const b = 2;",
  "```",
  "",
  "Prose paragraph after the fence.",
].join("\n");

async function openEditor(page) {
  await page.goto("/");
  await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });
  await page.locator("#toggleEditBtn").click();
  const editor = page.locator("#editor");
  await editor.waitFor({ state: "visible", timeout: 30000 });
  await editor.locator(".cm-content").fill(MARKDOWN);
  // Wait out the debounced onChange so the preview re-render settles.
  await page.waitForTimeout(600);
  return editor;
}

test.describe("Code-block Tab handling", () => {
  test("Tab indents inside a fenced block and Shift+Tab dedents", async ({ page }) => {
    const editor = await openEditor(page);

    const codeLine = editor.locator(".cm-line", { hasText: "const a = 1;" });
    await codeLine.click();

    // Assert on exact textContent — Playwright's hasText/toHaveText
    // normalize whitespace, which would mask the indentation.
    const lineText = () =>
      page.evaluate(() => {
        const line = Array.from(document.querySelectorAll(".cm-line")).find((l) =>
          l.textContent.includes("const a = 1;"),
        );
        return line ? line.textContent : null;
      });

    await page.keyboard.press("Tab");
    await expect.poll(lineText).toBe("  const a = 1;");

    await page.keyboard.press("Shift+Tab");
    await expect.poll(lineText).toBe("const a = 1;");
  });

  test("Tab in prose inserts nothing and moves focus out of the editor", async ({
    page,
  }) => {
    const editor = await openEditor(page);

    const proseLine = editor.locator(".cm-line", {
      hasText: "Prose paragraph after the fence.",
    });
    await proseLine.click();

    await page.keyboard.press("Tab");

    await expect(proseLine).toHaveText("Prose paragraph after the fence.");
    const focusInEditor = await page.evaluate(() =>
      Boolean(document.activeElement?.closest(".cm-editor")),
    );
    expect(focusInEditor).toBe(false);
  });
});

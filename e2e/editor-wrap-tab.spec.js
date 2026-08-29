import { test, expect } from "@playwright/test";

test.setTimeout(120000);

async function openEditor(page) {
  await page.locator("#toggleEditBtn").click();
  const editor = page.locator("#editor");
  await editor.waitFor({ state: "visible", timeout: 30000 });
  return editor;
}

const LONG_CODE_LINE =
  'const longLine = "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk";';

const DOC = [
  "Prose paragraph one.",
  "Second prose line.",
  "",
  "```js",
  LONG_CODE_LINE,
  "```",
].join("\n");

async function fillDoc(editor) {
  await editor.locator(".cm-content").fill(DOC);
}

function codeLine(editor) {
  return editor.locator(".cm-line").filter({ hasText: "const longLine" });
}

test.describe("Editor soft wrap and Tab handling", () => {
  test("code lines do not wrap while prose lines wrap", async ({ page }) => {
    await page.goto("/");
    const editor = await openEditor(page);
    await fillDoc(editor);

    const prose = editor.locator(".cm-line").filter({ hasText: "Prose paragraph one." });
    const code = codeLine(editor);

    // Default is wrap ON: prose breaks, code keeps white-space: pre.
    await expect(code).toHaveCSS("white-space", "pre");
    await expect(prose).toHaveCSS("white-space", "break-spaces");
  });

  test("Tab indents inside a fenced code block and Shift+Tab dedents", async ({
    page,
  }) => {
    await page.goto("/");
    const editor = await openEditor(page);
    await fillDoc(editor);

    const code = codeLine(editor);
    await code.click({ position: { x: 5, y: 8 } });

    await page.keyboard.press("Tab");
    await expect.poll(() => code.textContent()).toBe(`  ${LONG_CODE_LINE}`);
    // Indent inserts spaces at line start, not a literal tab character.
    await expect.poll(() => code.textContent()).not.toContain("\t");

    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => code.textContent()).toBe(LONG_CODE_LINE);
  });

  test("Tab in prose inserts nothing and leaves the editor content", async ({ page }) => {
    await page.goto("/");
    const editor = await openEditor(page);
    await fillDoc(editor);

    const prose = editor.locator(".cm-line").filter({ hasText: "Prose paragraph one." });
    await prose.click();

    const before = await editor.locator(".cm-content").innerText();
    await page.keyboard.press("Tab");

    // Focus must leave .cm-content (Tab keeps its focus-navigation role).
    await expect
      .poll(() =>
        page.evaluate(() => {
          const content = document.querySelector("#editor .cm-content");
          const active = document.activeElement;
          return Boolean(content && active && !content.contains(active));
        }),
      )
      .toBe(true);

    // Nothing was inserted.
    await expect.poll(() => editor.locator(".cm-content").innerText()).toBe(before);
  });

  test("preview code blocks do not wrap (no wrap for code in preview)", async ({
    page,
  }) => {
    // The getting-started chapter contains a plain fenced code block.
    await page.goto("/#getting-started");
    const pre = page.locator("#getting-started pre").first();
    await expect(pre).toBeVisible();

    // Existing behavior, locked in: code blocks scroll horizontally
    // (overflow-x: auto) and never soft-wrap (white-space: pre).
    await expect(pre).toHaveCSS("white-space", "pre");
    await expect(pre).toHaveCSS("overflow-x", "auto");
  });
});

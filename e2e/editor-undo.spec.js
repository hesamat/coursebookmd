import { test, expect } from "@playwright/test";

test.setTimeout(120000);

const CHAPTER_A_PATH = "/#getting-started";
const CHAPTER_B_PATH = "/#writing-content";

async function openEditor(page) {
  await page.locator("#toggleEditBtn").click();
  const editor = page.locator("#editor");
  await editor.waitFor({ state: "visible", timeout: 30000 });
  return editor;
}

async function editorText(editor) {
  return (await editor.locator(".cm-content").innerText()).trim();
}

async function switchToChapter(page, idx) {
  await page
    .locator(`.chapter-item-wrapper[data-chapter-idx="${idx}"] .chapter-item`)
    .first()
    .click();
  await page.waitForTimeout(100);
}

test.describe("Editor undo history survives chapter switches", () => {
  test("undo restores chapter A content after visiting chapter B", async ({ page }) => {
    await page.goto(CHAPTER_A_PATH);
    const sectionA = page.locator("#getting-started");
    await sectionA.waitFor({ state: "visible", timeout: 60000 });

    const editor = await openEditor(page);
    await editor.locator(".cm-content").fill("alpha content");

    // Switch to chapter B and edit it too.
    await switchToChapter(page, 1);
    await editor.locator(".cm-content").fill("beta content");

    // Switch back to A: the cached state (with A's edits) is restored.
    await switchToChapter(page, 0);
    await expect
      .poll(() => editorText(editor), { timeout: 10000 })
      .toContain("alpha content");

    // History survived the switches: undo removes the A edit, restoring
    // the original chapter content.
    await editor.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() => editorText(editor), { timeout: 10000 })
      .not.toContain("alpha content");
    await expect
      .poll(() => editorText(editor), { timeout: 10000 })
      .toContain("Getting Started");
  });

  test("chapter B edits persist when returning from chapter A", async ({ page }) => {
    await page.goto(CHAPTER_B_PATH);
    const sectionB = page.locator("#writing-content");
    await sectionB.waitFor({ state: "visible", timeout: 60000 });

    const editor = await openEditor(page);
    await editor.locator(".cm-content").fill("beta content");

    await switchToChapter(page, 0);
    await page.waitForTimeout(200);

    await switchToChapter(page, 1);
    await expect
      .poll(() => editorText(editor), { timeout: 10000 })
      .toContain("beta content");
  });
});

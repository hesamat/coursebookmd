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

async function expectActiveSection(page, sectionId) {
  await expect
    .poll(async () => (await page.locator(`#${sectionId}`).getAttribute("class")) || "", {
      timeout: 10000,
    })
    .toContain("active");
}

async function fillAndCommit(page, editor, text) {
  await editor.locator(".cm-content").fill(text);
  // Wait past the 300ms onChange debounce so the edit is committed (and
  // enters the cross-chapter undo trail) before undoing.
  await page.waitForTimeout(500);
}

test.describe("Cross-chapter undo/redo", () => {
  test("undo spills into the previously edited chapter", async ({ page }) => {
    await page.goto(CHAPTER_A_PATH);
    await page.locator("#getting-started").waitFor({ state: "visible", timeout: 60000 });

    const editor = await openEditor(page);
    await fillAndCommit(page, editor, "alpha text");
    // A second committed edit in A leaves stable content ("alpha text")
    // after the cross-chapter undo removes only the latest change.
    await fillAndCommit(page, editor, "alpha text v2");

    await switchToChapter(page, 1);
    await fillAndCommit(page, editor, "beta text");

    // Same-chapter undo removes the B edit.
    await editor.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() => editorText(editor), { timeout: 10000 })
      .not.toContain("beta text");

    // History exhausted: undo now steps back to chapter A and undoes the
    // "v2" change there, leaving the earlier A edit visible.
    await page.keyboard.press("ControlOrMeta+z");
    await expectActiveSection(page, "getting-started");
    await expect
      .poll(() => editorText(editor), { timeout: 10000 })
      .toContain("alpha text");
    await expect.poll(() => editorText(editor), { timeout: 10000 }).not.toContain("v2");

    // A further undo removes the A edit (same-chapter again).
    await editor.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() => editorText(editor), { timeout: 10000 })
      .not.toContain("alpha text");
  });

  test("redo walks forward across the chapter boundary", async ({ page }) => {
    await page.goto(CHAPTER_B_PATH);
    await page.locator("#writing-content").waitFor({ state: "visible", timeout: 60000 });

    const editor = await openEditor(page);
    await fillAndCommit(page, editor, "beta text");

    await switchToChapter(page, 0);
    await fillAndCommit(page, editor, "alpha text");

    // Undo everything: chapter A edit, then cross back to chapter B.
    await editor.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() => editorText(editor), { timeout: 10000 })
      .not.toContain("alpha text");
    await page.keyboard.press("ControlOrMeta+z");
    await expectActiveSection(page, "writing-content");
    await expect
      .poll(() => editorText(editor), { timeout: 10000 })
      .not.toContain("beta text");

    // Redo in B re-applies the B edit, then crosses forward to chapter A.
    await editor.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+y");
    await expect
      .poll(() => editorText(editor), { timeout: 10000 })
      .toContain("beta text");

    await page.keyboard.press("ControlOrMeta+y");
    await expectActiveSection(page, "getting-started");
    await expect
      .poll(() => editorText(editor), { timeout: 10000 })
      .toContain("alpha text");
  });
});

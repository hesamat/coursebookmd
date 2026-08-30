import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

test.setTimeout(120000);

const CHAPTER_PATH = "/#getting-started";
const CHAPTER_SOURCE = readFileSync(
  new URL("../docs/chapters/01-getting-started.md", import.meta.url),
  "utf8",
);

async function openEditor(page) {
  await page.locator("#toggleEditBtn").click();
  const editor = page.locator("#editor");
  await editor.waitFor({ state: "visible", timeout: 30000 });
  return editor;
}

async function commitAndSettle(page) {
  // Wait past the 300ms onChange debounce plus the async enhance pass.
  await page.waitForTimeout(900);
}

test.describe("In-place section refresh (edit flicker)", () => {
  test("unchanged code block survives a prose edit above it", async ({ page }) => {
    await page.goto(CHAPTER_PATH);
    await page.locator("#getting-started").waitFor({ state: "visible", timeout: 60000 });

    const editor = await openEditor(page);
    const pre = page.locator("#getting-started pre").first();
    const preHandle = await pre.elementHandle();
    const initialLine = await pre.getAttribute("data-src-line");
    expect(Number(initialLine)).toBeGreaterThan(0);

    // Prepend a heading-free paragraph at the top: every existing block
    // shifts down by two lines but none of them changed content.
    await editor.locator(".cm-content").fill(`Fresh top note.\n\n${CHAPTER_SOURCE}`);
    await commitAndSettle(page);

    // New prose rendered.
    await expect
      .poll(() => page.locator("#getting-started").innerText(), {
        timeout: 10000,
      })
      .toContain("Fresh top note.");

    // The old <pre> node was reused, not replaced (this is the anti-flicker
    // guarantee: no re-render, no Shiki re-highlight for unchanged blocks).
    expect(await preHandle.evaluate((el) => el.isConnected)).toBe(true);
    expect(await preHandle.evaluate((el) => el.hasAttribute("data-source"))).toBe(true);
    // Source jump annotation shifted with the edit.
    await expect
      .poll(() => pre.getAttribute("data-src-line"), { timeout: 10000 })
      .toBe(String(Number(initialLine) + 2));
  });

  test("editing the code block re-renders just that block", async ({ page }) => {
    await page.goto(CHAPTER_PATH);
    await page.locator("#getting-started").waitFor({ state: "visible", timeout: 60000 });

    const editor = await openEditor(page);
    const pre = page.locator("#getting-started pre").first();
    const preHandle = await pre.elementHandle();
    const initialLine = await pre.getAttribute("data-src-line");

    const updated = CHAPTER_SOURCE.replace(
      "- [First Chapter](chapters/01-first.md)",
      "- [First Chapter](chapters/01-first.md) // edited",
    );
    expect(updated).not.toBe(CHAPTER_SOURCE);
    await editor.locator(".cm-content").fill(updated);
    await commitAndSettle(page);

    await expect
      .poll(() => page.locator("#getting-started").innerText(), {
        timeout: 10000,
      })
      .toContain("// edited");

    // The stale <pre> was replaced by a freshly highlighted one.
    expect(await preHandle.evaluate((el) => el.isConnected)).toBe(false);
    const freshPre = page.locator("#getting-started pre").first();
    await expect
      .poll(() => freshPre.getAttribute("data-source"), { timeout: 10000 })
      .toContain("// edited");
    expect(await freshPre.getAttribute("data-src-line")).toBe(initialLine);
    await expect(freshPre).toHaveClass(/shiki/);
  });
});

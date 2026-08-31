import { test, expect } from "@playwright/test";

test("toc aggressive repro", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto("/#rich-content");
  const section = page.locator("#rich-content");
  await expect(section).toHaveClass(/active/);
  const toc = page.locator('.chapter-item-wrapper[data-chapter-idx="2"] .chapter-toc');
  const items = toc.locator(".toc-item");
  const count = await items.count();

  const state = () =>
    page.evaluate(() => {
      const pane = document.getElementById("previewPane");
      const active = document.querySelector(
        '.chapter-item-wrapper[data-chapter-idx="2"] .toc-item.active',
      );
      const headings = [
        ...document.querySelectorAll(
          "#rich-content h1, #rich-content h2, #rich-content h3",
        ),
      ];
      const paneTop = pane.getBoundingClientRect().top;
      let visible = null;
      for (const h of headings) {
        if (h.getBoundingClientRect().top - paneTop <= 80) visible = h.id;
        else break;
      }
      return {
        scrollTop: Math.round(pane.scrollTop),
        scrollHeight: pane.scrollHeight,
        active: active ? active.getAttribute("data-target") : null,
        visibleHeading: visible,
      };
    });

  const mismatches = [];
  // Fast cadence, mixed directions, several rounds.
  const seq = [];
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < count; i++) seq.push(i);
    for (let i = count - 1; i >= 0; i--) seq.push(i);
  }
  for (const i of seq) {
    await items.nth(i).click();
    await page.waitForTimeout(350);
    const s = await state();
    const targetId = await items.nth(i).getAttribute("data-target");
    if (s.active !== targetId) {
      mismatches.push(
        `click[${targetId}] spy-active=${s.active} visible=${s.visibleHeading} scrollTop=${s.scrollTop}/${s.scrollHeight}`,
      );
    }
  }
  console.log(
    mismatches.length
      ? `MISMATCHES (${mismatches.length}/${seq.length}):\n` + mismatches.join("\n")
      : `all ${seq.length} clicks OK`,
  );
});

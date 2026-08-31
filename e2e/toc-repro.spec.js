import { test, expect } from "@playwright/test";

test("toc clicks during initial render churn", async ({ page }) => {
  test.setTimeout(240000);
  // No waits after goto — click while Shiki/diagrams/KaTeX are still rendering.
  await page.goto("/#writing-content");
  const toc = page.locator('.chapter-item-wrapper[data-chapter-idx="1"] .chapter-toc');
  const items = toc.locator(".toc-item");
  await items.first().waitFor({ state: "visible", timeout: 30000 });

  const state = () =>
    page.evaluate(() => {
      const pane = document.getElementById("previewPane");
      const active = document.querySelector(
        '.chapter-item-wrapper[data-chapter-idx="1"] .toc-item.active',
      );
      const headings = [
        ...document.querySelectorAll(
          "#writing-content h1, #writing-content h2, #writing-content h3",
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
        active: active ? active.getAttribute("data-target") : null,
        visibleHeading: visible,
      };
    });

  const mismatches = [];
  const seq = [];
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 12; i++) seq.push(i);
    for (let i = 11; i >= 0; i--) seq.push(i);
  }
  for (const i of seq) {
    await items.nth(i).click();
    await page.waitForTimeout(300);
    const s = await state();
    const targetId = await items.nth(i).getAttribute("data-target");
    if (s.active !== targetId) {
      mismatches.push(
        `click[${targetId}] spy-active=${s.active} visible=${s.visibleHeading} scrollTop=${s.scrollTop}`,
      );
    }
  }
  console.log(
    mismatches.length
      ? `MISMATCHES (${mismatches.length}/${seq.length}):\n` +
          mismatches.slice(0, 12).join("\n")
      : `all ${seq.length} clicks OK`,
  );
  expect(mismatches, mismatches.slice(0, 12).join("\n")).toEqual([]);
});

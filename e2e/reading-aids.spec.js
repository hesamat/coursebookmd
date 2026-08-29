import { test, expect } from "@playwright/test";

test.setTimeout(120000);

async function openCoursebookAt(page, url) {
  await page.goto(url);
  await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });
}

test.describe("Reading aids", () => {
  test("clicking a go-up link scrolls back to the chapter top", async ({ page }) => {
    await openCoursebookAt(page, "/#writing-content");

    // Scroll deep into the chapter first.
    await page.evaluate(() => {
      const pane = document.querySelector("#previewPane");
      const el = document.getElementById("terminal-command-blocks");
      if (!pane || !el) throw new Error("missing elements");
      pane.scrollTop =
        pane.scrollTop +
        el.getBoundingClientRect().top -
        pane.getBoundingClientRect().top -
        60;
    });

    const link = page.locator("#terminal-command-blocks + .go-up-link");
    await expect(link).toBeVisible();

    // The scroll-spy lands the section at SCROLL_OFFSET (80px) below the pane
    // top, clamped to the scrollable range. Only one chapter is displayed at
    // a time in the live app, so the chapter top clamps to scrollTop 0.
    const expectedTop = await page.evaluate(() => {
      const pane = document.querySelector("#previewPane");
      const section = document.getElementById("writing-content");
      const target =
        pane.scrollTop +
        (section.getBoundingClientRect().top - pane.getBoundingClientRect().top) -
        80;
      return Math.min(Math.max(target, 0), pane.scrollHeight - pane.clientHeight);
    });

    await link.click();

    await page.waitForFunction(
      (target) => {
        const pane = document.querySelector("#previewPane");
        return pane && Math.abs(pane.scrollTop - target) <= 4;
      },
      expectedTop,
      { timeout: 15000 },
    );
  });

  test("go-up links survive an editor live re-render", async ({ page }) => {
    await openCoursebookAt(page, "/#writing-content");

    await page.locator("#toggleEditBtn").click();
    const editor = page.locator("#editor");
    await editor.waitFor({ state: "visible", timeout: 30000 });

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
    await editor.locator(".cm-content").fill(markdown);

    const section = page.locator("#writing-content");
    await expect(section.locator(".go-up-link")).toHaveCount(2, { timeout: 30000 });
    await expect(section.locator("#alpha-section + .go-up-link")).toHaveCount(1);
  });
});

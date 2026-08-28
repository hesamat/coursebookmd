import { test, expect } from "@playwright/test";

test.setTimeout(120000);

async function openCoursebookAt(page, url) {
  await page.goto(url);
  await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });
}

test.describe("Reading aids", () => {
  test("In this Chapter box lists every H2 of the chapter with its number", async ({
    page,
  }) => {
    await openCoursebookAt(page, "/#writing-content");

    const section = page.locator("#writing-content");
    const box = section.locator(".in-chapter-toc");
    await expect(box).toBeVisible();
    await expect(box.locator(".in-chapter-toc__title")).toHaveText("In this Chapter");

    const h2Count = await section.locator("h2").count();
    expect(h2Count).toBeGreaterThan(0);
    const items = box.locator(".in-chapter-toc__item");
    await expect(items).toHaveCount(h2Count);

    // Chapter 2's H2s are numbered 2.x and the numbers are rendered.
    const numbers = box.locator(".in-chapter-toc__number");
    await expect(numbers.first()).toBeVisible();
    await expect(numbers.first()).toHaveText(/^2\.\d+$/);

    // Every box item targets a heading that actually exists in the section.
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const target = await items.nth(i).getAttribute("data-target");
      await expect(section.locator(`#${target}`)).toHaveCount(1);
    }
  });

  test("clicking a box item scrolls to the heading and updates the hash", async ({
    page,
  }) => {
    await openCoursebookAt(page, "/#writing-content");

    const item = page.locator(
      '#writing-content .in-chapter-toc__item[data-target="lists"]',
    );
    await expect(item).toBeVisible();
    await item.click();

    await expect(page).toHaveURL(/#writing-content\/lists$/);
    await page.waitForFunction(
      () => {
        const pane = document.querySelector("#previewPane");
        const el = document.getElementById("lists");
        if (!pane || !el) return false;
        return el.getBoundingClientRect().top - pane.getBoundingClientRect().top < 120;
      },
      undefined,
      { timeout: 15000 },
    );
  });

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

  test("aids survive an editor live re-render", async ({ page }) => {
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
    const box = section.locator(".in-chapter-toc");
    await expect(box).toBeVisible({ timeout: 30000 });
    await expect(box.locator(".in-chapter-toc__item")).toHaveCount(2);
    await expect(section.locator(".go-up-link")).toHaveCount(2);

    // Continuous numbering recomputed after the edit: chapter 2 starts at 2.1.
    await expect(box.locator(".in-chapter-toc__number").first()).toHaveText("2.1");
    await expect(
      box.locator('.in-chapter-toc__item[data-target="alpha-section"]'),
    ).toHaveCount(1);
  });
});

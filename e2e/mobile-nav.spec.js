import { test, expect } from "@playwright/test";

test.describe("navigation drawer on a phone", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/#writing-content");
    await expect(page.locator("#chapterList .chapter-item-wrapper").first()).toBeAttached(
      {
        timeout: 60000,
      },
    );
  });

  test("starts closed, opens from the edge tab, and a tap outside closes it", async ({
    page,
  }) => {
    const pane = page.locator("#tocPane");
    await expect(pane).toBeHidden();
    await expect(page.locator("#navScrim")).toBeHidden();
    // The toggle describes what it will do next, even on first load.
    await expect(page.locator("#sidebarToggleBtn")).toHaveAttribute(
      "aria-label",
      "Show navigation",
    );

    await page.locator("#sidebarToggleBtn").click();
    await expect(pane).toBeVisible();
    await expect(page.locator("#navScrim")).toBeVisible();
    await expect(page.locator("#sidebarToggleBtn")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // A drawer over the reading pane, not a full-width takeover.
    const box = await pane.boundingBox();
    expect(box.width).toBeLessThan(300);
    await expect(page.locator("#previewPane")).toHaveAttribute("inert", "");

    // Tapping the dimmed pane (clear of the drawer) dismisses it.
    await page.locator("#navScrim").click({ position: { x: 330, y: 120 } });
    await expect(pane).toBeHidden();
    await expect(page.locator("#sidebarToggleBtn")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.locator("#previewPane")).not.toHaveAttribute("inert", "");
  });

  test("Escape closes the drawer and returns focus to the toggle", async ({ page }) => {
    await page.locator("#sidebarToggleBtn").click();
    await expect(page.locator("#tocPane")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.locator("#tocPane")).toBeHidden();
    await expect(page.locator("#sidebarToggleBtn")).toBeFocused();
  });

  test("picking a section closes the drawer and moves focus to that heading", async ({
    page,
  }) => {
    await page.locator("#sidebarToggleBtn").click();
    const item = page.locator(".chapter-toc.is-open .toc-item").first();
    await expect(item).toBeVisible();
    const target = await item.getAttribute("data-target");

    await item.click();

    await expect(page.locator("#tocPane")).toBeHidden();
    await expect(page.locator(`[id="${target}"]`)).toBeFocused();
  });
});

test.describe("navigation column on a desktop", () => {
  test("keeps the inline column and its peek tab, with no scrim", async ({ page }) => {
    await page.goto("/#writing-content");
    const pane = page.locator("#tocPane");
    await expect(pane).toBeVisible({ timeout: 60000 });
    await expect(page.locator("#navScrim")).toBeHidden();

    await page.locator("#sidebarToggleBtn").click();

    // The pane keeps an 18px peek tab and the detached chevron stays put.
    await expect(page.locator("#sidebarToggleBtn")).toBeVisible();
    await expect(page.locator("#sidebarToggleBtn")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect
      .poll(async () => {
        const box = await pane.boundingBox();
        return box.x + box.width;
      })
      .toBeLessThanOrEqual(20);

    // Nothing is dimmed or inert: the reading pane is still the page.
    await expect(page.locator("#navScrim")).toBeHidden();
    await expect(page.locator("#previewPane")).not.toHaveAttribute("inert", "");
  });
});

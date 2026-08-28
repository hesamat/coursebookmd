import { test, expect } from "@playwright/test";

test.setTimeout(120000);

/** Open the app on a chapter and wait until it is fully initialized. */
async function openChapter(page, hash) {
  await page.goto(`/${hash}`);
  await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });
}

/**
 * Enter present mode via the topbar control and wait until it is fully
 * armed. `enterPresent` defers its navigator setup (scroll to top, waypoint
 * reset, overlay update) by two animation frames; keyboard navigation sent
 * before that setup completes is silently reverted by it. Entering from a
 * scrolled position makes the deferred scroll-to-top observable, which gives
 * a deterministic end-of-transition signal.
 */
async function enterPresentMode(page) {
  await page.evaluate(() => {
    document.getElementById("previewPane").scrollTop = 600;
  });
  await page.locator("#presentBtn").click();
  await expect(page.locator("body")).toHaveClass(/presenting/);
  await page.waitForFunction(
    () => document.getElementById("previewPane")?.scrollTop === 0,
    { timeout: 15000 },
  );
}

test.describe("Present mode", () => {
  test("entering present mode shows the overlay and starts at the first section", async ({
    page,
  }) => {
    await openChapter(page, "#getting-started");

    await enterPresentMode(page);

    // App chrome is hidden while presenting; the overlay is shown.
    await expect(page.locator("#controlBar")).toBeHidden();
    await expect(page.locator("#tocPane")).toBeHidden();

    const overlayCurrent = page.locator("#overlayCurrent");
    await expect(overlayCurrent).toContainText("Getting Started");
    await expect(overlayCurrent).toBeVisible();
    await expect(page.locator("#overlayNext")).toContainText("Next:");
    await expect(page.locator("#overlayProgress")).toHaveText(/^1 \/ \d+$/);
  });

  test("arrow keys move between sections and Esc returns to the normal view", async ({
    page,
  }) => {
    await openChapter(page, "#getting-started");

    await enterPresentMode(page);

    const overlayCurrent = page.locator("#overlayCurrent");
    await expect(overlayCurrent).toContainText("Getting Started");

    await page.keyboard.press("ArrowRight");
    await expect(overlayCurrent).toContainText("What is a coursebook?", {
      timeout: 15000,
    });

    await page.keyboard.press("ArrowRight");
    await expect(overlayCurrent).toContainText("Opening a coursebook", {
      timeout: 15000,
    });

    await page.keyboard.press("ArrowLeft");
    await expect(overlayCurrent).toContainText("What is a coursebook?", {
      timeout: 15000,
    });

    await page.keyboard.press("Escape");
    await expect(page.locator("body")).not.toHaveClass(/presenting/);
    await expect(page.locator("#controlBar")).toBeVisible();
    await expect(page.locator("#presentBtn")).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";

test.setTimeout(120000);

/** Open the app on a chapter and wait until it is fully initialized. */
async function openChapter(page, hash) {
  await page.goto(`/${hash}`);
  await expect(page.locator("#chapterNav")).toBeVisible({ timeout: 60000 });
}

/**
 * Click Present and return the presentation popup page. The popup is opened
 * as about:blank inside the click gesture, then placed and navigated to
 * present.html (headless runs a single screen, exercising the fallback
 * placement path).
 */
async function openPresentWindow(page) {
  const popupPromise = page.waitForEvent("popup");
  await page.locator("#presentBtn").click();
  const popup = await popupPromise;
  await popup.waitForURL(/present\.html$/, { timeout: 30000 });
  await expect(popup.locator("body")).toHaveClass(/presenting/);
  return popup;
}

test.describe("Present window", () => {
  test("opens the presentation window with the overlay and first section", async ({
    page,
  }) => {
    await openChapter(page, "#getting-started");

    const popup = await openPresentWindow(page);

    // The opener stays in the normal interactive view.
    await expect(page.locator("body")).not.toHaveClass(/presenting/);
    await expect(page.locator("#controlBar")).toBeVisible();
    await expect(page.locator("#presentBtn")).toBeVisible();

    // The popup presents the transferred coursebook.
    await expect(popup.locator("#content .coursebook-section.active")).toHaveCount(1);
    const overlayCurrent = popup.locator("#overlayCurrent");
    await expect(overlayCurrent).toContainText("Getting Started", { timeout: 15000 });
    await expect(overlayCurrent).toBeVisible();
    await expect(popup.locator("#overlayNext")).toContainText("Next:");
    await expect(popup.locator("#overlayProgress")).toHaveText(/^1 \/ \d+$/);
  });

  test("arrow keys move between sections inside the presentation window", async ({
    page,
  }) => {
    await openChapter(page, "#getting-started");

    const popup = await openPresentWindow(page);
    const overlayCurrent = popup.locator("#overlayCurrent");
    await expect(overlayCurrent).toContainText("Getting Started");

    await popup.keyboard.press("ArrowRight");
    await expect(overlayCurrent).toContainText("What is a coursebook?", {
      timeout: 15000,
    });

    await popup.keyboard.press("ArrowRight");
    await expect(overlayCurrent).toContainText("Opening a coursebook", {
      timeout: 15000,
    });

    await popup.keyboard.press("ArrowLeft");
    await expect(overlayCurrent).toContainText("What is a coursebook?", {
      timeout: 15000,
    });
  });

  test("chapter nav buttons switch chapters inside the popup", async ({ page }) => {
    await openChapter(page, "#getting-started");

    const popup = await openPresentWindow(page);
    await expect(popup.locator("#chapterNav")).toBeVisible({ timeout: 15000 });
    await expect(popup.locator("#content .coursebook-section.active")).toHaveId(
      "getting-started",
    );
    // On the first chapter, Previous goes back to the overview.
    await expect(popup.locator("#prevChapterBtn")).toBeEnabled();
    await expect(popup.locator("#prevChapterBtn")).toHaveAttribute(
      "title",
      "Previous: Overview",
    );
    await expect(popup.locator("#nextChapterBtn")).toBeEnabled();

    await popup.locator("#nextChapterBtn").click();

    await expect(popup.locator("#content .coursebook-section.active")).toHaveId(
      "writing-content",
      { timeout: 15000 },
    );
    await expect(popup.locator("#overlayProgress")).toHaveText(/^1 \/ \d+$/);
    await expect(popup.locator("#prevChapterBtn")).toBeEnabled();
  });

  test("Escape closes the presentation window", async ({ page }) => {
    await openChapter(page, "#getting-started");

    const popup = await openPresentWindow(page);
    await expect(popup.locator("#overlayCurrent")).toContainText("Getting Started", {
      timeout: 15000,
    });

    // The Escape keypress closes the popup, which can make the press call
    // itself reject with "target closed" — tolerate that and wait for close.
    await Promise.all([
      popup.waitForEvent("close", { timeout: 15000 }),
      popup.keyboard.press("Escape").catch(() => {}),
    ]);
    expect(popup.isClosed()).toBe(true);

    // The opener is unaffected and can present again.
    await expect(page.locator("#controlBar")).toBeVisible();
  });
});

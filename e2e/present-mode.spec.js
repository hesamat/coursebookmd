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
    await expect(popup.locator("#overlayProgress")).toHaveText("Section 1 of 6");
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

  test("chapter shortcuts move between chapters inside the presentation window", async ({
    page,
  }) => {
    await openChapter(page, "#getting-started");

    const popup = await openPresentWindow(page);
    await expect(popup.locator("#overlayCurrent")).toContainText("Getting Started", {
      timeout: 15000,
    });

    const activeBefore = await popup
      .locator("#content .coursebook-section.active")
      .getAttribute("id");

    await popup.keyboard.press("n");
    await expect
      .poll(() => popup.locator("#content .coursebook-section.active").getAttribute("id"))
      .not.toBe(activeBefore);

    await popup.keyboard.press("p");
    await expect
      .poll(() => popup.locator("#content .coursebook-section.active").getAttribute("id"))
      .toBe(activeBefore);
  });

  test("the presentation window advertises N/P chapters", async ({ page }) => {
    await openChapter(page, "#getting-started");

    const popup = await openPresentWindow(page);
    await expect(popup.locator(".overlay__hints")).toContainText("N P chapters");

    await popup.keyboard.press("?");
    await expect(popup.locator("#shortcutsSheetPresent")).toContainText(
      "Next / previous chapter",
    );
  });

  test("scroll position mirrors between the main window and the presentation window", async ({
    page,
  }) => {
    await openChapter(page, "#getting-started");

    const popup = await openPresentWindow(page);
    await expect(popup.locator("#overlayCurrent")).toContainText("Getting Started", {
      timeout: 15000,
    });

    // The sync id of the block at the pane's top, on either window.
    const topSyncId = (target) =>
      target.evaluate(() => {
        const pane = document.getElementById("previewPane");
        const paneTop = pane.getBoundingClientRect().top;
        let id = null;
        for (const el of document.querySelectorAll("#content [data-sync-id]")) {
          if (el.getBoundingClientRect().top - paneTop <= 0) id = el.dataset.syncId;
          else break;
        }
        return id;
      });

    // Laptop drives: scroll the main window, the projector follows.
    await page.bringToFront();
    await page.locator("#previewPane").evaluate((el) => {
      el.scrollTo({ top: 1200, behavior: "auto" });
    });
    const mainId = await topSyncId(page);
    expect(mainId).toBeTruthy();
    await expect.poll(() => topSyncId(popup), { timeout: 15000 }).toBe(mainId);

    // Projector drives: scroll the popup, the laptop follows.
    await popup.bringToFront();
    await popup.locator("#previewPane").evaluate((el) => {
      el.scrollTo({ top: 900, behavior: "auto" });
    });
    const popupId = await topSyncId(popup);
    expect(popupId).toBeTruthy();
    await expect.poll(() => topSyncId(page), { timeout: 15000 }).toBe(popupId);
  });

  test("section position stays in sync between the popup and the main window", async ({
    page,
  }) => {
    await openChapter(page, "#getting-started");

    const popup = await openPresentWindow(page);
    const overlayCurrent = popup.locator("#overlayCurrent");
    await expect(overlayCurrent).toContainText("Getting Started", { timeout: 15000 });

    // The projector leads: an arrow key in the popup moves the laptop too.
    await popup.keyboard.press("ArrowRight");
    await expect(overlayCurrent).toContainText("What is a coursebook?", {
      timeout: 15000,
    });
    await expect(page.locator("#overlayCurrent")).toContainText("What is a coursebook?", {
      timeout: 15000,
    });

    // The laptop leads: focus the reading pane and move again; the projector
    // follows to the same section.
    await page.locator("#previewPane").click({ position: { x: 20, y: 20 } });
    await page.keyboard.press("ArrowRight");
    await expect(overlayCurrent).toContainText("Opening a coursebook", {
      timeout: 15000,
    });
    await expect(popup.locator("#overlayProgress")).toHaveText(/^Section 3 of \d+$/, {
      timeout: 15000,
    });
  });

  test("re-presenting follows a chapter switch made in the main window", async ({
    page,
  }) => {
    await openChapter(page, "#getting-started");

    const popup = await openPresentWindow(page);
    // Move within the first chapter so a naive position restore would land
    // mid-chapter instead of at the chapter top.
    await popup.keyboard.press("ArrowRight");
    await expect(popup.locator("#overlayCurrent")).toContainText(
      "What is a coursebook?",
      { timeout: 15000 },
    );

    // Switch chapters in the main window, then re-present.
    await page
      .locator("#chapterList .chapter-item", { hasText: "Writing Content" })
      .first()
      .click();
    await page.locator("#presentBtn").click();

    await expect(popup.locator("#content .coursebook-section.active")).toHaveId(
      "writing-content",
      { timeout: 15000 },
    );
    // The popup lands at the new chapter's first waypoint, not at the old
    // chapter's waypoint index.
    await expect(popup.locator("#overlayCurrent")).toContainText("Writing Content", {
      timeout: 15000,
    });
    await expect(popup.locator("#overlayProgress")).toHaveText(/^Section 1 of \d+$/);
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

test.describe("Main window shortcuts sheet", () => {});

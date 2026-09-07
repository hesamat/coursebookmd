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
    await expect(popup.locator("#overlayProgress")).toHaveText(/^Section 1 of \d+$/);
    await expect(popup.locator("#prevChapterBtn")).toBeEnabled();
  });

  test("B blanks the screen and any other key or click wakes it", async ({ page }) => {
    await openChapter(page, "#getting-started");

    const popup = await openPresentWindow(page);
    await expect(popup.locator("#overlayCurrent")).toContainText("Getting Started", {
      timeout: 15000,
    });

    await popup.keyboard.press("b");
    await expect(popup.locator("body")).toHaveClass(/blacked-out/);

    // Navigation keys only wake the screen; they do not move.
    await popup.keyboard.press("ArrowRight");
    await expect(popup.locator("body")).not.toHaveClass(/blacked-out/);
    await expect(popup.locator("#overlayCurrent")).toContainText("Getting Started");

    await popup.keyboard.press("B");
    await expect(popup.locator("body")).toHaveClass(/blacked-out/);

    // A click also wakes the screen.
    await popup.mouse.click(640, 360);
    await expect(popup.locator("body")).not.toHaveClass(/blacked-out/);
  });

  test("? toggles the shortcuts sheet and Esc closes it before closing the window", async ({
    page,
  }) => {
    await openChapter(page, "#getting-started");

    const popup = await openPresentWindow(page);
    const sheet = popup.locator("#shortcutsSheet");
    await expect(sheet).toBeHidden();

    await popup.keyboard.press("?");
    await expect(sheet).toBeVisible();
    // The popup only ships the presenting rows.
    await expect(sheet.getByText("Black-out screen")).toBeVisible();
    await expect(sheet.getByText("Edit mode")).toBeHidden();

    // Escape closes the sheet without closing the window.
    await popup.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(popup.locator("body")).toHaveClass(/presenting/);

    // The next Escape closes the presentation window.
    await Promise.all([
      popup.waitForEvent("close", { timeout: 15000 }),
      popup.keyboard.press("Escape").catch(() => {}),
    ]);
    expect(popup.isClosed()).toBe(true);
  });

  test("spotlight dims the inactive wrapper while staying bright on the current one", async ({
    page,
  }) => {
    await openChapter(page, "#getting-started");

    const popup = await openPresentWindow(page);
    await expect(popup.locator("#overlayCurrent")).toContainText("Getting Started", {
      timeout: 15000,
    });

    await popup.keyboard.press("s");
    await expect(popup.locator("body")).toHaveClass(/spotlight/);

    await popup.keyboard.press("ArrowRight");
    await expect(popup.locator("#overlayCurrent")).toContainText(
      "What is a coursebook?",
      { timeout: 15000 },
    );

    const wrapperIsActive = (headingText) =>
      popup.evaluate((text) => {
        const headings = Array.from(document.querySelectorAll("#content h2"));
        const h = headings.find((el) => el.textContent.includes(text));
        return Boolean(h?.closest("section")?.classList.contains("active"));
      }, headingText);

    // The current heading's wrapper section is active (bright) while the
    // intro section is not.
    await expect(async () => {
      expect(await wrapperIsActive("What is a coursebook?")).toBe(true);
      expect(await wrapperIsActive("Getting Started")).toBe(false);
    }).toPass({ timeout: 15000 });
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

test.describe("Main window shortcuts sheet", () => {
  test("? shows the normal-mode rows while the app is not presenting", async ({
    page,
  }) => {
    await openChapter(page, "#getting-started");

    const sheet = page.locator("#shortcutsSheet");
    const normalGrid = page.locator("#shortcutsSheetNormal");
    const presentGrid = page.locator("#shortcutsSheetPresent");

    await page.keyboard.press("?");
    await expect(sheet).toBeVisible();
    await expect(normalGrid).toBeVisible();
    await expect(presentGrid).toBeHidden();
    await expect(sheet.getByText("Edit mode")).toBeVisible();
    await expect(sheet.getByText("Black-out screen")).toBeHidden();

    // The modifier combo matches the running platform.
    const mainMod = await sheet.locator("[data-mod-main]").first().textContent();
    expect(["Ctrl", "\u2318 Cmd"]).toContain(mainMod);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });
});

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
    await expect(page.locator("#overlayProgress")).toHaveText("Section 1 of 5");
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

  test("B blanks the screen and any other key or click wakes it", async ({ page }) => {
    await openChapter(page, "#getting-started");
    await enterPresentMode(page);

    await page.keyboard.press("b");
    await expect(page.locator("body")).toHaveClass(/blacked-out/);

    // Navigation keys only wake the screen; they do not move.
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("body")).not.toHaveClass(/blacked-out/);
    await expect(page.locator("#overlayCurrent")).toContainText("Getting Started");

    await page.keyboard.press("B");
    await expect(page.locator("body")).toHaveClass(/blacked-out/);

    // A click also wakes the screen.
    await page.mouse.click(640, 360);
    await expect(page.locator("body")).not.toHaveClass(/blacked-out/);
  });

  test("? toggles the shortcuts sheet and Esc closes it before exiting", async ({
    page,
  }) => {
    await openChapter(page, "#getting-started");
    await enterPresentMode(page);

    const sheet = page.locator("#shortcutsSheet");
    await expect(sheet).toBeHidden();

    await page.keyboard.press("?");
    await expect(sheet).toBeVisible();

    // Escape closes the sheet without leaving presentation mode.
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page.locator("body")).toHaveClass(/presenting/);

    // The next Escape exits presentation mode.
    await page.keyboard.press("Escape");
    await expect(page.locator("body")).not.toHaveClass(/presenting/);
  });

  test("spotlight dims the inactive wrapper while staying bright on the current one", async ({
    page,
  }) => {
    await openChapter(page, "#getting-started");
    await enterPresentMode(page);

    await page.keyboard.press("s");
    await expect(page.locator("body")).toHaveClass(/spotlight/);

    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#overlayCurrent")).toContainText("What is a coursebook?", {
      timeout: 15000,
    });

    const wrapperIsActive = (headingText) =>
      page.evaluate((text) => {
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
});

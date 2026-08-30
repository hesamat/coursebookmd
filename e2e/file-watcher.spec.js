import { test, expect } from "@playwright/test";

test.setTimeout(120000);

async function setupOpfs(page) {
  await page.addInitScript(() => {
    window.__opfsWrite = async (path, text) => {
      const root = await navigator.storage.getDirectory();
      const parts = path.split("/");
      let dir = root;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
      }
      const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
    };
    window.__opfsRead = async (path) => {
      const root = await navigator.storage.getDirectory();
      const parts = path.split("/");
      let dir = root;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i]);
      }
      const fh = await dir.getFileHandle(parts[parts.length - 1]);
      const f = await fh.getFile();
      return f.text();
    };
    window.__setupCoursebook = async () => {
      const root = await navigator.storage.getDirectory();
      await window.__opfsWrite(
        "coursebook.md",
        "# OPFS Course\n\n- [Alpha](chapters/alpha.md)\n- [Beta](chapters/beta.md)\n",
      );
      await window.__opfsWrite(
        "chapters/alpha.md",
        "# Alpha\n\nAlpha content.\n\n## Alpha One\n\nText.\n",
      );
      await window.__opfsWrite(
        "chapters/beta.md",
        "# Beta\n\nBeta content.\n\n## Beta One\n\nText.\n",
      );
      window.showDirectoryPicker = async () => root;
      return true;
    };
  });
}

const SETTLE = 4000; // 2s poll interval + settle window + render

test.describe("file watcher end-to-end (OPFS)", () => {
  test.beforeEach(async ({ page }) => {
    await setupOpfs(page);
    await page.goto("/");
    await page.evaluate(() => window.__setupCoursebook());
    await page.locator("#menuBtn").click();
    await page.locator("#menuOpenCoursebookBtn").click();
    await page.locator("#overview").waitFor({ state: "visible", timeout: 30000 });
    // Let the watcher seed its baseline before simulating external edits.
    await page.waitForTimeout(SETTLE);
  });

  test("chapter list reflects added, removed, and renamed chapters", async ({ page }) => {
    const chapterNames = async () =>
      page.locator(".chapter-item__text").allTextContents();
    // Poll instead of a fixed wait so a slow machine waits for detection
    // rather than racing the poll interval.
    const expectChapters = (names) =>
      expect.poll(chapterNames, { timeout: SETTLE * 3 }).toEqual(names);
    expect(await chapterNames()).toEqual(["Course Overview", "Alpha", "Beta"]);

    // 1. Add a chapter: new file + link in coursebook.md.
    await page.evaluate(async () => {
      await window.__opfsWrite("chapters/gamma.md", "# Gamma\n\nGamma content.\n");
      await window.__opfsWrite(
        "coursebook.md",
        "# OPFS Course\n\n- [Alpha](chapters/alpha.md)\n- [Beta](chapters/beta.md)\n- [Gamma](chapters/gamma.md)\n",
      );
    });
    await expectChapters(["Course Overview", "Alpha", "Beta", "Gamma"]);

    // 2. Rename a chapter: the sidebar title follows the chapter's # h1.
    await page.evaluate(async () => {
      await window.__opfsWrite(
        "chapters/beta.md",
        "# Beta Renamed\n\nBeta content.\n\n## Beta One\n\nText.\n",
      );
    });
    await expectChapters(["Course Overview", "Alpha", "Beta Renamed", "Gamma"]);

    // 3. Drop a chapter from coursebook.md.
    await page.evaluate(async () => {
      await window.__opfsWrite(
        "coursebook.md",
        "# OPFS Course\n\n- [Alpha](chapters/alpha.md)\n- [Beta Renamed](chapters/beta.md)\n",
      );
    });
    await expectChapters(["Course Overview", "Alpha", "Beta Renamed"]);
  });

  test("external chapter content edit re-renders the section", async ({ page }) => {
    await page.evaluate(async () => {
      await window.__opfsWrite(
        "chapters/alpha.md",
        "# Alpha\n\nCHANGED BY EXTERNAL EDIT.\n\n## Alpha One\n\nText.\n",
      );
    });
    await page.waitForTimeout(SETTLE);
    await expect(page.locator("#alpha")).toContainText("CHANGED BY EXTERNAL EDIT");
  });

  test("in-app h1 edit follows through to the sidebar on save", async ({ page }) => {
    const chapterNames = async () =>
      page.locator(".chapter-item__text").allTextContents();
    // OPFS locks a file while a write is in flight, so reads must retry.
    const readFile = (path) =>
      page.evaluate((p) => window.__opfsRead(p), path).catch(() => "");
    expect(await chapterNames()).toEqual(["Course Overview", "Alpha", "Beta"]);

    // Open the Beta chapter and rename its # h1 in the in-app editor.
    await page.locator(".chapter-item", { hasText: "Beta" }).click();
    const section = page.locator("#beta");
    await expect(section).toHaveClass(/active/);
    await page.locator("#toggleEditBtn").click();
    const editor = page.locator("#editor");
    await editor.waitFor({ state: "visible" });
    await editor
      .locator(".cm-content")
      .fill("# Beta In-App\n\nBeta content.\n\n## Beta One\n\nText.\n");

    // The debounced preview re-render shows the new h1 — and the sidebar
    // follows live, before any save. (The sync renames the section id to
    // the new slug, so assert against #beta-in-app.)
    await expect
      .poll(chapterNames, { timeout: SETTLE * 2 })
      .toEqual(["Course Overview", "Alpha", "Beta In-App"]);
    await expect(page.locator("#beta-in-app h1")).toHaveText(/Beta In-App/);

    await page.locator("#saveBtn").click();

    // Sidebar, section id, and top bar still hold the saved title...
    await expect
      .poll(chapterNames, { timeout: SETTLE * 2 })
      .toEqual(["Course Overview", "Alpha", "Beta In-App"]);
    await expect(page.locator("#beta-in-app")).toHaveClass(/active/);
    await expect(page.locator("#chapterTitle")).toHaveText(/OPFS Course — Beta In-App/);
    // ...and the renamed file actually reached disk.
    await expect
      .poll(() => readFile("chapters/beta.md"), { timeout: SETTLE * 2 })
      .toContain("# Beta In-App");
  });

  test("in-app coursebook.md chapter list edit rebuilds the sidebar live", async ({
    page,
  }) => {
    const chapterNames = async () =>
      page.locator(".chapter-item__text").allTextContents();
    expect(await chapterNames()).toEqual(["Course Overview", "Alpha", "Beta"]);

    // The chapter file exists; the link in coursebook.md is what's missing.
    await page.evaluate(async () => {
      await window.__opfsWrite("chapters/gamma.md", "# Gamma\n\nGamma content.\n");
    });

    // Edit the chapter list on the overview: the editor holds coursebook.md.
    await page.locator("#toggleEditBtn").click();
    const editor = page.locator("#editor");
    await editor.waitFor({ state: "visible" });
    await editor
      .locator(".cm-content")
      .fill(
        "# OPFS Course\n\n- [Alpha](chapters/alpha.md)\n- [Beta](chapters/beta.md)\n- [Gamma](chapters/gamma.md)\n",
      );

    // The sidebar picks up the added chapter live, without saving.
    await expect
      .poll(chapterNames, { timeout: SETTLE * 2 })
      .toEqual(["Course Overview", "Alpha", "Beta", "Gamma"]);
    await expect(page.locator("#gamma")).toContainText("Gamma content.");

    // Saving persists the edited coursebook.md; the live structure stays.
    await page.locator("#saveBtn").click();
    // OPFS locks a file while a write is in flight; retries must tolerate it.
    const readFile = (path) =>
      page.evaluate((p) => window.__opfsRead(p), path).catch(() => "");
    await expect
      .poll(() => readFile("coursebook.md"), { timeout: SETTLE * 2 })
      .toContain("[Gamma](chapters/gamma.md)");
    await expect
      .poll(chapterNames, { timeout: SETTLE * 2 })
      .toEqual(["Course Overview", "Alpha", "Beta", "Gamma"]);
  });
});

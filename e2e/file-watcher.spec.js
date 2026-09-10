import { test, expect } from "@playwright/test";

// A flake here hangs on a locator that can never appear (a Vite full reload
// wipes the in-flight OPFS session), so this timeout is pure flake cost. It is
// set just above the slowest legitimate path through openOpfsCoursebook rather
// than at the 120s that let a single flake burn two minutes.
test.setTimeout(60000);

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

// Poll budget: one 2s watcher interval + the 450ms settle window + render.
const SETTLE = 4000;
// Seeding the baseline needs no interval tick: opening an OPFS coursebook
// calls seedPoll() immediately, and a poll with no recorded baseline settles
// nothing, so this only has to cover those OPFS reads.
const SEED_SETTLE = 800;

async function openOpfsCoursebook(page) {
  await page.goto("/");
  await page.evaluate(() => window.__setupCoursebook());
  // The URL-loaded docs coursebook also renders #overview, so detecting a
  // successful OPFS open needs an OPFS-only marker: the "Alpha" chapter. If
  // the picker mock was wiped (e.g. a Vite full-reload mid-test), the real
  // showDirectoryPicker hangs silently — reinstall the mock and retry.
  const alphaItem = page.locator(".chapter-item__text", { hasText: "Alpha" }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.locator("#menuBtn").click();
    await page.locator("#menuOpenCoursebookBtn").click();
    try {
      await alphaItem.waitFor({ state: "visible", timeout: 5000 });
      // Let the watcher seed its baseline before simulating external edits.
      await page.waitForTimeout(SEED_SETTLE);
      return;
    } catch {
      await page.evaluate(() => window.__setupCoursebook());
    }
  }
  // Last-ditch after three failed attempts: enough for a genuinely slow load,
  // without adding half a minute of dead waiting to a doomed run.
  await alphaItem.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(SEED_SETTLE);
}

test.describe("file watcher end-to-end (OPFS)", () => {
  test.beforeEach(async ({ page }) => {
    await setupOpfs(page);
    // These tests exercise the silent auto-apply watcher behavior, which is
    // opt-in via Settings (the default is the reload prompt).
    await page.addInitScript(() => {
      localStorage.setItem("coursebookmd_auto_reload", "1");
    });
    await openOpfsCoursebook(page);
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
    // The watcher polls, so let the assertion retry until detection instead of
    // sleeping a fixed interval first.
    await expect(page.locator("#alpha")).toContainText("CHANGED BY EXTERNAL EDIT", {
      timeout: SETTLE * 3,
    });
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

test.describe("manual reload coursebook (OPFS)", () => {
  test.beforeEach(async ({ page }) => {
    await setupOpfs(page);
    await openOpfsCoursebook(page);
  });

  test("reload picks up external edits but keeps unsaved in-app edits", async ({
    page,
  }) => {
    const readFile = (path) =>
      page.evaluate((p) => window.__opfsRead(p), path).catch(() => "");

    // Edit Alpha in-app (keep its h1 so the section id stays stable).
    await page.locator(".chapter-item", { hasText: "Alpha" }).click();
    await expect(page.locator("#alpha")).toHaveClass(/active/);
    await page.locator("#toggleEditBtn").click();
    const editor = page.locator("#editor");
    await editor.waitFor({ state: "visible" });
    await editor
      .locator(".cm-content")
      .fill("# Alpha\n\nAlpha edited in-app.\n\n## Alpha One\n\nText.\n");
    await expect(page.locator("#saveBtn")).toBeEnabled();

    // External processes rewrite Alpha and Beta on disk.
    await page.evaluate(async () => {
      await window.__opfsWrite(
        "chapters/alpha.md",
        "# Alpha\n\nAlpha rewritten externally.\n",
      );
      await window.__opfsWrite(
        "chapters/beta.md",
        "# Beta\n\nBETA RELOADED FROM DISK.\n\n## Beta One\n\nText.\n",
      );
    });

    await page.locator("#menuBtn").click();
    await page.locator("#menuReloadBtn").click();

    // Beta (clean) shows the disk version; Alpha keeps the in-app edit.
    await expect
      .poll(() => page.locator("#beta").textContent(), { timeout: SETTLE * 2 })
      .toContain("BETA RELOADED FROM DISK");
    await expect(page.locator("#alpha")).toContainText("Alpha edited in-app.");
    await expect(page.locator("#saveBtn")).toBeEnabled();

    // Saving writes the preserved in-app edit over the external version.
    await page.locator("#saveBtn").click();
    await expect
      .poll(() => readFile("chapters/alpha.md"), { timeout: SETTLE * 2 })
      .toContain("Alpha edited in-app.");
  });
});

test.describe("external change prompt (OPFS)", () => {
  test.beforeEach(async ({ page }) => {
    await setupOpfs(page);
    await openOpfsCoursebook(page);
  });

  test("external changes prompt instead of applying until confirmed", async ({
    page,
  }) => {
    await page.evaluate(async () => {
      await window.__opfsWrite(
        "chapters/beta.md",
        "# Beta\n\nPROMPTED RELOAD.\n\n## Beta One\n\nText.\n",
      );
    });

    // The "changed on disk" prompt appears only once a poll has seen the
    // change without applying it, so waiting for that text is the real
    // precondition for asserting the section was left untouched.
    const prompt = page.locator("#appActionToast");
    await expect(prompt).toContainText("changed on disk", { timeout: SETTLE * 3 });
    await expect(page.locator("#beta")).toContainText("Beta content.");
    // exact: "Reload" is a substring of the "Always auto-reload" button.
    await prompt.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(page.locator("#beta")).toContainText("PROMPTED RELOAD");
    await expect(prompt).not.toBeVisible();
  });

  test("the prompt can enable auto-reload directly", async ({ page }) => {
    await page.evaluate(async () => {
      await window.__opfsWrite(
        "chapters/beta.md",
        "# Beta\n\nENABLED FROM PROMPT.\n\n## Beta One\n\nText.\n",
      );
    });
    const prompt = page.locator("#appActionToast");
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: "Always auto-reload" }).click();

    // The pending change is applied and the setting is persisted.
    await expect(page.locator("#beta")).toContainText("ENABLED FROM PROMPT");
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("coursebookmd_auto_reload")))
      .toBe("1");

    // Further changes auto-apply without a new prompt.
    await page.evaluate(async () => {
      await window.__opfsWrite(
        "chapters/beta.md",
        "# Beta\n\nAUTO APPLIED AGAIN.\n\n## Beta One\n\nText.\n",
      );
    });
    await expect
      .poll(() => page.locator("#beta").textContent(), { timeout: SETTLE * 2 })
      .toContain("AUTO APPLIED AGAIN");
    await expect(page.locator("#appActionToast")).not.toHaveClass(/is-visible/);
  });
});

test.describe("manual reload coursebook (URL mode)", () => {
  test("re-fetches the coursebook and preserves unsaved edits", async ({ page }) => {
    await page.goto("/");
    await page.locator("#overview").waitFor({ state: "visible", timeout: 30000 });

    await page.locator(".chapter-item", { hasText: "Getting Started" }).click();
    await expect(page.locator("#getting-started")).toHaveClass(/active/);
    await page.locator("#toggleEditBtn").click();
    const editor = page.locator("#editor");
    await editor.waitFor({ state: "visible" });
    await editor
      .locator(".cm-content")
      .fill(
        "# Getting Started\n\nPRESERVED ACROSS RELOAD.\n\n## What is a coursebook?\n\nText.\n",
      );
    await expect(page.locator("#saveBtn")).toBeEnabled();

    await page.locator("#menuBtn").click();
    await page.locator("#menuReloadBtn").click();

    await expect
      .poll(() => page.locator("#getting-started").textContent(), {
        timeout: SETTLE * 2,
      })
      .toContain("PRESERVED ACROSS RELOAD");
    await expect(page.locator("#getting-started")).toHaveClass(/active/);
    await expect(page.locator("#saveBtn")).toBeEnabled();
    await expect(page.locator(".chapter-item__text")).toHaveText([
      "Course Overview",
      "Getting Started",
      "Writing Content",
      "Rich Content",
      "Present and Export",
      "Image Credits",
      "Index",
    ]);
  });

  test("reload is disabled in standalone mode", async ({ page }) => {
    // Vite's SPA fallback would serve index.html for a missing .md path, so
    // abort the request to exercise the app's standalone fallback instead.
    await page.route("**/missing.md", (route) => route.abort());
    await page.goto("/?coursebook=missing.md");
    await page.locator("#content h1").waitFor({ state: "visible", timeout: 30000 });

    await page.locator("#menuBtn").click();
    await expect(page.locator("#menuReloadBtn")).toBeDisabled();
  });
});

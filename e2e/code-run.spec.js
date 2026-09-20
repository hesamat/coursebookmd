import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

test.setTimeout(120000);

const RICH_CONTENT_PATH = "/#rich-content";
const RICH_CONTENT_SOURCE = readFileSync(
  new URL("../docs/chapters/03-rich-content.md", import.meta.url),
  "utf8",
);

async function openRichContent(page) {
  await page.goto(RICH_CONTENT_PATH);
  const section = page.locator("#rich-content");
  await section.waitFor({ state: "visible", timeout: 60000 });
  return section;
}

test.describe("Runnable code blocks", () => {
  test("run buttons appear only on fences opted in with run", async ({ page }) => {
    const section = await openRichContent(page);

    await expect(section.locator('pre[data-lang="python"] .code-run-button')).toHaveCount(
      2,
    ); // the greet example and the REPL transcript
    await expect(
      section.locator('pre[data-lang="javascript"] .code-run-button'),
    ).toHaveCount(1); // the reduce example

    // Plain python/javascript blocks keep their copy button but get no run
    // button — runnable is an authoring opt-in.
    const plain = section.locator("pre", { hasText: "toggleTheme" });
    await expect(plain.locator(".code-run-button")).toHaveCount(0);
    await expect(plain.locator(".code-copy-button")).toHaveCount(1);

    // Other languages stay button-free on the run side.
    await page.goto("/#writing-content");
    const writing = page.locator("#writing-content");
    await writing.waitFor({ state: "visible", timeout: 60000 });
    await expect(writing.locator('pre[data-lang="bash"] .code-run-button')).toHaveCount(
      0,
    );
  });

  test("javascript block runs in the browser and streams output", async ({ page }) => {
    const section = await openRichContent(page);

    const pre = section.locator("pre", { hasText: "reduce" });
    await pre.locator(".code-run-button").click();

    const panel = page.locator(".code-run-output[data-run-for]");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Total: 10", { timeout: 20000 });
    await expect(panel).toContainText("Done in");
    await expect(pre.locator(".code-run-button")).not.toHaveClass(/is-running/);
  });

  test("python block runs with the CDN runtime stubbed", async ({ page }) => {
    // Keep the suite network-free: fulfill the Pyodide CDN with a stub that
    // reproduces the stdout-batching contract the worker relies on, in both
    // flavors the worker can load (classic global script and ES module).
    // The stub echoes the source it receives, so assertions below also pin
    // what the worker actually executes.
    const stubBody = `
      function makeRuntime() {
        let write = () => {};
        return {
          setStdout: ({ batched }) => { write = batched; },
          setStderr: () => {},
          setStdin: () => {},
          runPythonAsync: async (source) => {
            write(source);
            return undefined;
          },
          globals: { set: () => {} },
          runPython: () => "None",
        };
      }
    `;
    await page.route("https://cdn.jsdelivr.net/pyodide/**", async (route) => {
      const url = route.request().url();
      if (url.endsWith("/pyodide.js")) {
        await route.fulfill({
          contentType: "text/javascript",
          body: `${stubBody}\nself.loadPyodide = async () => makeRuntime();`,
        });
        return;
      }
      if (url.endsWith("/pyodide.mjs")) {
        await route.fulfill({
          contentType: "text/javascript",
          body: `${stubBody}\nexport async function loadPyodide() { return makeRuntime(); }`,
        });
        return;
      }
      await route.fulfill({ status: 200, body: "" });
    });

    const section = await openRichContent(page);

    const pre = section.locator('pre[data-lang="python"]').first();
    await pre.locator(".code-run-button").click();

    const panel = page.locator(".code-run-output[data-run-for]");
    await expect(panel).toContainText('print(greet("CoursebookMD"))', {
      timeout: 20000,
    });
    await expect(panel).toContainText("Done in");
  });

  test("REPL transcripts are stripped of prompts before running", async ({ page }) => {
    const stubBody = `
      function makeRuntime() {
        let write = () => {};
        return {
          setStdout: ({ batched }) => { write = batched; },
          setStderr: () => {},
          setStdin: () => {},
          runPythonAsync: async (source) => {
            write(source);
            return undefined;
          },
          globals: { set: () => {} },
          runPython: () => "None",
        };
      }
    `;
    await page.route("https://cdn.jsdelivr.net/pyodide/**", async (route) => {
      const url = route.request().url();
      if (url.endsWith("/pyodide.js")) {
        await route.fulfill({
          contentType: "text/javascript",
          body: `${stubBody}\nself.loadPyodide = async () => makeRuntime();`,
        });
        return;
      }
      if (url.endsWith("/pyodide.mjs")) {
        await route.fulfill({
          contentType: "text/javascript",
          body: `${stubBody}\nexport async function loadPyodide() { return makeRuntime(); }`,
        });
        return;
      }
      await route.fulfill({ status: 200, body: "" });
    });

    const section = await openRichContent(page);

    // The REPL block is found by its transcript content: prompts are
    // auto-detected, no fence flag needed.
    const repl = section.locator("pre", { hasText: ">>>" });
    await repl.locator(".code-run-button").click();

    const panel = page.locator(".code-run-output[data-run-for]");
    await expect(panel).toContainText('print(f"Hello, {name}!")', {
      timeout: 20000,
    });
    const text = await panel.textContent();
    expect(text).not.toContain(">>>");
    // The transcript's shown output line is dropped, not executed or echoed.
    expect(text).not.toContain("Hello, CoursebookMD!");
  });

  test("output panel survives an unrelated prose edit above it", async ({ page }) => {
    const section = await openRichContent(page);

    const pre = section.locator("pre", { hasText: "reduce" });
    await pre.locator(".code-run-button").click();
    const panel = page.locator(".code-run-output[data-run-for]");
    await expect(panel).toContainText("Total: 10", { timeout: 20000 });
    const panelHandle = await panel.elementHandle();

    // Append a paragraph at the end: the run block sits in the unchanged
    // leading run, so the in-place refresh must reuse the pre and re-attach
    // its panel. (Prepending instead would rebuild the section — diagram
    // blocks at the tail never fingerprint-match their fresh containers.)
    await page.locator("#toggleEditBtn").click();
    const editor = page.locator("#editor");
    await editor.waitFor({ state: "visible", timeout: 30000 });
    await editor.locator(".cm-content").fill(`${RICH_CONTENT_SOURCE}\n\nFresh end note.`);
    await page.waitForTimeout(900);

    await expect
      .poll(() => section.innerText(), { timeout: 10000 })
      .toContain("Fresh end note.");

    expect(await panelHandle.evaluate((el) => el.isConnected)).toBe(true);
    expect(await panelHandle.evaluate((el) => el.textContent)).toContain("Total: 10");
    const adjacent = await page.evaluate(() => {
      const panel = document.querySelector(".code-run-output[data-run-for]");
      return panel?.previousElementSibling?.tagName === "PRE";
    });
    expect(adjacent).toBe(true);
  });
});

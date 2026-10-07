import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

const run = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolPath = path.join(projectRoot, "tools", "export-html.mjs");
// The docs coursebook ships a committed previews.json, so the exports below
// never touch the network — which is exactly the condition under which they
// must come out byte-identical.
const input = path.join(projectRoot, "docs", "coursebook.md");

test.setTimeout(480000);

const outputRoots = [];
test.afterAll(async () => {
  await Promise.all(
    outputRoots.map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

function runTool(args) {
  return run(process.execPath, [toolPath, ...args], {
    cwd: projectRoot,
    timeout: 240000,
  });
}

test.describe("CLI HTML export", () => {
  test("two consecutive exports of the same input are byte-identical", async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "coursebook-export-e2e-"));
    outputRoots.push(outDir);
    const firstPath = path.join(outDir, "first.html");
    const secondPath = path.join(outDir, "second.html");

    await runTool([input, "-o", firstPath]);
    await runTool([input, "-o", secondPath]);

    const [first, second] = await Promise.all([
      fs.readFile(firstPath),
      fs.readFile(secondPath),
    ]);
    expect(first.equals(second)).toBe(true);

    // Previews were injected from the on-disk cache, and each attribute
    // carries the JSON object the exported viewer parses on hover.
    const html = first.toString("utf8");
    const rawPreview = html.match(/data-preview="([^"]+)"/)?.[1];
    expect(rawPreview).toBeTruthy();
    const decoded = rawPreview
      .replaceAll("&quot;", '"')
      .replaceAll("&amp;", "&")
      .replaceAll("&#39;", "'");
    expect(JSON.parse(decoded)).toMatchObject({
      title: expect.any(String),
      url: expect.stringMatching(/^https?:\/\//),
    });
  });
});

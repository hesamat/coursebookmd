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
const toolPath = path.join(projectRoot, "tools", "export-pdf.mjs");

const FIXTURE_FILES = {
  "coursebook.md": [
    "# PDF Export Test Course",
    "",
    "An overview paragraph.",
    "",
    "- [Alpha Chapter](chapters/01-alpha.md)",
    "- [Beta Chapter](chapters/02-beta.md)",
    "- [Gamma Chapter](chapters/03-gamma.md)",
    "",
  ].join("\n"),
  "chapters/01-alpha.md": [
    "# Alpha Chapter",
    "",
    "Intro paragraph with `code`.",
    "",
    "```js",
    "const alpha = 1;",
    "```",
    "",
  ].join("\n"),
  "chapters/02-beta.md": [
    "# Beta Chapter",
    "",
    "Beta paragraph.",
    "",
    "- item one",
    "- item two",
    "",
  ].join("\n"),
  "chapters/03-gamma.md": ["# Gamma Chapter", "", "Gamma paragraph.", ""].join("\n"),
};

const fixtureRoots = [];
test.afterAll(async () => {
  await Promise.all(
    fixtureRoots.map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function writeFixtureCoursebook({ withExtra = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coursebook-pdf-e2e-"));
  const files = { ...FIXTURE_FILES };
  if (withExtra) {
    files["coursebook.md"] = files["coursebook.md"].replace(
      "An overview paragraph.",
      "An overview paragraph.\n\n[Companion](extra.md)",
    );
    files["extra.md"] = "# Companion\n\nExtra reading.\n";
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
  fixtureRoots.push(root);
  return root;
}

function runTool(args) {
  return run(process.execPath, [toolPath, ...args], {
    cwd: projectRoot,
    timeout: 180000,
  });
}

async function expectPdf(filePath) {
  const bytes = await fs.readFile(filePath);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1000);
}

test("writes one whole-book PDF by default", async () => {
  test.setTimeout(240000);
  const root = await writeFixtureCoursebook();
  const outDir = path.join(root, "out");

  const { stdout } = await runTool([
    path.join(root, "coursebook.md"),
    "--out-dir",
    outDir,
    "--no-header",
  ]);

  expect(stdout).toContain("from 4 section(s)");
  await expectPdf(path.join(outDir, "coursebook.pdf"));
});

test("--split chapters writes one PDF per chapter", async () => {
  test.setTimeout(240000);
  const root = await writeFixtureCoursebook();
  const outDir = path.join(root, "out");

  const { stdout } = await runTool([
    path.join(root, "coursebook.md"),
    "--out-dir",
    outDir,
    "--no-header",
    "--split",
    "chapters",
  ]);

  const names = (await fs.readdir(outDir)).sort();
  expect(names).toEqual([
    "01-alpha-chapter.pdf",
    "02-beta-chapter.pdf",
    "03-gamma-chapter.pdf",
  ]);
  expect(stdout.match(/from 1 section\(s\)/g)).toHaveLength(3);
  for (const name of names) {
    await expectPdf(path.join(outDir, name));
  }
});

test("--chapters selects a subset", async () => {
  test.setTimeout(240000);
  const root = await writeFixtureCoursebook();
  const outDir = path.join(root, "out");

  const { stdout } = await runTool([
    path.join(root, "coursebook.md"),
    "-o",
    path.join(outDir, "subset.pdf"),
    "--chapters",
    "1-2",
    "--no-header",
  ]);

  expect(stdout).toContain("from 2 section(s)");
  await expectPdf(path.join(outDir, "subset.pdf"));
});

test("numeric chapter selection skips extras while slug selection includes them", async () => {
  test.setTimeout(240000);
  const root = await writeFixtureCoursebook({ withExtra: true });
  const outDir = path.join(root, "out");
  const numeric = await runTool([
    path.join(root, "coursebook.md"),
    "-o",
    path.join(outDir, "numbered.pdf"),
    "--chapters",
    "2-3",
    "--no-header",
  ]);
  expect(numeric.stdout).toContain("from 2 section(s)");
  await expectPdf(path.join(outDir, "numbered.pdf"));

  const extra = await runTool([
    path.join(root, "coursebook.md"),
    "-o",
    path.join(outDir, "extra.pdf"),
    "--chapters",
    "companion",
    "--no-header",
  ]);
  expect(extra.stdout).toContain("from 1 section(s)");
  await expectPdf(path.join(outDir, "extra.pdf"));
});

test("--presets produces named outputs", async () => {
  test.setTimeout(240000);
  const root = await writeFixtureCoursebook();
  const outDir = path.join(root, "out");
  const presetsPath = path.join(root, "presets.json");
  await fs.writeFile(
    presetsPath,
    JSON.stringify({
      institution: "Test Institute",
      campus: "Downtown Campus",
      term: "Fall 2026",
      outputs: [
        { name: "Full Book" },
        { name: "Part One", chapters: "1-2", label: "Week 1" },
      ],
    }),
  );

  const { stdout } = await runTool([
    path.join(root, "coursebook.md"),
    "--presets",
    presetsPath,
    "--out-dir",
    outDir,
  ]);

  expect(stdout).toContain("from 4 section(s)");
  expect(stdout).toContain("from 2 section(s)");
  await expectPdf(path.join(outDir, "Full Book.pdf"));
  await expectPdf(path.join(outDir, "Part One.pdf"));
});

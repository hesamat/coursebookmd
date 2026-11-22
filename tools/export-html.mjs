/**
 * Export a coursebook (or a single markdown file) to a standalone HTML
 * document from the CLI.
 *
 * The export pipeline needs browser APIs (Shiki, KaTeX, D2), so the script
 * boots the Vite dev server in-process, opens the app in headless Chromium,
 * and saves the file produced by the app's own "Export HTML" action.
 *
 * Usage:
 *   node tools/export-html.mjs <coursebook.md> [-o <output.html>]
 *
 * Link previews come from previews.json next to the coursebook (built once
 * with the build-previews.mjs providers when it does not exist yet), so two
 * exports of the same input are byte-identical.
 *
 * The flow is also importable for other tools (see export-pdf.mjs):
 * exportHtmlFromMarkdown(inputPath, outPath) runs the same export and
 * resolves to the written file's path.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { buildPreviews, collectPreviewUrls } from "./build-previews.mjs";
import { ensurePythonDocs } from "./generate-python-docs.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Coursebooks outside this folder are served from their own directory by the
// fallback middleware below; vite.config.mjs only maps ../myCourses.
const myCoursesRoot = path.resolve(projectRoot, "../myCourses");

const MIME_TYPES = {
  ".md": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
};

function usage() {
  console.error(
    "Usage: node tools/export-html.mjs <coursebook.md> [-o <output.html>] [--strict]",
  );
}

function parseArgs(argv) {
  let inputPath = null;
  let outPath = null;
  let strict = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-o" || arg === "--out") {
      outPath = argv[++i];
      if (!outPath) {
        usage();
        process.exit(1);
      }
    } else if (arg === "--strict") {
      // Promote doc-card validation warnings to failures; errors always fail.
      strict = true;
    } else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      usage();
      process.exit(1);
    } else if (inputPath === null) {
      inputPath = arg;
    } else {
      usage();
      process.exit(1);
    }
  }
  return { inputPath, outPath, strict };
}

const toUrlPath = (p) => p.split(path.sep).map(encodeURIComponent).join("/");

function serveCoursebookDir(baseDir) {
  return {
    name: "export-cli-coursebook-dir",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        const pathname = decodeURIComponent(req.url.split("?")[0]);
        if (!pathname.startsWith("/courses/")) return next();
        const relPath = pathname.slice("/courses/".length);
        const filePath = path.resolve(baseDir, relPath);
        // Prevent path traversal outside baseDir
        if (!filePath.startsWith(baseDir)) return next();
        let content;
        try {
          content = await fs.readFile(filePath);
        } catch {
          return next();
        }
        const type =
          MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
        res.setHeader("Content-Type", type);
        res.end(content);
      });
    },
  };
}

/**
 * The exporter inlines dist/export-runtime.iife.js, so an export made while
 * that bundle trails src/ (or the generated builtin dataset) would silently
 * ship an old viewer. Compare the newest input mtime against the bundle and
 * rebuild when it is behind (test files do not ship, so they are ignored).
 */
async function ensureRuntimeBundleFresh() {
  const bundlePath = path.join(projectRoot, "dist", "export-runtime.iife.js");
  let bundleMtime = 0;
  try {
    bundleMtime = (await fs.stat(bundlePath)).mtimeMs;
  } catch {
    bundleMtime = 0;
  }

  let newest = 0;
  for (const inputDir of [
    path.join(projectRoot, "src"),
    path.join(projectRoot, "generated"),
  ]) {
    const entries = await fs.readdir(inputDir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.endsWith(".test.js")) continue;
      const full = path.join(entry.parentPath ?? entry.path ?? inputDir, entry.name);
      const stat = await fs.stat(full);
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    }
  }

  if (bundleMtime >= newest) return;
  console.log(
    "Viewer runtime bundle is older than src/ or generated/ — rebuilding it first...",
  );
  execFileSync("npm", ["run", "build:export-runtime"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
}

/**
 * Deterministic exports read link previews from previews.json next to the
 * coursebook — never from live fetches, whose timing and results differ run
 * to run. Build the cache once when the coursebook has none yet so a first
 * export works offline-later, and flag a cache that predates the current
 * content (links it has never seen would silently export without previews).
 */
async function ensurePreviewsCache(coursebookAbs) {
  const cachePath = path.join(path.dirname(coursebookAbs), "previews.json");
  let cached = null;
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf8"));
    if (parsed && typeof parsed === "object") cached = parsed;
  } catch {
    // Missing or unparsable: a fresh cache is built below.
  }

  if (!cached) {
    console.log(
      "No previews.json next to the coursebook — building the link preview cache once...",
    );
    await buildPreviews(coursebookAbs);
    return;
  }

  const urls = await collectPreviewUrls(coursebookAbs);
  const missing = urls.filter((url) => !Object.hasOwn(cached, url));
  if (missing.length > 0) {
    console.warn(
      `previews.json covers ${urls.length - missing.length} of ${urls.length} link(s) in this ` +
        "coursebook; the rest will export without previews. Refresh it with: " +
        "node tools/build-previews.mjs <coursebook.md> --cache",
    );
  }
}

/**
 * Validate the coursebook's doc-cards.md glossary in Node before any browser
 * work, and activate the registry in this process so collectPreviewUrls'
 * extractLinks skips registry URLs. A glossary with semantic errors fails
 * the export here — otherwise the in-app export would refuse to download and
 * the CLI would burn its 120 s download timeout. `strict` promotes warnings
 * to the same failure. The coursebook is loaded for the glossary chapter's
 * slug so URL-less entries resolve exactly like they do in the app.
 */
async function validateAndActivateDocCards(coursebookAbs, { strict }) {
  const { buildRegistry, setActiveDocCards } = await import("../src/core/doc-cards.js");
  const { buildGlossaryRegistry } = await import("../src/core/doc-cards-glossary.js");
  const { loadCoursebook } = await import("../src/core/coursebook-loader.js");
  const baseDir = path.dirname(coursebookAbs);
  const docCardsPath = path.join(baseDir, "doc-cards.md");
  let markdown;
  try {
    markdown = await fs.readFile(docCardsPath, "utf8");
  } catch {
    setActiveDocCards(buildRegistry({ packs: ["python"] }));
    return;
  }
  const coursebook = await loadCoursebook(coursebookAbs, undefined, (p) =>
    fs.readFile(p, "utf8"),
  );
  const glossaryChapterSlug =
    coursebook.chapters.find(
      (chapter) => (chapter.resolvedPath || chapter.path) === docCardsPath,
    )?.slug ?? null;
  const { registry, problems } = buildGlossaryRegistry({
    markdown,
    sourcePath: docCardsPath,
    glossaryChapterSlug,
    baseDir: baseDir,
  });
  for (const warning of problems.warnings) console.warn(`Doc cards warning: ${warning}`);
  if (problems.errors.length > 0 || (strict && problems.warnings.length > 0)) {
    const kind = problems.errors.length > 0 ? "errors" : "warnings";
    throw new Error(
      `Doc cards have ${kind} that must be fixed before export:\n` +
        [...problems.errors, ...(strict ? problems.warnings : [])].join("\n"),
    );
  }
  setActiveDocCards(registry);
}

export async function exportHtmlFromMarkdown(
  inputPath,
  outPath,
  { strict = false } = {},
) {
  const coursebookAbs = path.resolve(inputPath);
  try {
    await fs.access(coursebookAbs);
  } catch {
    throw new Error(`File not found: ${coursebookAbs}`);
  }
  const baseDir = path.dirname(coursebookAbs);

  // The exported viewer bundles the builtin docs dataset, so generate it
  // before the runtime bundle is built or the coursebook is rendered.
  await ensurePythonDocs();

  // Doc-card validation first: a bad glossary fails here with its problem
  // list instead of refusing to download inside the browser (which would
  // hang the CLI until the download timeout).
  await validateAndActivateDocCards(coursebookAbs, { strict });

  await ensurePreviewsCache(coursebookAbs);

  const insideMyCourses = !path.relative(myCoursesRoot, coursebookAbs).startsWith("..");
  const coursebookUrlPath = insideMyCourses
    ? `/courses/${toUrlPath(path.relative(myCoursesRoot, coursebookAbs))}`
    : `/courses/${toUrlPath(path.relative(baseDir, coursebookAbs))}`;

  await ensureRuntimeBundleFresh();

  console.log("Starting Vite dev server...");
  // Each invocation gets its own Vite dep cache. Sharing node_modules/.vite
  // across concurrent servers (e.g. parallel e2e invocations) makes Vite
  // re-optimize under already-running pages and full-reload them mid-boot.
  const viteCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "coursebookmd-vite-"));
  const server = await createServer({
    configFile: path.join(projectRoot, "vite.config.mjs"),
    root: projectRoot,
    cacheDir: viteCacheDir,
    plugins: [serveCoursebookDir(baseDir)],
    server: { open: false, port: 0 },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls.local[0].replace(/\/+$/, "");

  console.log("Launching headless Chromium...");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  try {
    // previews=disk: the page renders previews from the seeded on-disk cache
    // only (see preloadMissingLinkPreviews); live fetches would vary per run.
    await page.goto(
      `${baseUrl}/?coursebook=${encodeURIComponent(coursebookUrlPath)}&previews=disk`,
      {
        waitUntil: "domcontentloaded",
      },
    );

    console.log(`Loading coursebook ${coursebookUrlPath} ...`);
    try {
      await page.locator("#chapterNav").waitFor({ state: "visible", timeout: 60000 });
    } catch {
      // While Vite re-optimizes dependencies it can full-reload the page and
      // leave the app half-booted. Once the dust settles, a fresh load works.
      console.log("App did not finish loading — reloading once...");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("#chapterNav").waitFor({ state: "visible", timeout: 60000 });
    }

    console.log("Exporting HTML...");
    await page.locator("#menuBtn").click();
    const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
    // Export failures (doc-card validation problems) surface as a window
    // flag (export-controller.js exportHtml) so they fail fast with their
    // problem list instead of burning the download timeout. The flag's
    // VALUE travels through jsonValue() — `window` does not exist in Node.
    const failurePromise = page
      .waitForFunction(() => window.__coursebookExportFailed || null, null, {
        timeout: 120000,
      })
      .then((handle) => handle.jsonValue());
    failurePromise.catch(() => {});
    await page.locator("#menuExportHtmlBtn").click();
    const download = await Promise.race([
      downloadPromise,
      failurePromise.then((message) => {
        throw new Error(`Export failed: ${message}`);
      }),
    ]);

    const output = path.resolve(outPath ?? download.suggestedFilename());
    await fs.mkdir(path.dirname(output), { recursive: true });
    await download.saveAs(output);

    const html = await fs.readFile(output, "utf8");
    const trimmed = html.trimStart().toLowerCase();
    if (
      !trimmed.startsWith("<!doctype html>") ||
      !html.includes('id="coursebook-data"')
    ) {
      throw new Error(
        `Exported file at ${output} does not look like a coursebook export`,
      );
    }

    console.log(`Exported: ${output}`);
    if (pageErrors.length > 0) {
      console.warn("Uncaught page errors during export:");
      for (const err of pageErrors) console.warn(`  ${err}`);
    }
    return output;
  } finally {
    await browser.close();
    await server.close();
    await fs.rm(viteCacheDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { inputPath, outPath, strict } = parseArgs(process.argv.slice(2));
  if (!inputPath) {
    usage();
    process.exit(1);
  }
  exportHtmlFromMarkdown(inputPath, outPath, { strict }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

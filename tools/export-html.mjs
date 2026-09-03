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
 */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

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
  console.error("Usage: node tools/export-html.mjs <coursebook.md> [-o <output.html>]");
}

function parseArgs(argv) {
  let inputPath = null;
  let outPath = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-o" || arg === "--out") {
      outPath = argv[++i];
      if (!outPath) {
        usage();
        process.exit(1);
      }
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
  return { inputPath, outPath };
}

const { inputPath, outPath } = parseArgs(process.argv.slice(2));
if (!inputPath) {
  usage();
  process.exit(1);
}

const coursebookAbs = path.resolve(inputPath);
try {
  await fs.access(coursebookAbs);
} catch {
  console.error(`File not found: ${coursebookAbs}`);
  process.exit(1);
}
const baseDir = path.dirname(coursebookAbs);

const toUrlPath = (p) => p.split(path.sep).map(encodeURIComponent).join("/");

const insideMyCourses = !path.relative(myCoursesRoot, coursebookAbs).startsWith("..");
const coursebookUrlPath = insideMyCourses
  ? `/courses/${toUrlPath(path.relative(myCoursesRoot, coursebookAbs))}`
  : `/courses/${toUrlPath(path.relative(baseDir, coursebookAbs))}`;

function serveCoursebookDir() {
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

console.log("Starting Vite dev server...");
const server = await createServer({
  configFile: path.join(projectRoot, "vite.config.mjs"),
  root: projectRoot,
  plugins: [serveCoursebookDir()],
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
  await page.goto(`${baseUrl}/?coursebook=${encodeURIComponent(coursebookUrlPath)}`, {
    waitUntil: "domcontentloaded",
  });

  console.log(`Loading coursebook ${coursebookUrlPath} ...`);
  await page.locator("#chapterNav").waitFor({ state: "visible", timeout: 60000 });

  console.log("Exporting HTML...");
  await page.locator("#menuBtn").click();
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
  await page.locator("#menuExportHtmlBtn").click();
  const download = await downloadPromise;

  const output = path.resolve(outPath ?? download.suggestedFilename());
  await fs.mkdir(path.dirname(output), { recursive: true });
  await download.saveAs(output);

  const html = await fs.readFile(output, "utf8");
  const trimmed = html.trimStart().toLowerCase();
  if (!trimmed.startsWith("<!doctype html>") || !html.includes('id="coursebook-data"')) {
    throw new Error(`Exported file at ${output} does not look like a coursebook export`);
  }

  console.log(`Exported: ${output}`);
  if (pageErrors.length > 0) {
    console.warn("Uncaught page errors during export:");
    for (const err of pageErrors) console.warn(`  ${err}`);
  }
} finally {
  await browser.close();
  await server.close();
}

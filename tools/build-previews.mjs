/**
 * Build the link-preview cache for a coursebook: fetch a preview for every
 * http(s) link in it and write previews.json next to the coursebook file.
 *
 * CLI:
 *   node tools/build-previews.mjs [coursebook.md] [--cache]
 *
 * `--cache` reuses previews already in the output file, which keeps the e2e
 * pretest hook off the network in the common case. The fetch stage is also
 * importable: tools/export-html.mjs builds a first cache when a coursebook
 * has none yet, so exports themselves never fetch previews.
 */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { getBaseDir, loadCoursebook } from "../src/core/coursebook-loader.js";
import {
  JinaReaderProvider,
  WikipediaProvider,
  extractLinks,
} from "../src/renderer/link-preview.js";

// This runs as the e2e pretest hook, so a hung request must not stall the
// suite: bound every fetch.
export const REQUEST_TIMEOUT_MS = 10000;
export const CONCURRENCY = 5;

// Vite loads .env (envPrefix "JINA_") for the app; plain Node has to do it
// itself. No-op when the file is absent; real environment variables win.
try {
  process.loadEnvFile();
} catch {
  // No .env next to the package.json: run with the ambient environment only.
}

const providers = [new WikipediaProvider(), new JinaReaderProvider()];

async function loadFile(resolvedPath) {
  return fs.readFile(resolvedPath, "utf8");
}

/** Every http(s) URL linked from the coursebook's landing page or chapters. */
export async function collectPreviewUrls(inputPath) {
  const coursebook = await loadCoursebook(inputPath, undefined, loadFile);
  const urls = new Set(extractLinks(coursebook.markdown));
  for (const chapter of coursebook.chapters) {
    if (chapter.markdown) {
      for (const u of extractLinks(chapter.markdown)) urls.add(u);
    }
  }
  return [...urls];
}

async function readCache(outputPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(outputPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Fetch previews for every link in the coursebook and write previews.json
 * next to it.
 *
 * Only successful previews are reused from the cache; empty or failed entries
 * are refetched, so one that could not be built is retried rather than
 * remembered as absent.
 */
export async function buildPreviews(inputPath, { useCache = false } = {}) {
  const outputPath = path.join(getBaseDir(inputPath) || ".", "previews.json");
  const urls = await collectPreviewUrls(inputPath);
  const cached = useCache ? await readCache(outputPath) : {};

  const results = {};
  const noProvider = [];
  const blocked = [];
  const failed = [];
  const reused = [];

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (url) => {
        if (cached[url]) {
          results[url] = cached[url];
          reused.push(url);
          return;
        }
        const provider = providers.find((p) => p.canHandle(url));
        if (!provider) {
          results[url] = null;
          noProvider.push(url);
          return;
        }
        try {
          const data = await provider.fetchPreview(url, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            apiKey: process.env.JINA_API_KEY,
          });
          if (data) {
            results[url] = data;
          } else {
            results[url] = null;
            blocked.push(url);
          }
        } catch (e) {
          console.error(`Failed ${url}:`, e.message);
          results[url] = null;
          failed.push(url);
        }
      }),
    );
  }

  await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
  return { outputPath, urls, previews: results, noProvider, blocked, failed, reused };
}

async function main() {
  const [, , parentPath = "docs/coursebook.md", ...flags] = process.argv;
  const useCache = flags.includes("--cache");

  const urls = await collectPreviewUrls(parentPath);
  if (urls.length === 0) {
    console.error("No http/https links found.");
    process.exit(0);
  }

  const { outputPath, previews, noProvider, blocked, failed, reused } =
    await buildPreviews(parentPath, { useCache });

  const ok = Object.values(previews).filter(Boolean).length;
  console.log(
    `Wrote ${ok} of ${urls.length} previews to ${outputPath}` +
      (reused.length ? ` (${reused.length} reused from cache)` : ""),
  );

  if (noProvider.length) {
    console.log("\nNo preview provider for:");
    for (const url of noProvider) console.log(`  - ${url}`);
  }
  if (blocked.length) {
    console.log("\nNo usable preview (sign-in/paywall/blocked/too short):");
    for (const url of blocked) console.log(`  - ${url}`);
  }
  if (failed.length) {
    console.log("\nFailed to fetch (network/error):");
    for (const url of failed) console.log(`  - ${url}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

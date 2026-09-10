import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { getBaseDir, loadCoursebook } from "../src/core/coursebook-loader.js";
import {
  JinaReaderProvider,
  WikipediaProvider,
  extractLinks,
} from "../src/renderer/link-preview.js";

const [, , parentPath = "docs/coursebook.md", ...flags] = process.argv;
const outputPath = path.join(getBaseDir(parentPath) || ".", "previews.json");

// This runs as the e2e pretest hook, so a hung request must not stall the
// suite: bound every fetch.
const REQUEST_TIMEOUT_MS = 10000;

const providers = [new WikipediaProvider(), new JinaReaderProvider()];
const apiKey = process.env.JINA_API_KEY;
const CONCURRENCY = 5;
// --cache reuses previews already in the output file, which keeps the pretest
// hook off the network in the common case.
const useCache = flags.includes("--cache");

async function loadFile(resolvedPath) {
  return fs.readFile(resolvedPath, "utf8");
}

async function readCache() {
  try {
    const parsed = JSON.parse(await fs.readFile(outputPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const coursebook = await loadCoursebook(parentPath, undefined, loadFile);

const urls = new Set(extractLinks(coursebook.markdown));
for (const chapter of coursebook.chapters) {
  if (chapter.markdown) {
    for (const u of extractLinks(chapter.markdown)) urls.add(u);
  }
}

const unique = [...urls];
if (unique.length === 0) {
  console.error("No http/https links found.");
  process.exit(0);
}

// Only successful previews are cached; empty or failed entries are refetched,
// so one that could not be built is retried rather than remembered as absent.
const cached = useCache ? await readCache() : {};

const results = {};
const noProvider = [];
const blocked = [];
const failed = [];
const reused = [];

for (let i = 0; i < unique.length; i += CONCURRENCY) {
  const batch = unique.slice(i, i + CONCURRENCY);
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
          apiKey,
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

const ok = Object.values(results).filter(Boolean).length;
console.log(
  `Wrote ${ok} of ${unique.length} previews to ${outputPath}` +
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

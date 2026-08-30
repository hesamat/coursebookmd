import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { getBaseDir, loadCoursebook } from "../src/core/coursebook-loader.js";
import { JinaReaderProvider, WikipediaProvider } from "../src/renderer/link-preview.js";

const [, , parentPath = "docs/coursebook.md"] = process.argv;
const outputPath = path.join(getBaseDir(parentPath) || ".", "previews.json");

const linkRegex = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)|<(https?:\/\/[^>]+)>/g;
const trailingPunct = /[.,;:!?)]+$/;

function cleanUrl(u) {
  return u.replace(trailingPunct, "");
}

function collectUrls(markdown) {
  if (!markdown) return new Set();
  const urls = new Set();
  for (const m of markdown.matchAll(linkRegex)) {
    urls.add(cleanUrl(m[1] ?? m[2]));
  }
  return urls;
}

const providers = [new WikipediaProvider(), new JinaReaderProvider()];
const apiKey = process.env.JINA_API_KEY;
const CONCURRENCY = 5;

async function loadFile(resolvedPath) {
  return fs.readFile(resolvedPath, "utf8");
}

const coursebook = await loadCoursebook(parentPath, undefined, loadFile);

const urls = collectUrls(coursebook.markdown);
for (const chapter of coursebook.chapters) {
  if (chapter.markdown) {
    for (const u of collectUrls(chapter.markdown)) urls.add(u);
  }
}

const unique = [...urls];
if (unique.length === 0) {
  console.error("No http/https links found.");
  process.exit(0);
}

const results = {};
for (let i = 0; i < unique.length; i += CONCURRENCY) {
  const batch = unique.slice(i, i + CONCURRENCY);
  await Promise.all(
    batch.map(async (url) => {
      const provider = providers.find((p) => p.canHandle(url));
      if (!provider) {
        results[url] = null;
        return;
      }
      try {
        const data = await provider.fetchPreview(url, { signal: undefined, apiKey });
        results[url] = data;
      } catch (e) {
        console.error(`Failed ${url}:`, e.message);
        results[url] = null;
      }
    }),
  );
}

await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
console.log(
  `Wrote ${Object.values(results).filter(Boolean).length} of ${unique.length} previews to ${outputPath}`,
);

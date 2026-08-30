import fs from "node:fs/promises";
import process from "node:process";
import { JinaReaderProvider, WikipediaProvider } from "../src/renderer/link-preview.js";

const [, , inputPath, outputPath = "previews.json"] = process.argv;
if (!inputPath) {
  console.error(
    "Usage: node --env-file=.env tools/extract-previews.mjs <markdown-file> [output-json]",
  );
  process.exit(1);
}

const markdown = await fs.readFile(inputPath, "utf8");
const linkRegex = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)|<(https?:\/\/[^>]+)>/g;
function cleanUrl(u) {
  return u.replace(/[.,;:!?)]+$/, "");
}

const urlMatches = [...markdown.matchAll(linkRegex)];
const urls = [...new Set(urlMatches.map((m) => cleanUrl(m[1] ?? m[2])).filter(Boolean))];

if (urls.length === 0) {
  console.error("No http/https links found.");
  process.exit(0);
}

const providers = [new WikipediaProvider(), new JinaReaderProvider()];
const apiKey = process.env.JINA_API_KEY;
const CONCURRENCY = 5;

const results = {};

for (let i = 0; i < urls.length; i += CONCURRENCY) {
  const batch = urls.slice(i, i + CONCURRENCY);
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
  `Wrote ${Object.values(results).filter(Boolean).length} of ${urls.length} previews to ${outputPath}`,
);

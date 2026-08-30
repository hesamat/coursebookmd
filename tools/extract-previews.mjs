import fs from "node:fs/promises";
import process from "node:process";
import {
  JinaReaderProvider,
  WikipediaProvider,
  extractLinks,
} from "../src/renderer/link-preview.js";

const [, , inputPath, outputPath = "previews.json"] = process.argv;
if (!inputPath) {
  console.error(
    "Usage: node --env-file=.env tools/extract-previews.mjs <markdown-file> [output-json]",
  );
  process.exit(1);
}

const markdown = await fs.readFile(inputPath, "utf8");
const urls = [...new Set(extractLinks(markdown))];

if (urls.length === 0) {
  console.error("No http/https links found.");
  process.exit(0);
}

const providers = [new WikipediaProvider(), new JinaReaderProvider()];
const apiKey = process.env.JINA_API_KEY;
const CONCURRENCY = 5;

const results = {};
const noProvider = [];
const blocked = [];
const failed = [];

for (let i = 0; i < urls.length; i += CONCURRENCY) {
  const batch = urls.slice(i, i + CONCURRENCY);
  await Promise.all(
    batch.map(async (url) => {
      const provider = providers.find((p) => p.canHandle(url));
      if (!provider) {
        results[url] = null;
        noProvider.push(url);
        return;
      }
      try {
        const data = await provider.fetchPreview(url, { signal: undefined, apiKey });
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
console.log(`Wrote ${ok} of ${urls.length} previews to ${outputPath}`);

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

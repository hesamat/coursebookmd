import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { ensurePythonDocs } from "./generate-python-docs.mjs";

const [, , inputPath, outputPath = "previews.json"] = process.argv;
if (!inputPath) {
  console.error(
    "Usage: node --env-file=.env tools/extract-previews.mjs <markdown-file> [output-json]",
  );
  process.exit(1);
}

// The renderer imports the generated builtin dataset, so create it before
// loading the module (the npm scripts and build tools do the same).
await ensurePythonDocs();
const { JinaReaderProvider, WikipediaProvider, extractLinks } =
  await import("../src/renderer/link-preview.js");

// Activate the author registry from a doc-cards.md sibling before collecting
// links, so authored links to registry URLs are excluded from baking exactly
// like they are excluded from hover fetching.
const { setActiveDocCards, buildRegistry } = await import("../src/core/doc-cards.js");
const { buildGlossaryRegistry } = await import("../src/core/doc-cards-glossary.js");
const docCardsPath = path.join(path.dirname(inputPath), "doc-cards.md");
try {
  const glossaryMarkdown = await fs.readFile(docCardsPath, "utf8");
  const { registry, problems } = buildGlossaryRegistry({
    markdown: glossaryMarkdown,
    sourcePath: docCardsPath,
    glossaryChapterSlug: null,
    baseDir: path.dirname(inputPath),
  });
  for (const warning of problems.warnings) console.warn(`Doc cards warning: ${warning}`);
  for (const error of problems.errors) console.warn(`Doc cards error: ${error}`);
  setActiveDocCards(registry);
} catch {
  // No doc-cards.md sibling: keep the bundled pack.
  setActiveDocCards(buildRegistry({ packs: ["python"] }));
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

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../..", "myCourses/COMP1510");
const htmlPath = "/tmp/week1.html";

const html = fs.readFileSync(htmlPath, "utf8");
const dom = new JSDOM(html);
const doc = dom.window.document;

// Cleanup document
const head = doc.querySelector("head");
if (head) head.remove();
doc.querySelectorAll("style").forEach((el) => el.remove());
doc.querySelectorAll(".h2tocs").forEach((el) => el.remove());
doc.querySelectorAll("a[name]").forEach((el) => el.remove());
doc.querySelectorAll("a[id]").forEach((a) => {
  if (!a.textContent.trim()) a.remove();
});
doc
  .querySelectorAll(".mandatory, .idx, .note, .warning")
  .forEach((el) => el.removeAttribute("class"));
doc.querySelectorAll("a").forEach((a) => {
  a.removeAttribute("target");
  a.removeAttribute("style");
});

// Remove embedded TOC
const tocH3 = [...doc.querySelectorAll("h3")].find(
  (h) => h.textContent.trim() === "Table of Contents",
);
if (tocH3 && tocH3.nextElementSibling?.tagName === "OL") {
  tocH3.nextElementSibling.remove();
  tocH3.remove();
}

// Detect pre language
for (const pre of doc.querySelectorAll("pre")) {
  const text = pre.textContent;
  const hasMathSymbols = /[×÷≤≥≠≈]/u.test(text);
  let lang = "";
  if (hasMathSymbols) {
    lang = "";
  } else if (
    /^(import |print\(|if |else:|for |while |def |class |score|width|height|area|price|quantity|total|name|age|number|day|x =|y =|F =|age =|>>> |>>>$)/m.test(
      text,
    ) ||
    /^width\s*=|^height\s*=|^area\s*=|^price\s*=|^quantity\s*=|^total\s*=|^x\s*=|^y\s*=|^score\s*=|^name\s*=|^age\s*=/m.test(
      text,
    )
  ) {
    lang = "python";
  } else if (/^(git |py |python|cd |mkdir |Get-|pwd|ls$|git remote)/m.test(text)) {
    lang = "sh";
  }
  pre.setAttribute("data-language", lang);
}

const turndownService = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
});
turndownService.use(gfm);

turndownService.addRule("preWithLanguage", {
  filter: ["pre"],
  replacement: (_content, node) => {
    const lang = node.getAttribute("data-language") || "";
    const text = node.textContent.replace(/\n$/, "");
    return "\n```" + lang + "\n" + text + "\n```\n";
  },
});

function cleanHeadingTitle(title) {
  // Remove leading 1.1. or 1. etc. but not "Week 1."
  return title.replace(/^(\d+\.\d+\.\s*|\d+\.\s+)/, "").trim();
}

function stripNumberedHeading(md) {
  return md.replace(/^(#+)\s+(\d+(?:\.\d+)*)\.\s+/gm, "$1 ");
}

function getH2Title(section) {
  const h2 = section.querySelector("h2");
  if (!h2) return "";
  const clone = h2.cloneNode(true);
  clone.querySelectorAll(".h2tocs, a[name], a[id]").forEach((el) => el.remove());
  return clone.textContent.replace(/\s+/g, " ").trim();
}

const sections = [...doc.body.querySelectorAll("section")];

// Identify main chapter boundaries by section h2 title
const mainChapterStarts = [
  "Week 1. Introduction and Setup",
  "1. Programming",
  "2. Python",
  "3. Input and Type Conversion",
  "4. Putting It Together",
];

const chapters = [];
let currentChapter = null;

for (const section of sections) {
  const rawTitle = getH2Title(section);
  const cleanTitle = cleanHeadingTitle(rawTitle);
  const isMain = mainChapterStarts.includes(rawTitle);

  if (isMain || !currentChapter) {
    currentChapter = {
      title: cleanTitle,
      rawTitle,
      sections: [],
    };
    chapters.push(currentChapter);
  }
  currentChapter.sections.push(section);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const chaptersDir = path.join(outDir, "chapters");
if (!fs.existsSync(chaptersDir)) fs.mkdirSync(chaptersDir, { recursive: true });

const chapterLinks = [];

for (let i = 0; i < chapters.length; i++) {
  const chapter = chapters[i];
  const num = String(i + 1).padStart(2, "0");
  const slug = chapter.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const fileName = `${num}-${slug}.md`;

  let chapterMd = `# ${chapter.title}\n\n`;

  for (const [idx, section] of chapter.sections.entries()) {
    let sectionMd = turndownService.turndown(section);
    sectionMd = stripNumberedHeading(sectionMd);
    sectionMd = sectionMd
      .replace(/\n{3,}/g, "\n\n")
      .replace(/(```[\s\S]*?```)/g, (m) => m.replace(/\\([*])/g, "$1"))
      .trim();

    if (idx === 0) {
      // The first section heading is the chapter title; remove the duplicated h2
      sectionMd = sectionMd.replace(/^## .+\n+/, "");
    }

    chapterMd += sectionMd + "\n\n";
  }

  fs.writeFileSync(path.join(chaptersDir, fileName), chapterMd.trim() + "\n");
  chapterLinks.push(`- [${chapter.title}](chapters/${fileName})`);
}

const coursebookMd = `# COMP 1510 - Programming Method

## Chapters

${chapterLinks.join("\n")}
`;

fs.writeFileSync(path.join(outDir, "coursebook.md"), coursebookMd);

console.log("Created coursebook at", outDir);

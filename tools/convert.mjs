import fs from "fs";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const html = fs.readFileSync("/tmp/week1.html", "utf8");
const dom = new JSDOM(html);
const doc = dom.window.document;

const head = doc.querySelector("head");
if (head) head.remove();
doc.querySelectorAll("style").forEach((el) => el.remove());

const tocHeading = [...doc.querySelectorAll("h3")].find(
  (h) => h.textContent.trim() === "Table of Contents",
);
if (tocHeading && tocHeading.nextElementSibling?.tagName === "OL") {
  tocHeading.nextElementSibling.remove();
  tocHeading.remove();
}

for (const span of doc.querySelectorAll(".h2tocs")) span.remove();
for (const a of doc.querySelectorAll("a[name]")) a.remove();
for (const a of doc.querySelectorAll("a[id]")) if (!a.textContent.trim()) a.remove();
for (const el of doc.querySelectorAll(".mandatory, .idx, .note, .warning"))
  el.removeAttribute("class");
for (const a of doc.querySelectorAll("a")) {
  a.removeAttribute("target");
  a.removeAttribute("style");
}

for (const pre of doc.querySelectorAll("pre")) {
  const text = pre.textContent;
  const lines = text.split("\n").filter(Boolean);
  const first = lines[0]?.trim() || "";
  let lang = "";
  const isSingleSentence = /^[A-Z][^.]*\.$/.test(first) && lines.length === 1;
  const hasMathSymbols = /[×÷≤≥≠≈]/u.test(text);
  if (isSingleSentence || hasMathSymbols) {
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

let markdown = turndownService.turndown(doc.body);

markdown = markdown
  .replace(
    /^# COMP 1510 - Programming Method - Week 1[\s\S]*?# COMP 1510/m,
    "# COMP 1510",
  )
  .replace(/^(#+\s+\d+)\\\./gm, "$1.")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

markdown = markdown.replace(/(```[\s\S]*?```)/g, (match) =>
  match.replace(/\\([*])/g, "$1"),
);

fs.writeFileSync("/tmp/week1-clean.md", markdown);
console.log("Done");

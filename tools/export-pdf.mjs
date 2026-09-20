/**
 * Export a coursebook to one or more PDFs from the CLI.
 *
 * Reuses the HTML export flow from tools/export-html.mjs, then prints the
 * standalone document to PDF with headless Chromium. The whole book is the
 * default output; chapters can be split into one PDF each (--split
 * chapters), selected ad hoc (--chapters), or grouped into named outputs
 * with a presets JSON file. Custom groupings (e.g. teaching weeks) cannot
 * be detected from the coursebook itself — that mapping belongs in the
 * presets file.
 *
 * Usage:
 *   node tools/export-pdf.mjs <coursebook.md> [options]
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { PDFArray, PDFDocument, PDFName, StandardFonts, rgb } from "pdf-lib";
import { exportHtmlFromMarkdown } from "./export-html.mjs";

const PDF_SCALE = 0.8;
const PDF_MARGINS = {
  // The taller top margin reserves a band for the running header, so it
  // clears the content instead of crowding it.
  top: "0.9in",
  bottom: "0.75in",
  left: "0in",
  right: "0in",
};

// Running headers/footers are stamped into the top/bottom margin bands.
const PAGE_INSET = 54; // 0.75in horizontal inset for stamped text
const HEADER_FONT_SIZE = 9;
const HEADER_TEXT_COLOR = rgb(0.45, 0.45, 0.45);
const INTRO_TEXT_COLOR = rgb(0.15, 0.15, 0.15);
const INTRO_WEEK_SIZE = 20;
const INTRO_COURSE_SIZE = 14;
const INTRO_FIRST_BASELINE_PT = 36;
const INTRO_LINE_STEP_PT = 26;
const INTRO_AFTER_LAST_PT = 16;
const PDF_DEFAULT_ZOOM = 0.8;
// The reading measure (48rem) is centered on the page in print, so stamps
// align with the content column: 768 CSS px * 0.75pt/px * scale 0.8.
const CONTENT_MEASURE_PT = 460.8;

/**
 * Injected for outputs that carry an intro header: the centered title block
 * needs more room than the running-header band, so the first page gets a
 * top margin sized to the stacked intro lines. Other pages keep the
 * print-option margins.
 */
function introPageCss(lineCount) {
  const marginPt =
    INTRO_FIRST_BASELINE_PT + lineCount * INTRO_LINE_STEP_PT + INTRO_AFTER_LAST_PT;
  return `
    @page { margin: 0.9in 0 0.75in 0; }
    @page :first { margin-top: ${(marginPt / 72).toFixed(3)}in; }
  `;
}

/**
 * Print-time CSS injected after the document's own print stylesheet. It
 * only tweaks rendering details (color fidelity, code-block line layout)
 * and adds an opt-in scoping mechanism: adding `pdf-scoped` to <body>
 * hides every section except the marked `pdf-include` ones, so a run can
 * print a subset of chapters without touching the exporter. The document's
 * own `@media print` rules handle everything else (hiding chrome,
 * linearizing sections, avoiding bad page breaks).
 */
const PRINT_CSS = `
  html,
  body,
  #content {
    text-rendering: geometricPrecision !important;
    -webkit-font-smoothing: auto !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  #content pre.shiki code {
    display: block !important;
    white-space: normal !important;
  }

  #content pre.shiki .line {
    display: block !important;
    min-height: 1em;
    white-space: pre !important;
  }

  /* Textbook-style chapter opener: the number is split out of the heading
     into a small uppercase kicker above the title (see reshapeChapterHeadings).
     Keep margin-inline auto: the reading-measure rule centers this element
     like every other content child. */
  #content .chapter-kicker {
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent, var(--text-muted, #555));
    margin: 0 auto 0.6em;
    break-after: avoid;
  }

  /* Every section starts its own page in print, so its separator border
     would show up as a stray line at the very top of each opener page;
     the running header replaces it. The separator's margin/padding would
     also push the heading well below the header band, so drop those too. */
  body.is-export #content .coursebook-section {
    border-top: 0 !important;
    margin-top: 0 !important;
    padding-top: 0 !important;
  }

  body.pdf-scoped #content .coursebook-section {
    display: none !important;
  }

  body.pdf-scoped #content .coursebook-section.pdf-include {
    display: block !important;
    break-before: page !important;
  }

  body.pdf-scoped #content .coursebook-section.pdf-first {
    break-before: auto !important;
  }

  /* A scoped section is the document's last printed box, and its bottom
     margin can spill onto a trailing blank page; the combined document
     absorbs that margin in the next section's page break. */
  body.pdf-scoped #content .coursebook-section.pdf-last {
    margin-bottom: 0 !important;
    padding-bottom: 0 !important;
    border-bottom: 0 !important;
  }
`;

function usage() {
  console.error(
    [
      "Usage: node tools/export-pdf.mjs <coursebook.md> [options]",
      "",
      "Options:",
      "  -o, --out <file.pdf>    Output path for single-output runs",
      "  --out-dir <dir>         Directory for generated PDFs (default: output/pdf)",
      "  --split chapters        Write one PDF per chapter as <NN>-<chapter-slug>.pdf",
      '  --chapters <spec>       Chapters to include, e.g. "1-3,7" (chapter numbers or section slugs)',
      '  --presets <file.json>   Named outputs: {"term": "Fall 2026", "outputs": [{"name": "...", "chapters": "1-8", "label": "Week 1"}, ...]}',
      '                          (a preset without "chapters" is the whole book; "label" adds it to the first-page intro)',
      '  --label <text>          Intro header label on page 1 of single-output runs (e.g. "Week 3")',
      '  --term <text>           Term shown in the intro header (e.g. "Fall 2026")',
      '  --institution <text>    Institution line above the intro title (e.g. "BCIT"); also settable as "institution" in a presets file',
      "  --format letter|a4      Paper size (default: letter)",
      "  --no-header             Skip the running header/footer stamping",
      "  --keep-html             Also keep the intermediate exported HTML in the output directory",
      "  -h, --help              Show this help",
      "",
      "Examples:",
      "  node tools/export-pdf.mjs coursebook.md",
      "  node tools/export-pdf.mjs coursebook.md --split chapters",
      "  node tools/export-pdf.mjs coursebook.md --chapters 1-8 -o week1.pdf",
      "  node tools/export-pdf.mjs coursebook.md --presets weeks.json",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    input: null,
    out: null,
    outDir: null,
    split: false,
    chapters: null,
    presets: null,
    format: "letter",
    headers: true,
    label: null,
    term: null,
    institution: null,
    keepHtml: false,
  };

  let i = 0;
  const readValue = () => {
    const value = argv[++i];
    if (!value) {
      usage();
      process.exit(1);
    }
    return value;
  };

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "-o" || arg === "--out") {
      options.out = readValue(arg);
    } else if (arg === "--out-dir") {
      options.outDir = readValue(arg);
    } else if (arg === "--split") {
      const value = readValue(arg);
      if (value !== "chapters") {
        console.error(`Unknown --split mode: ${value}`);
        process.exit(1);
      }
      options.split = true;
    } else if (arg === "--chapters") {
      options.chapters = readValue(arg);
    } else if (arg === "--presets") {
      options.presets = readValue(arg);
    } else if (arg === "--format") {
      const value = readValue(arg).toLowerCase();
      if (value !== "letter" && value !== "a4") {
        console.error(`Unknown --format: ${value}`);
        process.exit(1);
      }
      options.format = value;
    } else if (arg === "--no-header") {
      options.headers = false;
    } else if (arg === "--label") {
      options.label = readValue(arg);
    } else if (arg === "--term") {
      options.term = readValue(arg);
    } else if (arg === "--institution") {
      options.institution = readValue(arg);
    } else if (arg === "--keep-html") {
      options.keepHtml = true;
    } else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      usage();
      process.exit(1);
    } else if (options.input === null) {
      options.input = arg;
    } else {
      usage();
      process.exit(1);
    }
    i++;
  }

  return options;
}

function parseChapterSpec(spec) {
  const items = [];
  for (const part of spec.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to < from) {
        throw new Error(`Invalid chapter range "${token}" in "${spec}"`);
      }
      items.push({ kind: "range", from, to });
    } else if (/^\d+$/.test(token)) {
      items.push({ kind: "number", value: Number(token) });
    } else {
      items.push({ kind: "slug", value: token });
    }
  }
  if (items.length === 0) {
    throw new Error(`No chapters found in "${spec}"`);
  }
  return items;
}

function describeSections(structure) {
  return structure
    .map((section) => `  ${section.number ? `${section.number}. ` : "   "}${section.id}`)
    .join("\n");
}

function resolveWanted(structure, items) {
  const chapters = structure.filter((section) => section.isChapter);
  const available = describeSections(structure);
  const wanted = new Set();

  const addChapter = (number) => {
    const section = chapters[number - 1];
    if (!section) {
      throw new Error(
        `Chapter ${number} is out of range (this coursebook has ${chapters.length} chapter(s)). ` +
          `Available sections:\n${available}`,
      );
    }
    wanted.add(section.id);
  };

  for (const item of items) {
    if (item.kind === "slug") {
      if (!structure.some((section) => section.id === item.value)) {
        throw new Error(
          `Unknown section "${item.value}". Available sections:\n${available}`,
        );
      }
      wanted.add(item.value);
    } else if (item.kind === "number") {
      addChapter(item.value);
    } else {
      for (let n = item.from; n <= item.to; n++) {
        addChapter(n);
      }
    }
  }

  return [...wanted];
}

async function loadPresets(presetsPath) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(presetsPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read presets file ${presetsPath}: ${error.message}`);
  }

  const entries = Array.isArray(parsed) ? parsed : parsed?.outputs;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(
      `Presets file ${presetsPath} must be a non-empty array or { "outputs": [...] }`,
    );
  }

  return {
    term:
      typeof parsed?.term === "string" && parsed.term.trim() ? parsed.term.trim() : null,
    institution:
      typeof parsed?.institution === "string" && parsed.institution.trim()
        ? parsed.institution.trim()
        : null,
    entries: entries.map((entry, index) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.name !== "string" ||
        !entry.name.trim()
      ) {
        throw new Error(
          `Preset #${index + 1} in ${presetsPath} needs a non-empty "name"`,
        );
      }
      if (
        entry.chapters !== undefined &&
        (typeof entry.chapters !== "string" || !entry.chapters.trim())
      ) {
        throw new Error(
          `Preset "${entry.name}" has an empty "chapters"; omit the field for the whole book`,
        );
      }
      if (
        entry.label !== undefined &&
        (typeof entry.label !== "string" || !entry.label.trim())
      ) {
        throw new Error(
          `Preset "${entry.name}" has an empty "label"; omit it to skip the intro`,
        );
      }
      return {
        name: entry.name,
        chapters: entry.chapters ?? null,
        label: entry.label?.trim() ?? null,
      };
    }),
  };
}

function safeName(name) {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim()
    .replace(/\.pdf$/i, "");
  if (!cleaned) {
    throw new Error(`Preset name "${name}" produces an empty file name`);
  }
  return cleaned;
}

function buildOutputs(options, presets, structure, outDir, meta) {
  const defaultStem = path.basename(options.input).replace(/\.md$/i, "");
  const term = options.term ?? meta?.term ?? null;
  const institution = options.institution ?? meta?.institution ?? null;

  if (presets) {
    return presets.map((preset) => ({
      name: preset.name,
      file: path.join(outDir, `${safeName(preset.name)}.pdf`),
      wanted: preset.chapters
        ? resolveWanted(structure, parseChapterSpec(preset.chapters))
        : null,
      intro: { label: preset.label, term, institution },
    }));
  }

  if (options.split) {
    const chapters = structure.filter((section) => section.isChapter);
    if (chapters.length === 0) {
      throw new Error("This coursebook has no chapters to split");
    }
    const width = Math.max(2, String(chapters.length).length);
    return chapters.map((section) => ({
      name: section.title,
      file: path.join(
        outDir,
        `${String(section.number).padStart(width, "0")}-${section.id}.pdf`,
      ),
      wanted: [section.id],
      intro: { label: null, term, institution },
    }));
  }

  return [
    {
      name: options.out ? path.basename(options.out) : defaultStem,
      file: options.out
        ? path.resolve(options.out)
        : path.join(outDir, `${defaultStem}.pdf`),
      wanted: options.chapters
        ? resolveWanted(structure, parseChapterSpec(options.chapters))
        : null,
      intro: { label: options.label, term, institution },
    },
  ];
}

/**
 * Textbook-style chapter openers: move the leading number out of each
 * chapter heading into an uppercase kicker element rendered above the
 * title ("CHAPTER 11" / "Working with Strings"). Runs once per loaded
 * page; the printed outline picks up the reshaped heading text, which
 * findSectionStartPages matches against section.title.
 */
function reshapeChapterHeadings(page) {
  return page.evaluate(() => {
    let reshaped = 0;
    for (const section of document.querySelectorAll("#content .coursebook-section")) {
      if (
        section.classList.contains("landing") ||
        section.classList.contains("index-section")
      ) {
        continue;
      }
      const heading = section.querySelector("h1");
      if (!heading) continue;
      const match = heading.textContent.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) continue;
      const kicker = document.createElement("div");
      kicker.className = "chapter-kicker";
      kicker.textContent = `Chapter ${match[1]}`;
      heading.parentNode.insertBefore(kicker, heading);
      heading.replaceChildren(document.createTextNode(match[2]));
      reshaped++;
    }
    return reshaped;
  });
}

function readStructure(page) {
  return page.evaluate(() => {
    let chapterNumber = 0;
    return [...document.querySelectorAll("#content .coursebook-section")].map(
      (element) => {
        const landing = element.classList.contains("landing");
        const isChapter = !landing && !element.classList.contains("index-section");
        const number = isChapter ? ++chapterNumber : null;
        const title = (
          element.querySelector("h1, h2, h3")?.textContent ?? element.id
        ).trim();
        return {
          id: element.id,
          isChapter,
          landing,
          number,
          // Printed heading text (number lives in the kicker) and the full
          // label used for running headers.
          title,
          label: number ? `${number} ${title}` : title,
        };
      },
    );
  });
}

async function applyScopeAndSettle(page, wantedIds) {
  return page.evaluate(async (wantedList) => {
    const wanted = wantedList ? new Set(wantedList) : null;
    // Always scope: every output prints through this path, which keeps the
    // trailing-blank fix (pdf-last) active for whole-book runs too and makes
    // the measured per-section layout identical to the final print.
    document.body.classList.add("pdf-scoped");

    let first = true;
    let last = null;
    for (const section of document.querySelectorAll("#content .coursebook-section")) {
      const include = !wanted || wanted.has(section.id);
      section.classList.toggle("pdf-include", include);
      section.classList.remove("pdf-first");
      section.classList.remove("pdf-last");
      if (include) {
        if (first) {
          section.classList.add("pdf-first");
          first = false;
        }
        last = section;
      }
    }
    last?.classList.add("pdf-last");

    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
            }),
      ),
    );

    return wanted
      ? wanted.size
      : document.querySelectorAll("#content .coursebook-section").length;
  }, wantedIds);
}

function pdfOptions(format) {
  return {
    format: format === "a4" ? "A4" : "Letter",
    scale: PDF_SCALE,
    margin: PDF_MARGINS,
    printBackground: true,
    preferCSSPageSize: false,
    displayHeaderFooter: false,
    tagged: true,
    outline: true,
  };
}

async function printToPdf(page, outputPath, format) {
  await page.pdf({ path: outputPath, ...pdfOptions(format) });
}

function readCourseTitle(page) {
  return page.evaluate(() => {
    const landing = document.querySelector("#content .coursebook-section.landing h1");
    return (landing?.textContent ?? document.title).trim();
  });
}

// Section headings carry their number in the text ("11 Working with
// Strings"); the landing page would just duplicate the course title.
function headerLabel(section) {
  return section.landing ? "" : section.label;
}

// pdf-lib's standard fonts are WinAnsi-encoded; keep the stamp text ASCII-safe.
function sanitizePdfText(text) {
  return (
    text
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2026/g, "...")
      .replace(/\u00a0/g, " ")
      // Keep the middle dot: WinAnsi can encode it and it joins label and term.
      .replace(/[^\x20-\x7E\u00B7]/g, "")
      .trim()
  );
}

function decodeOutlineTitle(value) {
  try {
    if (typeof value.decodeText === "function") return value.decodeText();
    if (typeof value.asString === "function") return value.asString();
  } catch {
    // Unreadable title: treat as missing.
  }
  return null;
}

function outlineItemPageIndex(doc, item, pageIndexByRef) {
  let dest = item.get(PDFName.of("Dest"));
  if (!dest) {
    const action = doc.context.lookup(item.get(PDFName.of("A")));
    dest = action ? action.get(PDFName.of("D")) : null;
  }
  if (dest instanceof PDFName) {
    const dests = doc.context.lookup(doc.catalog.get(PDFName.of("Dests")));
    if (!dests) return null;
    dest = dests.entries().find(([key]) => String(key) === String(dest))?.[1] ?? null;
  }
  if (!(dest instanceof PDFArray)) return null;
  const pageRef = dest.get(0);
  return pageIndexByRef.get(String(pageRef)) ?? null;
}

/**
 * Flatten the document outline into [{ title, pageIndex }] in document
 * order. Chromium writes one entry per heading, each anchored to its page.
 */
function readOutlineEntries(doc, pageIndexByRef) {
  try {
    const outlines = doc.context.lookup(doc.catalog.get(PDFName.of("Outlines")));
    if (!outlines) return null;
    const entries = [];
    const walk = (dict) => {
      if (!dict) return;
      let item = doc.context.lookup(dict.get(PDFName.of("First")));
      while (item) {
        const title = decodeOutlineTitle(item.get(PDFName.of("Title")));
        const pageIndex = outlineItemPageIndex(doc, item, pageIndexByRef);
        if (title && pageIndex !== null) entries.push({ title, pageIndex });
        walk(item);
        const next = item.get(PDFName.of("Next"));
        item = next ? doc.context.lookup(next) : null;
      }
    };
    walk(outlines);
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

/**
 * Locate each section's first page by matching its heading text against the
 * printed document's outline. Returns an index per section, or null when the
 * outline is missing or any section cannot be placed in order.
 */
function findSectionStartPages(doc, titles) {
  const pageIndexByRef = new Map(
    doc.getPages().map((page, index) => [String(page.ref), index]),
  );
  const entries = readOutlineEntries(doc, pageIndexByRef);
  if (!entries) return null;

  const starts = [];
  let cursor = 0;
  for (const title of titles) {
    const target = title.trim();
    let found = -1;
    for (let i = cursor; i < entries.length; i++) {
      if (entries[i].title.trim() === target) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;
    const pageIndex = entries[found].pageIndex;
    if (starts.length > 0 && pageIndex <= starts[starts.length - 1]) return null;
    starts.push(pageIndex);
    cursor = found + 1;
  }
  if (starts[0] !== 0) return null;
  return starts;
}

/**
 * Stamp a running header and footer onto every page: the course title on
 * every page, the current section on the right of continuation pages, and
 * centered page numbers in the footer. With `intro` (label/term from the
 * CLI or presets file), page 1 instead gets a document header — course
 * title left, label and term right, thin rule underneath — like a course
 * handout's first page.
 *
 * Chromium's own header/footer templates cannot vary per page, so section
 * ranges are read from the printed PDF's outline instead. A load/modify/save
 * keeps the bookmarks, link targets, and accessibility tag tree Chromium
 * produced.
 */
async function stampHeaderFooter(pdfPath, { courseTitle, sections, intro }) {
  const bytes = await fs.readFile(pdfPath);
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = intro ? await doc.embedFont(StandardFonts.HelveticaBold) : null;
  const pages = doc.getPages();
  const total = pages.length;

  const starts = findSectionStartPages(
    doc,
    sections.map((section) => section.title),
  );
  if (!starts) {
    console.warn(
      `Skipping header/footer for ${pdfPath}: could not locate every section heading in the PDF outline.`,
    );
    return false;
  }

  const ranges = sections.map((section, index) => ({
    label: section.label,
    firstPage: starts[index],
  }));

  const course = sanitizePdfText(courseTitle);
  const courseWidth = font.widthOfTextAtSize(course, HEADER_FONT_SIZE);
  // Cover-style intro lines, all centered on the first page: the week label
  // headlines the handout, the course title sits beneath it, and the
  // institution and term close as a small meta line.
  const introLines = intro
    ? [
        intro.label && {
          text: sanitizePdfText(intro.label),
          size: INTRO_WEEK_SIZE,
          bold: true,
          muted: false,
        },
        { text: course, size: INTRO_COURSE_SIZE, bold: true, muted: false },
        intro.institution || intro.term
          ? {
              text: sanitizePdfText(
                [intro.institution, intro.term].filter(Boolean).join(" · "),
              ),
              size: HEADER_FONT_SIZE,
              bold: false,
              muted: true,
            }
          : null,
      ].filter(Boolean)
    : [];

  pages.forEach((page, index) => {
    const { width, height } = page.getSize();
    const range = ranges.findLast((entry) => entry.firstPage <= index);
    // Align stamps with the centered content column.
    const inset = Math.max(PAGE_INSET, (width - CONTENT_MEASURE_PT) / 2);

    const pageLabel = `Page ${index + 1} of ${total}`;
    page.drawText(pageLabel, {
      x: (width - font.widthOfTextAtSize(pageLabel, HEADER_FONT_SIZE)) / 2,
      y: 36,
      size: HEADER_FONT_SIZE,
      font,
      color: HEADER_TEXT_COLOR,
    });

    if (index === 0 && intro) {
      introLines.forEach((line, lineIndex) => {
        const text = line.muted ? line.text.toUpperCase() : line.text;
        const textWidth = (line.bold ? boldFont : font).widthOfTextAtSize(
          text,
          line.size,
        );
        page.drawText(text, {
          x: (width - textWidth) / 2,
          y: height - (INTRO_FIRST_BASELINE_PT + lineIndex * INTRO_LINE_STEP_PT),
          size: line.size,
          font: line.bold ? boldFont : font,
          color: line.muted ? HEADER_TEXT_COLOR : INTRO_TEXT_COLOR,
        });
      });
      return;
    }

    // Every page carries the course name; openers stop there — the section's
    // own heading sits directly below.
    page.drawText(course, {
      x: inset,
      y: height - 40,
      size: HEADER_FONT_SIZE,
      font,
      color: HEADER_TEXT_COLOR,
    });

    if (index === range.firstPage) return;

    let label = sanitizePdfText(range.label);
    const maxLabelWidth = width - 2 * inset - courseWidth - 24;
    while (label && font.widthOfTextAtSize(label, HEADER_FONT_SIZE) > maxLabelWidth) {
      label = label.slice(0, -1);
    }
    if (label !== range.label) {
      label = label.replace(/[\s-]+$/, "") + "...";
    }

    if (label) {
      page.drawText(label, {
        x: width - inset - font.widthOfTextAtSize(label, HEADER_FONT_SIZE),
        y: height - 40,
        size: HEADER_FONT_SIZE,
        font,
        color: HEADER_TEXT_COLOR,
      });
    }
  });

  // Open at 80% zoom by default (honored by viewers that apply the
  // document's OpenAction, e.g. Acrobat and Firefox).
  doc.catalog.set(
    PDFName.of("OpenAction"),
    doc.context.obj([pages[0].ref, "XYZ", null, null, PDF_DEFAULT_ZOOM]),
  );

  await fs.writeFile(pdfPath, await doc.save());
  return true;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.input) {
    usage();
    process.exit(1);
  }
  if (options.presets && (options.split || options.chapters || options.out)) {
    throw new Error("--presets cannot be combined with --split, --chapters, or --out");
  }
  if (options.split && (options.chapters || options.out)) {
    throw new Error("--split cannot be combined with --chapters or --out");
  }
  if (options.label && (options.presets || options.split)) {
    throw new Error(
      '--label cannot be combined with --presets or --split (set "label" on preset entries instead)',
    );
  }

  const outDir = path.resolve(options.outDir ?? "output/pdf");
  await fs.mkdir(outDir, { recursive: true });

  const loaded = options.presets
    ? await loadPresets(path.resolve(options.presets))
    : null;
  const presets = loaded ? loaded.entries : null;
  const institution = options.institution ?? loaded?.institution ?? null;

  console.log("Exporting coursebook to HTML...");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coursebook-pdf-"));
  const htmlPath = path.join(tempDir, "coursebook.html");
  try {
    await exportHtmlFromMarkdown(options.input, htmlPath);

    console.log("Launching headless Chromium for PDF printing...");
    const browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      colorScheme: "light",
    });
    try {
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      await page.emulateMedia({ media: "print" });
      await page.addStyleTag({ content: PRINT_CSS });
      // The exported viewer boots dark when the OS prefers dark; the PDF
      // must always be light regardless of the machine running the tool.
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "light";
      });
      // The export's print CSS prints tokens with `var(--shiki-light, ...)`,
      // but Shiki's dual-theme output only bakes the light color inline plus
      // `--shiki-dark*` overrides. Copy the inline light colors into the
      // variables the print rules look up, or code prints monochrome.
      await page.evaluate(() => {
        for (const token of document.querySelectorAll("#content pre.shiki span[style]")) {
          if (token.style.color) {
            token.style.setProperty("--shiki-light", token.style.color);
          }
        }
        for (const block of document.querySelectorAll("#content pre.shiki[style]")) {
          if (block.style.backgroundColor) {
            block.style.setProperty("--shiki-light-bg", block.style.backgroundColor);
          }
        }
      });

      await reshapeChapterHeadings(page);

      const structure = await readStructure(page);
      if (structure.length === 0) {
        throw new Error("The exported document contains no coursebook sections");
      }

      const courseTitle = await readCourseTitle(page);
      const outputs = buildOutputs(options, presets, structure, outDir, {
        term: loaded?.term ?? null,
        institution,
      });
      for (const output of outputs) {
        const included = output.wanted
          ? structure.filter((section) => output.wanted.includes(section.id))
          : structure;
        await applyScopeAndSettle(page, output.wanted);
        // The intro header needs a taller first-page margin, which only the
        // printed document sees: inject the @page rules for this output and
        // remove them before the next one. The margin scales with the number
        // of stacked intro lines.
        const introLineCount =
          1 +
          [output.intro?.institution, output.intro?.label, output.intro?.term].filter(
            Boolean,
          ).length;
        const hasIntro = introLineCount > 1;
        const introStyle = hasIntro
          ? await page.addStyleTag({ content: introPageCss(introLineCount) })
          : null;
        await printToPdf(page, output.file, options.format);
        if (introStyle) {
          await page.evaluate((element) => element.remove(), introStyle);
        }
        if (options.headers) {
          await stampHeaderFooter(output.file, {
            courseTitle,
            intro: output.intro,
            sections: included.map((section) => ({
              title: section.title,
              label: headerLabel(section),
            })),
          });
        }
        console.log(`Created ${output.file} from ${included.length} section(s).`);
      }

      if (options.keepHtml) {
        const stem = path.basename(options.input).replace(/\.md$/i, "");
        const keepPath = path.join(outDir, `${stem}.html`);
        await fs.copyFile(htmlPath, keepPath);
        console.log(`Kept intermediate HTML: ${keepPath}`);
      }
    } finally {
      await browser.close();
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

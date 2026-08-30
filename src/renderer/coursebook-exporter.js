/**
 * CoursebookExporter
 *
 * Exports a complete coursebook (or single markdown file) as a single,
 * standalone HTML file. The output uses the same DOM classes, CSS, and
 * runtime logic as the live app: it boots the read-only export runtime and
 * renders the pre-rendered sections in the app shell.
 */
import { renderMarkdown, sanitizeHtml } from "./markdown-renderer.js";
import { ContentEnhancer } from "./content-enhancer.js";
import { loadChapter, getChapterTitle } from "../core/coursebook-loader.js";
import {
  computeSectionNumbersForSections,
  applyHeadingNumber,
} from "../core/section-numbering.js";
import { slugifyForId, resolveContentRefs } from "../core/utils.js";
import { ThemeManager } from "../core/theme-manager.js";
import { addReadingAids } from "../core/reading-aids.js";
import { buildIndexSection, collectIndexedTerms } from "../core/indexed-terms.js";
import runtimeSource from "../../dist/export-runtime.iife.js?raw";

/**
 * @typedef {import("../core/coursebook-loader.js").Coursebook} Coursebook
 */

/**
 * Export a coursebook to a standalone HTML string.
 *
 * @param {Coursebook} coursebook - The parsed coursebook.
 * @param {(src: string) => Promise<string>} [resolveAsset] - Optional resolver
 *   that loads a local asset and returns a data URI. Falls back to fetch if not provided.
 * @returns {Promise<string>} A complete HTML document string.
 */
export async function exportCoursebookHtml(coursebook, resolveAsset) {
  // Ensure dynamic CSS (KaTeX, Mermaid) is loaded so it appears in
  // document.styleSheets when we extract CSS below.
  await ContentEnhancer.ensureStylesLoaded();

  // Render the landing page and all chapters into containers first
  const landing = await renderSection(
    coursebook.markdown,
    coursebook.parentPath,
    resolveAsset,
  );
  const renderedChapters = [];
  for (const chapter of coursebook.chapters) {
    const markdown =
      chapter.markdown !== undefined
        ? chapter.markdown
        : await loadChapter(chapter.resolvedPath ?? chapter.path);
    renderedChapters.push({
      chapter,
      markdown,
      rendered: await renderSection(markdown, chapter.resolvedPath, resolveAsset),
    });
  }

  // Collect all headings across all sections and apply continuous
  // section numbering so each chapter continues from the previous one.
  const allRendered = [landing, ...renderedChapters.map((r) => r.rendered)];
  applyContinuousSectionNumbers(allRendered, { skipFirst: true });

  // Rewrite .md links to #chapter-slug hash links so they navigate within
  // the exported page instead of pointing to files that don't exist
  // in the standalone HTML.
  rewriteExportedChapterLinks(landing.container, coursebook);
  for (const { rendered } of renderedChapters) {
    rewriteExportedChapterLinks(rendered.container, coursebook);
  }

  // Deduplicate heading IDs globally across all sections, and reserve
  // section IDs so a heading with the same text as a chapter title
  // doesn't collide with the section's own id.
  deduplicateIds(allRendered, [
    "overview",
    ...renderedChapters.map((r) => slugifyForId(r.chapter.title)),
  ]);

  // In-content reading aids. Heading ids and .heading-number spans are final
  // at this point; the serialized section HTML carries the aids into the
  // exported page, whose runtime only adds the click handling.
  for (const { container } of allRendered) {
    addReadingAids(container);
  }

  // D2 embeds a full stylesheet copy inside every rendered SVG; consolidate
  // them into one hoisted block before the section HTML is serialized.
  const d2Css = consolidateD2Styles(allRendered);

  // General index of ==term== occurrences. Runs last so term anchor ids are
  // minted against the final heading/section ids and the index section is
  // never part of chapter numbering or the runtime's section arithmetic.
  const indexTakenIds = new Set();
  for (const { container } of allRendered) {
    for (const el of container.querySelectorAll("[id]")) {
      indexTakenIds.add(el.id);
    }
  }
  const indexEntries = collectIndexedTerms(
    allRendered.map((rendered, i) => ({
      root: rendered.container,
      label: i === 0 ? "overview" : slugifyForId(renderedChapters[i - 1].chapter.title),
    })),
    indexTakenIds,
  );

  // Build section metadata. Section IDs use chapter slugs (same as the app)
  // so hash navigation format is unified: #chapter-slug/heading-slug
  const sections = [
    {
      id: "overview",
      title: "Course Overview",
      html: landing.container.innerHTML,
    },
  ];

  for (let i = 0; i < renderedChapters.length; i++) {
    const { chapter, rendered } = renderedChapters[i];
    const title = getChapterTitle(renderedChapters[i].markdown, chapter.title);
    sections.push({
      id: slugifyForId(chapter.title),
      title,
      html: rendered.container.innerHTML,
    });
  }

  if (indexEntries.length > 0) {
    const indexSection = buildIndexSection(indexEntries);
    sections.push({
      id: "index",
      title: "Index",
      className: "index-section",
      html: indexSection.innerHTML,
    });
  }

  return buildHtmlDocument(coursebook.title, sections, coursebook.nav, d2Css);
}

/**
 * Export a single markdown document (standalone mode) to HTML.
 *
 * @param {string} title - The page title.
 * @param {string} markdown - The markdown content.
 * @param {(src: string) => Promise<string>} [resolveAsset] - Optional asset resolver.
 * @returns {Promise<string>}
 */
export async function exportSingleHtml(title, markdown, resolveAsset) {
  await ContentEnhancer.ensureStylesLoaded();
  const rendered = await renderSection(markdown, undefined, resolveAsset);
  applyContinuousSectionNumbers([rendered]);
  const d2Css = consolidateD2Styles([rendered]);
  return buildHtmlDocument(
    title,
    [
      {
        id: "overview",
        title,
        html: rendered.container.innerHTML,
      },
    ],
    null,
    d2Css,
  );
}

/**
 * Render markdown to a container, add heading ids, and run content enhancement
 * (Shiki, KaTeX, copy buttons). Does not add section numbers — those are
 * computed globally across all sections and applied separately.
 *
 * @param {string} markdown
 * @param {string} [sourceResolvedPath] - The chapter path, used to resolve relative image srcs.
 * @returns {Promise<{container: HTMLElement, headings: Array<{id: string, level: number, title: string}>}>}
 */
async function renderSection(
  markdown,
  sourceResolvedPath = "",
  resolveAsset = undefined,
) {
  const container = document.createElement("div");
  container.innerHTML = sanitizeHtml(renderMarkdown(markdown));
  for (const img of container.querySelectorAll("img")) {
    img.dataset.originalSrc = img.getAttribute("src") || "";
  }
  if (sourceResolvedPath) {
    resolveContentRefs(container, sourceResolvedPath);
  }

  const rawHeadings = Array.from(container.querySelectorAll("h1, h2, h3"));
  for (const heading of rawHeadings) {
    if (!heading.id) {
      heading.id = slugifyForId(heading.textContent);
    }
  }

  await ContentEnhancer.enhance(container);

  await inlineImages(container, resolveAsset);

  const headings = rawHeadings.map((heading) => ({
    id: heading.id,
    level: parseInt(heading.tagName.slice(1), 10),
    title: heading.textContent.trim(),
  }));

  return { container, headings };
}

/**
 * Inline relative `<img src>` attributes as data URIs so images work in the
 * exported standalone HTML file without a server.
 * @param {HTMLElement} container
 * @param {(src: string) => Promise<string>} [resolveAsset]
 */
async function inlineImages(container, resolveAsset) {
  const load = resolveAsset ?? fetchAsDataUri;
  const imgs = Array.from(container.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const resolved = img.getAttribute("src") || "";
      const original = img.dataset.originalSrc || resolved;
      if (!resolved || resolved.startsWith("data:")) return;
      if (/^https?:/.test(resolved)) return; // leave absolute URLs as-is
      try {
        img.src = await load(resolved);
        img.removeAttribute("data-original-src");
        return;
      } catch {
        // try the original (pre-resolution) path if it differs
      }
      if (
        original !== resolved &&
        original &&
        !original.startsWith("data:") &&
        !/^https?:/.test(original)
      ) {
        try {
          img.src = await load(original);
          img.removeAttribute("data-original-src");
        } catch {
          // leave as-is on failure
        }
      }
    }),
  );
}

/**
 * Apply continuous section numbers across all rendered sections.
 * The first section (the parent coursebook landing page) is left unnumbered,
 * and numbering continues from chapter to chapter so the second chapter does
 * not reset to "1".
 *
 * @param {Array<{container: HTMLElement}>} rendered
 */
function applyContinuousSectionNumbers(rendered, { skipFirst = false } = {}) {
  const sections = rendered.map((r) =>
    Array.from(r.container.querySelectorAll("h1, h2, h3")),
  );
  const numbersBySection = computeSectionNumbersForSections(sections, { skipFirst });

  for (let s = 0; s < rendered.length; s++) {
    const { container } = rendered[s];
    const numbers = numbersBySection[s];
    const containerHeadings = Array.from(container.querySelectorAll("h1, h2, h3"));

    for (let i = 0; i < containerHeadings.length; i++) {
      applyHeadingNumber(containerHeadings[i], numbers[i]);
    }
  }
}

/**
 * Deduplicate heading IDs across all rendered sections and reserve section
 * IDs so no heading gets the same id as a `<section>` wrapper.
 *
 * @param {Array<{container: HTMLElement}>} rendered
 * @param {string[]} sectionIds - IDs reserved for `<section>` wrappers.
 */
function deduplicateIds(rendered, sectionIds) {
  const usedIds = new Set(sectionIds);

  for (const { container } of rendered) {
    const els = Array.from(container.querySelectorAll("h1, h2, h3"));
    for (const el of els) {
      if (!el.id || usedIds.has(el.id)) {
        const baseId = el.id || slugifyForId(el.textContent);
        let uniqueId = baseId;
        let suffix = 1;
        while (usedIds.has(uniqueId)) {
          uniqueId = `${baseId}-${suffix++}`;
        }
        el.id = uniqueId;
      }
      usedIds.add(el.id);
    }
  }
}

/**
 * Rewrite in-content .md chapter links to #chapter-slug hash links so
 * clicking a chapter in the parent page navigates within the exported
 * page instead of pointing to a .md file that doesn't exist standalone.
 * @param {HTMLElement} container
 * @param {Coursebook} coursebook
 */
function rewriteExportedChapterLinks(container, coursebook) {
  const pathToSlug = new Map();
  for (const chapter of coursebook.chapters) {
    const slug = slugifyForId(chapter.title);
    pathToSlug.set(chapter.path, slug);
    if (chapter.resolvedPath && chapter.resolvedPath !== chapter.path) {
      pathToSlug.set(chapter.resolvedPath, slug);
    }
  }

  for (const link of container.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href") || "";
    if (
      href.startsWith("#") ||
      href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("//") ||
      href.startsWith("mailto:")
    )
      continue;

    const slug = pathToSlug.get(href);
    if (slug) {
      link.setAttribute("href", `#${slug}`);
      link.removeAttribute("target");
      link.removeAttribute("rel");
    }
  }
}

/**
 * Build the complete HTML document with navigation and all sections.
 *
 * @param {string} title
 * @param {Array<{id: string, title: string, html: string}>} sections
 * @param {Array<{type: string, title?: string, index?: number}>} [nav]
 * @param {string} [d2Css] - Consolidated D2 diagram styles to inline in the head.
 * @returns {Promise<string>}
 */
async function buildHtmlDocument(title, sections, nav = null, d2Css = "") {
  const theme = ThemeManager.getCurrentTheme();
  const palette = ThemeManager.getPalette();

  const sectionHtml = sections
    .map(
      (s) =>
        `<section id="${s.id}" class="coursebook-section${s.className ? ` ${s.className}` : ""}">\n${s.html}\n</section>`,
    )
    .join("\n");

  const appCss = await extractCssFromDocument();
  const exportCss = getExportOverridesCss();
  const css = [appCss, exportCss, d2Css].filter(Boolean).join("\n");

  const config = {
    title,
    // The index section is deliberately excluded: the runtime derives
    // chapter math from sectionsData and reaches the index by id instead.
    sections: sections
      .filter((s) => s.id !== "index")
      .map((s) => ({ id: s.id, title: s.title })),
    nav: nav ?? [],
    theme,
    palette,
  };

  const runtimeBundle = runtimeSource.replace(/<\/script>/gi, "<\\/script>");
  const configJson = JSON.stringify(config).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}" data-palette="${palette}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${css}
</style>
<script id="coursebook-data" type="application/json">${configJson}</script>
</head>
<body class="is-export">
<div id="app" class="app">
  <main class="main">
    <section id="previewPane" class="preview-pane">
      <div id="content">
${sectionHtml}
      </div>
      <nav id="chapterNav" class="chapter-nav hidden" aria-label="Chapter navigation">
        <button
          id="prevChapterBtn"
          class="chapter-nav__btn chapter-nav__btn--prev"
          type="button"
        >
          <i data-icon="chevron-left" data-size="md" class="chapter-nav__icon--prev"></i>
          <span class="chapter-nav__label">Previous</span>
        </button>
        <button
          id="nextChapterBtn"
          class="chapter-nav__btn chapter-nav__btn--next"
          type="button"
        >
          <span class="chapter-nav__label">Next</span>
          <i data-icon="chevron-right" data-size="md" class="chapter-nav__icon--next"></i>
        </button>
      </nav>
    </section>

    <aside id="tocPane" class="toc-pane" aria-label="Chapters and table of contents">
      <div class="toc-pane__header">
        <span class="toc-pane__title" id="chapterPaneTitle">Chapters</span>
        <button
          id="tocToggleBtn"
          class="toc-pane__toggle icon-btn"
          type="button"
          aria-label="Collapse navigation"
          title="Collapse"
        >
          <i data-icon="chevron-down" data-size="md"></i>
        </button>
      </div>

      <div class="nav-section nav-section--chapters">
        <nav id="chapterList" class="chapter-list"></nav>
      </div>
    </aside>
  </main>

  <div class="theme-toggle-float">
    <button
      id="themeToggleBtn"
      class="theme-toggle"
      type="button"
      aria-label="Toggle dark mode"
      title="Toggle Dark Mode"
    >
      <span class="theme-toggle__track">
        <i data-icon="sun" data-size="md" class="theme-icon-light"></i>
        <i data-icon="moon" data-size="md" class="theme-icon-dark"></i>
        <span class="theme-toggle__thumb"></span>
      </span>
    </button>
  </div>
</div>
<script>${runtimeBundle}</script>
</body>
</html>`;
}

/**
 * Minimal export-specific CSS that extends the app's own styles.
 * A standalone export shows one chapter at a time; the sidebar and
 * bottom chapter nav are used to move between chapters.
 */
function getExportOverridesCss() {
  return `
    body.is-export .main {
      padding-top: 0;
    }

    body.is-export #content .coursebook-section {
      display: none;
    }

    body.is-export #content .coursebook-section.active {
      display: block;
    }

    .theme-toggle-float {
      position: fixed;
      bottom: 16px;
      left: 16px;
      z-index: 100;
    }
  `;
}

const D2_SVG_CLASS = "d2-svg";
// NUL cannot occur in d2's generated CSS, so it is a safe stand-in for the
// per-diagram salt while rules are compared across diagrams.
const D2_SALT_PLACEHOLDER = "\0";

/**
 * D2 embeds a full stylesheet inside every rendered SVG: theme color rules,
 * shape rules, and per-diagram @font-face rules whose font-family names embed
 * the diagram's salt class (e.g. "d2-608332575-font-bold") alongside base64
 * font data subsetted to that diagram's glyphs. A document with many diagrams
 * therefore duplicates the theme CSS per diagram.
 *
 * This pass merges the per-SVG styles into one hoisted block, rule by rule:
 * rules whose salt-normalized selector and body match across diagrams are
 * emitted once with the contributing diagrams' salt scopes grouped into one
 * selector list (".d2-1 .fill-N7, .d2-2 .fill-N7 { ... }"). The original
 * salts stay on the SVG roots, in ids, and in url(...) references, so nothing
 * about a diagram's own defs or cascade changes.
 *
 * Rules that cannot be shared are emitted verbatim per diagram: anything
 * whose body sets a salted font-family (d2 subsets fonts per diagram, so the
 * @font-face data is diagram-specific and family names must keep matching),
 * and anything referencing per-diagram ids via url(...).
 *
 * @param {Array<{container: HTMLElement}>} rendered
 * @returns {string} Consolidated CSS for the exported document's head.
 */
export function consolidateD2Styles(rendered) {
  const diagrams = [];
  for (const { container } of rendered) {
    for (const svg of container.querySelectorAll(".d2-diagram svg")) {
      const styleEls = Array.from(svg.querySelectorAll(":scope > style"));
      const salt = (svg.getAttribute("class") || "")
        .split(/\s+/)
        .find((cls) => cls && cls !== D2_SVG_CLASS);
      if (styleEls.length === 0 || !salt) continue;
      diagrams.push({ styleEls, salt, rules: parseD2StyleRules(styleEls, salt) });
    }
  }
  if (diagrams.length === 0) return "";

  const merged = new Map();
  const order = [];
  for (const diagram of diagrams) {
    for (const rule of diagram.rules) {
      if (!rule.key) {
        order.push(rule.verbatimCss);
        continue;
      }
      let entry = merged.get(rule.key);
      if (!entry) {
        entry = { selectors: rule.selectors, body: rule.body, salts: [] };
        merged.set(rule.key, entry);
        order.push(entry);
      }
      if (!entry.salts.includes(diagram.salt)) entry.salts.push(diagram.salt);
    }
  }

  // All rules are parsed at this point; the per-SVG copies are pure bloat.
  for (const { styleEls } of diagrams) {
    for (const styleEl of styleEls) styleEl.remove();
  }

  const cssParts = order.map((item) => {
    if (typeof item === "string") return item;
    const selectorText = item.salts
      .flatMap((salt) =>
        item.selectors.map((sel) =>
          sel.scoped ? `.${salt}${sel.remainder}` : sel.original,
        ),
      )
      .join(", ");
    return `${selectorText} { ${item.body} }`;
  });
  return compactD2Css(cssParts.join("\n"));
}

/**
 * CSSOM serialization is verbose compared to d2's own output (spaced braces,
 * "rgb(10, 15, 37)" instead of "#0A0F25"). Compact the consolidated block so
 * the merge is a real size win. Safe for base64 data URIs: they contain no
 * braces, semicolons, or colon-space sequences.
 * @param {string} css
 * @returns {string}
 */
function compactD2Css(css) {
  return css
    .replace(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/g, (m, r, g, b, a) => {
      const hex = (n) => Number(n).toString(16).padStart(2, "0");
      if (a !== undefined && a !== "1") {
        const alpha = Math.round(parseFloat(a) * 255)
          .toString(16)
          .padStart(2, "0");
        return `#${hex(r)}${hex(g)}${hex(b)}${alpha}`;
      }
      return `#${hex(r)}${hex(g)}${hex(b)}`;
    })
    .replace(/\s*\{\s*/g, "{")
    .replace(/\s*\}\s*/g, "}")
    .replace(/;\s*/g, ";")
    .replace(/,\s*/g, ",")
    .replace(/:\s/g, ":");
}

/**
 * Parse a diagram's <style> elements into rule records. Shareable rules get
 * a merge key derived from their salt-free selector shape and body; rules
 * that must stay per-diagram (salted font-family declarations, url(...)
 * id references, @font-face) get key === null and keep their original text.
 * CSS parsing goes through CSSStyleSheet so serialization and selector
 * normalization match the browser.
 *
 * @param {HTMLElement[]} styleEls
 * @param {string} salt
 * @returns {Array<{key: string|null, selectors?: Array, body?: string, verbatimCss: string}>}
 */
function parseD2StyleRules(styleEls, salt) {
  const rules = [];
  const sheet = new CSSStyleSheet();
  const scopePrefix = `.${salt}`;
  const fontFamilySalt = new RegExp(
    `font-family\\s*:[^;]*${salt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );
  for (const styleEl of styleEls) {
    sheet.replaceSync(styleEl.textContent || "");
    for (const cssRule of sheet.cssRules) {
      if (cssRule.type === CSSRule.COMMENT_RULE) continue;
      const verbatimCss = cssRule.cssText;

      if (cssRule.type !== CSSRule.STYLE_RULE) {
        // @font-face data is subsetted per diagram, and other at-rules
        // (keyframes, media, supports) carry no mergeable selector shape:
        // always keep them per-diagram instead of risking wrong merges.
        rules.push({ key: null, verbatimCss });
        continue;
      }

      const selectors = cssRule.selectorText.split(",").map((sel) => {
        const trimmed = sel.trim();
        if (trimmed.startsWith(scopePrefix)) {
          return {
            scoped: true,
            remainder: trimmed.slice(scopePrefix.length),
            original: trimmed,
          };
        }
        return { scoped: false, remainder: "", original: trimmed };
      });
      const cssText = cssRule.cssText;
      const declarations = cssText
        .slice(cssText.indexOf("{") + 1, cssText.lastIndexOf("}"))
        .trim();

      // Salted font-family names point at this diagram's own @font-face, so
      // such rules must never be merged under another diagram's scope.
      if (fontFamilySalt.test(declarations)) {
        rules.push({ key: null, verbatimCss });
        continue;
      }
      const body = replaceSaltOutsideIdRefs(declarations, salt, D2_SALT_PLACEHOLDER);
      // A surviving placeholder means the body still carries a salted value
      // this pass does not understand; never emit the placeholder itself.
      const mergeable = !body.includes(salt) && !body.includes(D2_SALT_PLACEHOLDER);
      rules.push({
        key: mergeable
          ? JSON.stringify([
              selectors.map(({ scoped, remainder }) => ({ scoped, remainder })),
              body,
            ])
          : null,
        selectors,
        body,
        verbatimCss,
      });
    }
  }
  return rules;
}

/**
 * Replace every occurrence of `salt` in `text` with `replacement`, leaving
 * url(...) spans untouched: their content is either an id reference (must
 * keep pointing at the diagram's own defs) or a base64 data URI (which cannot
 * contain the hyphenated salt). Quoted and unquoted forms are handled because
 * CSSOM serialization differs on this across browsers.
 * @param {string} text
 * @param {string} salt
 * @param {string} replacement
 * @returns {string}
 */
function replaceSaltOutsideIdRefs(text, salt, replacement) {
  let result = "";
  let pos = 0;
  for (;;) {
    const at = text.indexOf("url(", pos);
    if (at === -1) {
      result += text.slice(pos).replaceAll(salt, replacement);
      return result;
    }
    result += text.slice(pos, at).replaceAll(salt, replacement);
    const openQuote = text[at + 4];
    let close;
    if (openQuote === '"' || openQuote === "'") {
      const quoteEnd = text.indexOf(openQuote, at + 5);
      close = quoteEnd === -1 ? -1 : text.indexOf(")", quoteEnd + 1);
    } else {
      close = text.indexOf(")", at + 4);
    }
    if (close === -1) {
      result += text.slice(at);
      return result;
    }
    result += text.slice(at, close + 1);
    pos = close + 1;
  }
}

/**
 * Extract all CSS from the document's stylesheets, inlining any relative
 * URLs so the exported HTML is self-contained.
 *
 * In dev mode, only the app's source stylesheets are allowed so Vite's
 * framework helper styles don't leak in. In production, the built bundle
 * is used, so all bundled rules are included.
 */
async function extractCssFromDocument() {
  const allowed = [
    "base.css",
    "content.css",
    "layout.css",
    "controls.css",
    "present.css",
    "katex",
    "mermaid",
  ];

  function isAllowedSheet(sheet) {
    const owner = sheet.ownerNode;
    const devId = owner?.dataset?.viteDevId;
    if (devId) {
      return allowed.some((name) => devId.includes(name));
    }
    return true;
  }

  function getSheetBaseUrl(sheet) {
    if (sheet.href) {
      return sheet.href.substring(0, sheet.href.lastIndexOf("/") + 1);
    }
    return location.href.substring(0, location.href.lastIndexOf("/") + 1);
  }

  /**
   * Resolve and fetch a CSS `url()` as a base64 data URI.
   * @param {string} rawUrl
   * @param {string} baseUrl
   * @returns {Promise<string | null>}
   */
  async function inlineCssUrl(rawUrl, baseUrl) {
    if (
      rawUrl.startsWith("data:") ||
      rawUrl.startsWith("blob:") ||
      rawUrl.startsWith("#")
    ) {
      return null;
    }
    try {
      const absolute = new URL(rawUrl, baseUrl).href;
      const isSameOrigin = new URL(absolute).origin === location.origin;
      if (
        (absolute.startsWith("http:") || absolute.startsWith("https:")) &&
        !isSameOrigin
      ) {
        return null;
      }
      return await fetchAsDataUri(absolute);
    } catch {
      return null;
    }
  }

  async function collectRules(rules, parts, baseUrl) {
    for (const rule of rules) {
      if (rule.type === CSSRule.IMPORT_RULE && rule.href) {
        const absolute = new URL(rule.href, baseUrl).href;
        try {
          const res = await fetch(absolute);
          const text = await res.text();
          const importedBase = absolute.substring(0, absolute.lastIndexOf("/") + 1);
          parts.push(await inlineUrlsInCss(text, importedBase));
        } catch {
          // skip failed imports
        }
        continue;
      }

      if (rule.type === CSSRule.MEDIA_RULE || rule.type === CSSRule.SUPPORTS_RULE) {
        if (rule.cssRules && rule.cssRules.length > 0) {
          const inner = [];
          await collectRules(rule.cssRules, inner, baseUrl);
          if (inner.length > 0) {
            parts.push(`${rule.cssText.split("{")[0].trim()} {\n${inner.join("\n")}\n}`);
          }
        }
        continue;
      }

      let cssText = rule.cssText ?? "";
      if (rule.type === CSSRule.STYLE_RULE) {
        cssText = await inlineUrlsInStyleRule(cssText, baseUrl);
      } else if (cssText.includes("url(")) {
        cssText = await inlineUrlsInCss(cssText, baseUrl);
      }

      parts.push(cssText);
    }
  }

  /**
   * Inline any url(...) references in a single rule's CSS text.
   */
  async function inlineUrlsInStyleRule(cssText, baseUrl) {
    const urlRegex = /url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g;
    const matches = [];
    let match;
    while ((match = urlRegex.exec(cssText)) !== null) {
      matches.push(match);
    }
    if (matches.length === 0) return cssText;

    const replacements = await Promise.all(
      matches.map(async (m) => {
        const dataUri = await inlineCssUrl(m[1], baseUrl);
        return dataUri ? `url("${dataUri}")` : null;
      }),
    );

    let result = cssText;
    for (let i = matches.length - 1; i >= 0; i--) {
      const replacement = replacements[i];
      if (replacement) {
        const m = matches[i];
        result =
          result.slice(0, m.index) + replacement + result.slice(m.index + m[0].length);
      }
    }
    return result;
  }

  async function inlineUrlsInCss(cssText, baseUrl) {
    const urlRegex = /url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g;
    let result = cssText;
    let match;
    const matches = [];
    while ((match = urlRegex.exec(cssText)) !== null) {
      matches.push(match);
    }
    if (matches.length === 0) return cssText;

    const replacements = await Promise.all(
      matches.map(async (m) => {
        const dataUri = await inlineCssUrl(m[1], baseUrl);
        return dataUri ? `url("${dataUri}")` : null;
      }),
    );

    for (let i = matches.length - 1; i >= 0; i--) {
      const replacement = replacements[i];
      if (replacement) {
        const m = matches[i];
        result =
          result.slice(0, m.index) + replacement + result.slice(m.index + m[0].length);
      }
    }
    return result;
  }

  const isViteDev = Array.from(document.styleSheets).some(
    (s) => s.ownerNode?.dataset?.viteDevId,
  );

  const parts = [];
  for (const sheet of document.styleSheets) {
    try {
      if (!sheet.cssRules) continue;
      if (isViteDev && !isAllowedSheet(sheet)) continue;
      const baseUrl = getSheetBaseUrl(sheet);
      await collectRules(sheet.cssRules, parts, baseUrl);
    } catch (err) {
      console.warn("Cross-origin stylesheet skipped in export:", sheet.href, err);
    }
  }
  return parts.join("\n");
}

/**
 * Fetch a binary resource and return it as a base64 data URI.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchAsDataUri(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  }
  const type = res.headers.get("content-type") || "application/octet-stream";
  // Vite's SPA fallback returns index.html for any path that doesn't map to
  // a real file. Never inline that as a data URI for an image/font asset.
  if (type.toLowerCase().startsWith("text/html")) {
    throw new Error(`Refusing to inline HTML response for ${url}`);
  }
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${type};base64,${globalThis.btoa(binary)}`;
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

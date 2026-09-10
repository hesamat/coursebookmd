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
import {
  loadChapter,
  getChapterTitle,
  buildChapterSlugMap,
} from "../core/coursebook-loader.js";
import {
  computeSectionNumbersForSections,
  applyHeadingNumber,
} from "../core/section-numbering.js";
import { slugifyForId, resolveContentRefs } from "../core/utils.js";
import { ThemeManager } from "../core/theme-manager.js";
import { addReadingAids } from "../core/reading-aids.js";
import { buildIndexSection, collectIndexedTerms } from "../core/indexed-terms.js";
import runtimeSource from "../../dist/export-runtime.iife.js?raw";
import faviconPng from "../../public/favicon-128.png?inline";

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
export async function exportCoursebookHtml(coursebook, resolveAsset, previews = {}) {
  // Render the landing page and all chapters into containers first
  const landing = await renderSection(
    coursebook.markdown,
    coursebook.parentPath,
    resolveAsset,
    previews,
    { dualTheme: true },
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
      rendered: await renderSection(
        markdown,
        chapter.resolvedPath,
        resolveAsset,
        previews,
        { dualTheme: true },
      ),
    });
  }

  // Collect all headings across all sections and apply continuous
  // section numbering so each chapter continues from the previous one.
  const allRendered = [landing, ...renderedChapters.map((r) => r.rendered)];
  applyContinuousSectionNumbers(allRendered, { skipFirst: true });

  // KaTeX's stylesheet embeds its fonts as URLs that get inlined as data
  // URIs during CSS extraction, so only load it when the book actually
  // rendered math. enhance() lazy-loads KaTeX for the same reason.
  if (allRendered.some(({ container }) => container.querySelector(".katex"))) {
    await ContentEnhancer.ensureStylesLoaded();
  }

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
  // so hash navigation format is unified: #chapter-slug/heading-slug.
  // The overview doubles as the landing page (hero styling) and is the only
  // section serialized with `active` so a JS-blocked viewer still sees the
  // book open on page one.
  const sections = [
    {
      id: "overview",
      title: "Course Overview",
      className: "landing",
      active: true,
      html: serializeSection(landing.container),
    },
  ];

  for (let i = 0; i < renderedChapters.length; i++) {
    const { chapter, rendered } = renderedChapters[i];
    const title = getChapterTitle(renderedChapters[i].markdown, chapter.title);
    sections.push({
      id: slugifyForId(chapter.title),
      title,
      html: serializeSection(rendered.container),
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
export async function exportSingleHtml(title, markdown, resolveAsset, previews = {}) {
  const rendered = await renderSection(markdown, undefined, resolveAsset, previews, {
    dualTheme: true,
  });
  applyContinuousSectionNumbers([rendered]);
  if (rendered.container.querySelector(".katex")) {
    await ContentEnhancer.ensureStylesLoaded();
  }
  const d2Css = consolidateD2Styles([rendered]);
  return buildHtmlDocument(
    title,
    [
      {
        id: "overview",
        title,
        className: "landing",
        active: true,
        html: serializeSection(rendered.container),
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
 * @param {object} [opts]
 * @param {boolean} [opts.dualTheme] - Bake light and dark Shiki themes into
 *   code blocks so the exported theme toggle re-skins them.
 * @returns {Promise<{container: HTMLElement, headings: Array<{id: string, level: number, title: string}>}>}
 */
async function renderSection(
  markdown,
  sourceResolvedPath = "",
  resolveAsset = undefined,
  previews = {},
  { dualTheme = false } = {},
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

  await ContentEnhancer.enhance(container, { dualTheme });

  await inlineImages(container, resolveAsset);

  injectLinkPreviews(container, previews);

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
  const pathToSlug = buildChapterSlugMap(coursebook);

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
 * Inject pre-cooked data-preview attributes for external links.
 * @param {HTMLElement} container
 * @param {Record<string, object>} previews
 */
function injectLinkPreviews(container, previews) {
  if (!previews || Object.keys(previews).length === 0) return;
  for (const link of container.querySelectorAll(
    'a[href^="http"], a[href^="https"], a[href^="//"]',
  )) {
    const href = link.getAttribute("href");
    const data = previews[href];
    if (data) {
      link.setAttribute("data-preview", JSON.stringify(data));
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
/**
 * The app icon, URI-encoded so it can sit directly in an href attribute
 * without a separate file.
 */
const FAVICON_HREF = faviconPng;

/**
 * Derive a short description for the meta description tag from the first
 * paragraph of the first section.
 * @param {Array<{html: string}>} sections
 * @returns {string}
 */
function deriveDescription(sections) {
  const first = sections[0];
  if (!first) return "";
  const container = document.createElement("div");
  container.innerHTML = first.html;
  const text = (container.querySelector("p")?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/**
 * Serialize a rendered section container. `data-src-line` source-map
 * attributes are editor affordances (source-jump) and stay out of the
 * standalone file.
 * @param {HTMLElement} container
 * @returns {string}
 */
function serializeSection(container) {
  for (const el of container.querySelectorAll("[data-src-line]")) {
    el.removeAttribute("data-src-line");
  }
  return container.innerHTML;
}

async function buildHtmlDocument(title, sections, nav = null, d2Css = "") {
  const theme = ThemeManager.getCurrentTheme();
  const palette = ThemeManager.getPalette();

  const sectionHtml = sections
    .map((s) => {
      const classes = ["coursebook-section"];
      if (s.className) classes.push(s.className);
      if (s.active) classes.push("active");
      return `<section id="${s.id}" class="${classes.join(" ")}">\n${s.html}\n</section>`;
    })
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
  const description = escapeHtml(deriveDescription(sections));

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}" data-palette="${palette}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${description}">
<meta name="generator" content="CoursebookMD">
<link rel="icon" href="${FAVICON_HREF}">
<style>
${css}
</style>
<noscript>
<style>
  /* Without JS the standalone file reads as one sequential document. */
  body.is-export #content .coursebook-section {
    display: block;
  }
  html, body, body.is-export .app, body.is-export .main, body.is-export .preview-pane {
    height: auto;
    overflow: visible;
  }
  #sidebarToggleBtn, #searchBox, .action-cluster, #tocPane, #chapterNav,
  #content .code-copy-button, #content .go-up-link {
    display: none !important;
  }
</style>
</noscript>
<script id="coursebook-data" type="application/json">${configJson}</script>
</head>
<body class="is-export">
<a class="skip-link" href="#content">Skip to content</a>
<header class="export-header">
  <button
    id="sidebarToggleBtn"
    class="icon-btn"
    type="button"
    aria-label="Hide navigation sidebar"
    aria-expanded="true"
    title="Hide sidebar"
  >
    <i data-icon="menu" data-size="md"></i>
  </button>
  <span class="export-header__title">${escapeHtml(title)}</span>
  <div id="searchBox" class="export-search">
    <input
      id="searchInput"
      class="export-search__input"
      type="search"
      placeholder="Search…"
      aria-label="Search the book"
      autocomplete="off"
      spellcheck="false"
    />
    <div
      id="searchResults"
      class="export-search__results hidden"
      role="listbox"
      aria-label="Search results"
    ></div>
  </div>
</header>
<div id="app" class="app">
  <main class="main">
    <aside id="tocPane" class="toc-pane" aria-label="Chapters and table of contents">
      <div class="toc-pane__header">
        <span class="toc-pane__title" id="chapterPaneTitle">Contents</span>
      </div>

      <div id="chapterSection" class="nav-section nav-section--chapters">
        <nav id="chapterList" class="chapter-list"></nav>
      </div>
    </aside>

    <section id="previewPane" class="preview-pane">
      <div id="content" tabindex="-1">
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
  </main>
</div>

<div class="action-cluster">
  <button
    id="presentBtn"
    class="icon-btn action-cluster__btn"
    type="button"
    aria-label="Toggle presentation mode"
    title="Present (⌘⌃P / Ctrl+Alt+P)"
  >
    <i data-icon="presentation" data-size="md"></i>
  </button>
  <button
    id="themeToggleBtn"
    class="icon-btn action-cluster__btn"
    type="button"
    aria-label="Toggle dark mode"
    title="Toggle theme (⌘⌃I / Ctrl+Alt+I)"
  >
    <i data-icon="sun" data-size="md" class="theme-icon-light"></i>
    <i data-icon="moon" data-size="md" class="theme-icon-dark"></i>
  </button>
</div>

${cloneExportChrome()}
<script>${runtimeBundle}</script>
</body>
</html>`;
}

/**
 * Clone the live app's presentation chrome — the overlay and the mode-aware
 * keyboard shortcuts sheet — so the export's markup is always identical to
 * the app's. App-only rows (edit mode has no equivalent in the read-only
 * export) are marked `data-app-only` in index.html and stripped here. The
 * sheet is cloned closed regardless of the app state at export time.
 * @returns {string}
 */
function cloneExportChrome() {
  const parts = [];
  const overlay = document.getElementById("overlay");
  if (overlay) parts.push(overlay.outerHTML);
  const sheet = document.getElementById("shortcutsSheet");
  if (sheet) {
    const clone = sheet.cloneNode(true);
    clone.classList.add("hidden");
    for (const el of clone.querySelectorAll("[data-app-only]")) {
      el.remove();
    }
    parts.push(clone.outerHTML);
  }
  return parts.join("\n");
}

/**
 * Export-specific stylesheet layered over the app CSS. The standalone export
 * is a document site: header + left sidebar + reading column, with the app's
 * editor shell restyled rather than reused as-is.
 */
function getExportOverridesCss() {
  return `
    /* ===== Frame: header above the app shell ===== */
    body.is-export {
      display: flex;
      flex-direction: column;
    }

    body.is-export .app {
      flex: 1;
      min-height: 0;
      height: auto;
    }

    body.is-export .main {
      padding-top: 0;
    }

    .export-header {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 12px;
      height: var(--topbar-h);
      padding: 0 12px;
      background: var(--surface-bg);
      border-bottom: 1px solid var(--border-medium);
    }

    .export-header__title {
      font-weight: 600;
      font-size: 15px;
      color: var(--text-high);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ===== Header controls =====
       The TOC toggle lives beside the title and the search box docks to the
       right edge. The app's own closed-sidebar rules in layout.css detach
       #sidebarToggleBtn as a fixed peek-out handle at the left edge; in the
       export the toggle never leaves the header, so those are neutralized. */
    body.is-export.sidebar-closed #sidebarToggleBtn {
      position: static;
      z-index: auto;
      border: none;
      border-radius: var(--radius-sm);
      box-shadow: none;
    }

    body.is-export.sidebar-closed #sidebarToggleBtn svg {
      transform: none;
    }

    /* The app leaves an 18px peek tab for its detached chevron handle; the
       export's toggle lives in the header, so the panel slides fully out. */
    body.is-export.sidebar-closed .toc-pane {
      margin-left: -260px;
    }

    .export-search {
      position: relative;
      flex-shrink: 0;
      margin-left: auto;
    }

    .export-search__input {
      width: 240px;
      height: 30px;
      padding: 0 10px;
      font-size: 13px;
      font-family: inherit;
      color: var(--text-high);
      background: var(--input-bg);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-sm);
      outline: none;
    }

    .export-search__input:focus {
      border-color: var(--accent-border);
    }

    .export-search__input::placeholder {
      color: var(--text-medium);
    }

    .export-search__results {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      width: min(380px, 92vw);
      max-height: 55vh;
      overflow-y: auto;
      background: var(--surface-elevated);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-sm);
      box-shadow: var(--overlay-shadow);
      z-index: 250;
    }

    .export-search__item {
      display: block;
      width: 100%;
      padding: 8px 12px;
      text-align: left;
      background: none;
      border: none;
      cursor: pointer;
    }

    .export-search__item:hover,
    .export-search__item.is-active {
      background: var(--surface-hover);
    }

    .export-search__chapter {
      display: block;
      margin-bottom: 2px;
      font-size: 11px;
      color: var(--text-medium);
    }

    .export-search__snippet {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      color: var(--text-high);
    }

    .export-search__mark {
      background: var(--accent-bg);
      color: var(--accent-text);
      border-radius: 2px;
    }

    .export-search__empty {
      padding: 10px 12px;
      font-size: 13px;
      color: var(--text-medium);
    }

    .skip-link {
      position: fixed;
      top: -48px;
      left: 12px;
      z-index: 300;
      padding: 8px 14px;
      background: var(--accent);
      color: var(--accent-text);
      border-radius: 0 0 8px 8px;
      text-decoration: none;
      font-size: 13px;
      transition: top 0.15s ease;
    }

    .skip-link:focus {
      top: 0;
    }

    /* Sidebar placement, border side, and the peek-out chevron collapse
       are the app's own rules in layout.css — shared with the export. */

    /* Floating actions use the shared .action-cluster styles from
       controls.css — present, theme, and fullscreen for both hosts. */

    /* ===== Section visibility (JS drives .active; noscript reveals all) ===== */
    body.is-export #content .coursebook-section {
      display: none;
    }

    body.is-export #content .coursebook-section.active {
      display: block;
    }

    /* Reading column: the app's --content-measure system (content.css)
       caps and centers the prose children; the export inherits it as-is. */

    /* TOC styling (guide line, indentation, active accent bar, expand
       animation) is the app's own — layout.css ships it to both hosts. */

    .export-header .icon-btn:focus-visible,
    body.is-export .chapter-item:focus-visible,
    body.is-export .toc-item:focus-visible,
    body.is-export .chapter-nav__btn:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    /* ===== Dual-theme code: re-skin on dark without re-highlighting.
       All blocks — terminal fences included — bake both themes and follow
       the app's behavior. ===== */
    [data-theme="dark"] #content pre.shiki {
      background-color: var(--shiki-dark-bg, var(--code-bg-subtle)) !important;
    }

    [data-theme="dark"] #content pre.shiki span {
      color: var(--shiki-dark, inherit) !important;
    }

    /* Presenting chrome hiding lives in present.css (topbar, sidebar,
       action cluster, and the export header are all covered there). */

    /* ===== Print: the whole book as a linear document ===== */
    @media print {
      .export-header,
      .action-cluster,
      body.is-export #tocPane,
      body.is-export #chapterNav,
      #overlay,
      #shortcutsSheet,
      .skip-link,
      #content .code-copy-button,
      #content .go-up-link {
        display: none !important;
      }

      html,
      body,
      body.is-export .app,
      body.is-export .main,
      body.is-export .preview-pane {
        height: auto;
        overflow: visible;
      }

      body.is-export #content {
        max-width: none;
      }

      body.is-export #content .coursebook-section {
        display: block !important;
      }

      body.is-export #content .coursebook-section:not(:first-child) {
        break-before: page;
      }

      #content pre,
      #content figure,
      #content table,
      #content blockquote {
        break-inside: avoid;
      }

      #content h1,
      #content h2,
      #content h3 {
        break-after: avoid;
      }

      /* Print code with the light theme whatever the viewer's mode. */
      #content pre.shiki,
      #content pre.shiki span {
        color: var(--shiki-light, inherit) !important;
      }

      #content pre.shiki {
        background-color: var(--shiki-light-bg, #ffffff) !important;
      }
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

/**
 * CoursebookExporter
 *
 * Exports a complete coursebook as a standalone HTML file.
 * Renders all chapters with Shiki syntax highlighting, KaTeX math,
 * and copy buttons, then bundles them into a single navigable page.
 *
 * CSS is extracted from the live document's stylesheets at export time,
 * so the export always matches the app's current styling (theme, palette,
 * content styles, copy button styles, etc.).
 */
import { renderMarkdown, sanitizeHtml } from "./markdown-renderer.js";
import { ContentEnhancer } from "./content-enhancer.js";
import { loadChapter, getChapterTitle } from "../core/coursebook-loader.js";
import {
  computeSectionNumbersForSections,
  applyHeadingNumber,
} from "../core/section-numbering.js";
import { slugifyForId, resolveContentImages } from "../core/utils.js";
import { flashHeading } from "../core/heading-flash.js";
import {
  parseLocationHash,
  formatLocationHash,
  navigateToTarget,
} from "../core/navigation.js";
import { ThemeManager } from "../core/theme-manager.js";

/**
 * @typedef {import("../core/coursebook-loader.js").Coursebook} Coursebook
 */

/**
 * Export a coursebook to a standalone HTML string.
 *
 * @param {Coursebook} coursebook - The parsed coursebook.
 * @returns {Promise<string>} A complete HTML document string.
 */
export async function exportCoursebookHtml(coursebook) {
  // Ensure dynamic CSS (KaTeX, Mermaid) is loaded so it appears in
  // document.styleSheets when we extract CSS below.
  await ContentEnhancer.ensureStylesLoaded();

  // Render the landing page and all chapters into containers first
  const landing = await renderSection(coursebook.markdown);
  const renderedChapters = [];
  for (const chapter of coursebook.chapters) {
    const markdown =
      chapter.markdown !== undefined
        ? chapter.markdown
        : await loadChapter(chapter.resolvedPath ?? chapter.path);
    renderedChapters.push({
      chapter,
      markdown,
      rendered: await renderSection(markdown, chapter.resolvedPath),
    });
  }

  // Collect all headings across all sections and apply continuous
  // section numbering so each chapter continues from the previous one.
  const allRendered = [landing, ...renderedChapters.map((r) => r.rendered)];
  applyContinuousSectionNumbers(allRendered, { skipFirst: true });

  // Rewrite parent chapter .md links to #chapter-slug hash links so
  // they navigate within the exported page instead of pointing to
  // files that don't exist in the standalone HTML.
  rewriteExportedChapterLinks(landing.container, coursebook);

  // Deduplicate heading IDs globally across all sections, and reserve
  // section IDs so a heading with the same text as a chapter title
  // doesn't collide with the section's own id.
  deduplicateIds(allRendered, [
    "overview",
    ...renderedChapters.map((r) => slugifyForId(r.chapter.title)),
  ]);

  // Build section metadata. Section IDs use chapter slugs (same as the app)
  // so hash navigation format is unified: #chapter-slug/heading-slug
  const sections = [
    {
      id: "overview",
      title: "Overview",
      html: landing.container.innerHTML,
      headings: landing.headings,
    },
  ];

  for (let i = 0; i < renderedChapters.length; i++) {
    const { chapter, rendered } = renderedChapters[i];
    const title = getChapterTitle(renderedChapters[i].markdown, chapter.title);
    sections.push({
      id: slugifyForId(chapter.title),
      title: `${i + 1}. ${title}`,
      html: rendered.container.innerHTML,
      headings: rendered.headings,
    });
  }

  return buildHtmlDocument(coursebook.title, sections, coursebook.nav);
}

/**
 * Export a single markdown document (standalone mode) to HTML.
 *
 * @param {string} title - The page title.
 * @param {string} markdown - The markdown content.
 * @returns {Promise<string>}
 */
export async function exportSingleHtml(title, markdown) {
  const rendered = await renderSection(markdown);
  applyContinuousSectionNumbers([rendered]);
  return buildHtmlDocument(title, [
    {
      id: "content",
      title,
      html: rendered.container.innerHTML,
      headings: rendered.headings,
    },
  ]);
}

/**
 * Render markdown to a container, add heading ids, and run content enhancement
 * (Shiki, KaTeX, copy buttons). Does not add section numbers — those are
 * computed globally across all sections and applied separately.
 *
 * @param {string} markdown
 * @param {string} [resolvedPath] - The chapter path, used to resolve relative image srcs.
 * @returns {Promise<{container: HTMLElement, headings: Array<{id: string, level: number, title: string}>}>}
 */
async function renderSection(markdown, resolvedPath = null) {
  const container = document.createElement("div");
  container.innerHTML = sanitizeHtml(renderMarkdown(markdown));

  const rawHeadings = Array.from(container.querySelectorAll("h1, h2, h3"));
  for (const heading of rawHeadings) {
    if (!heading.id) {
      heading.id = slugifyForId(heading.textContent);
    }
  }

  await ContentEnhancer.enhance(container);
  resolveContentImages(container, resolvedPath);
  await inlineImages(container);

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
 */
async function inlineImages(container) {
  const imgs = Array.from(container.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src") || "";
      if (!src || src.startsWith("data:") || src.startsWith("blob:")) return;
      if (/^https?:/.test(src)) return; // leave absolute URLs as-is
      try {
        img.src = await fetchAsDataUri(src);
      } catch {
        // leave as-is on failure
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
 * @param {Array<{container: HTMLElement, headings: Array<{id: string, level: number, title: string}>}>} rendered
 */
function applyContinuousSectionNumbers(rendered, { skipFirst = false } = {}) {
  const sections = rendered.map((r) =>
    Array.from(r.container.querySelectorAll("h1, h2, h3")),
  );
  // skipFirst ensures the landing page is never numbered, even when
  // the coursebook has zero chapters (single-section array).
  const numbersBySection = computeSectionNumbersForSections(sections, { skipFirst });

  for (let s = 0; s < rendered.length; s++) {
    const { container, headings } = rendered[s];
    const numbers = numbersBySection[s];
    const containerHeadings = Array.from(container.querySelectorAll("h1, h2, h3"));

    for (let i = 0; i < containerHeadings.length; i++) {
      const num = numbers[i];
      const heading = containerHeadings[i];
      applyHeadingNumber(heading, num);
      if (headings[i]) headings[i].number = num;
    }
  }
}

/**
 * Deduplicate heading IDs across all rendered sections and reserve section
 * IDs so no heading gets the same id as a `<section>` wrapper.
 *
 * @param {Array<{container: HTMLElement, headings: Array<{id: string, level: number, title: string}>}>} rendered
 * @param {string[]} sectionIds - IDs reserved for `<section>` wrappers.
 */
function deduplicateIds(rendered, sectionIds) {
  const usedIds = new Set(sectionIds);

  for (const { container, headings } of rendered) {
    const els = Array.from(container.querySelectorAll("h1, h2, h3"));
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el.id || usedIds.has(el.id)) {
        const baseId = el.id || slugifyForId(el.textContent);
        let uniqueId = baseId;
        let suffix = 1;
        while (usedIds.has(uniqueId)) {
          uniqueId = `${baseId}-${suffix++}`;
        }
        el.id = uniqueId;
        if (headings[i]) headings[i].id = uniqueId;
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
 * @param {import("../core/coursebook-loader.js").Coursebook} coursebook
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
 * @param {Array<{id: string, title: string, html: string, headings: Array<{id: string, level: number, number: string, title: string}>}>} sections
 * @returns {Promise<string>}
 */
async function buildHtmlDocument(title, sections, nav = null) {
  const theme = ThemeManager.getCurrentTheme();
  const palette = ThemeManager.getPalette();

  // Build sidebar nav groups: each chapter has its TOC nested inline.
  // TOC links use the unified hash format: #chapter-slug/heading-slug
  const chevronSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

  function navGroupForSection(s) {
    const tocItems = s.headings
      .filter((h) => h.level > 1) // skip H1 — the nav item already represents it
      .map((h) => {
        const text = h.number ? `${h.number} ${h.title}` : h.title;
        const hash = formatLocationHash(s.id, h.id);
        return `          <a href="${hash}" class="export-toc-item export-toc-item--h${h.level}">${escapeHtml(text)}</a>`;
      })
      .join("\n");
    const hasToc = tocItems.trim().length > 0;
    return `        <div class="export-nav-group" data-section-id="${s.id}">
          <div class="export-nav-item-row">
            <a href="${formatLocationHash(s.id)}" class="export-nav-item">${escapeHtml(s.title)}</a>${
              hasToc
                ? `\n            <button type="button" class="export-nav-toggle" aria-label="Toggle section" aria-expanded="false">${chevronSvg}</button>`
                : ""
            }
          </div>
          <div class="export-nav-toc">
${tocItems}
          </div>
        </div>`;
  }

  // The overview (section 0) always comes first, then the coursebook's nav
  // structure (group labels + chapters) when available.
  const navParts = [navGroupForSection(sections[0])];
  if (Array.isArray(nav) && nav.length > 0) {
    for (const entry of nav) {
      if (entry.type === "group") {
        navParts.push(
          `        <div class="export-nav-label">${escapeHtml(entry.title)}</div>`,
        );
      } else {
        const section = sections[entry.index + 1];
        if (section) navParts.push(navGroupForSection(section));
      }
    }
  } else {
    for (let i = 1; i < sections.length; i++) {
      navParts.push(navGroupForSection(sections[i]));
    }
  }
  const navGroups = navParts.join("\n");

  const sectionHtml = sections
    .map((s) => `<section id="${s.id}" class="export-section">\n${s.html}\n</section>`)
    .join('\n<hr class="export-divider">\n');

  const appCss = await extractCssFromDocument();
  const exportLayoutCss = getExportLayoutCss();

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}" data-palette="${palette}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${appCss}
${exportLayoutCss}
</style>
</head>
<body>
<div class="export-layout">
  <nav class="export-sidebar">
    <div class="export-sidebar__header">
      <span class="export-sidebar__title">${escapeHtml(title)}</span>
      <button
        type="button"
        class="export-sidebar-toggle"
        id="exportSidebarToggle"
        aria-label="Toggle navigation"
        aria-expanded="true"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/></svg>
      </button>
    </div>
    <div class="export-sidebar__body">
      <div class="export-sidebar__nav">
${navGroups}
      </div>
    </div>
    <div class="export-sidebar__footer">
      <button type="button" class="export-theme-toggle" aria-label="Toggle theme">
        <span class="export-theme-toggle__label">${theme === "dark" ? "Switch to light" : "Switch to dark"}</span>
      </button>
    </div>
    <button
      type="button"
      class="export-sidebar-reopen"
      id="exportSidebarReopen"
      aria-label="Open navigation"
      aria-hidden="true"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/></svg>
    </button>
  </nav>
  <main class="export-content">
    <div id="content">
${sectionHtml}
    </div>
  </main>
</div>
<script>${getExportScript()}</script>
</body>
</html>`;
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
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Resolve a raw URL found in CSS against a base URL and determine whether it
 * should be inlined into the exported stylesheet.
 * @param {string} rawUrl
 * @param {string} baseUrl
 * @returns {string | null}
 */
function resolveCssUrl(rawUrl, baseUrl) {
  if (
    rawUrl.startsWith("data:") ||
    rawUrl.startsWith("blob:") ||
    rawUrl.startsWith("#")
  ) {
    return null;
  }
  try {
    const absolute = new URL(rawUrl, baseUrl).href;
    if (absolute.startsWith("http:") || absolute.startsWith("https:")) {
      const absoluteUrl = new URL(absolute);
      const origin = typeof location !== "undefined" ? location.origin : "";
      if (origin && absoluteUrl.origin !== origin) {
        return null; // leave cross-origin http(s) URLs as-is
      }
    }
    return absolute;
  } catch {
    return null;
  }
}

/**
 * Convert relative CSS url(...) references into base64 data URIs so the
 * exported single-file HTML works no matter where it is saved.
 * @param {string} css
 * @param {string} baseUrl
 * @returns {Promise<string>}
 */
async function inlineCssUrls(css, baseUrl) {
  const urlRegex = /url\((['"]?)([^)'"]+?)\1\)/g;
  const toInline = new Map(); // rawUrl -> absolute

  let match;
  while ((match = urlRegex.exec(css)) !== null) {
    const rawUrl = match[2].trim();
    if (toInline.has(rawUrl)) continue;
    const absolute = resolveCssUrl(rawUrl, baseUrl);
    if (absolute) toInline.set(rawUrl, absolute);
  }

  const dataUris = new Map();
  await Promise.all(
    Array.from(toInline.entries()).map(async ([rawUrl, absolute]) => {
      try {
        dataUris.set(rawUrl, await fetchAsDataUri(absolute));
      } catch {
        // leave as-is on failure
      }
    }),
  );

  return css.replace(
    new RegExp(urlRegex.source, urlRegex.flags),
    (full, quote, rawUrl) => {
      const dataUri = dataUris.get(rawUrl.trim());
      return dataUri ? `url(${dataUri})` : full;
    },
  );
}

/**
 * Extract CSS rules from the live document's stylesheets for the export.
 * Only includes stylesheets that are safe and useful for the export:
 * base.css (variables), content.css (document styles), and vendor CSS
 * such as KaTeX. App layout CSS (layout.css, controls.css, present.css)
 * is excluded to prevent conflicts with the export layout.
 *
 * Relative font/image URLs are resolved against the stylesheet's base URL and
 * inlined as data URIs so the export works as a single standalone file.
 *
 * @returns {Promise<string>}
 */
async function extractCssFromDocument() {
  const allowed = ["base.css", "content.css", "katex", "mermaid"];
  const appSelectorsToExclude = [
    ".main",
    ".editor-pane",
    ".toc-pane",
    ".topbar",
    ".chapter-nav",
    ".overlay",
    ".modal",
  ];

  function isAllowedSheet(sheet) {
    const owner = sheet.ownerNode;
    const source =
      owner?.dataset?.viteDevId ||
      owner?.getAttribute?.("href") ||
      owner?.getAttribute?.("src") ||
      "";
    return allowed.some((token) => source.toLowerCase().includes(token.toLowerCase()));
  }

  function getSheetBaseUrl(sheet) {
    if (sheet.href) return sheet.href;
    if (typeof document !== "undefined" && document.baseURI) return document.baseURI;
    return "";
  }

  /* eslint-disable no-undef */
  const STYLE_RULE = typeof CSSRule !== "undefined" ? CSSRule.STYLE_RULE : 1;
  const MEDIA_RULE = typeof CSSRule !== "undefined" ? CSSRule.MEDIA_RULE : 4;
  const SUPPORTS_RULE = typeof CSSRule !== "undefined" ? CSSRule.SUPPORTS_RULE : 12;
  /* eslint-enable no-undef */

  function ruleIsExcluded(rule) {
    if (rule.type !== STYLE_RULE) return false;
    const selector = rule.selectorText || "";
    return appSelectorsToExclude.some((sel) => selector.includes(sel));
  }

  async function collectRules(rules, parts, baseUrl) {
    for (const rule of rules) {
      if (rule.type === MEDIA_RULE || rule.type === SUPPORTS_RULE) {
        const inner = [];
        await collectRules(rule.cssRules, inner, baseUrl);
        if (inner.length > 0) {
          const condition =
            rule.type === MEDIA_RULE ? rule.media.mediaText : rule.conditionText;
          const wrapper = rule.type === MEDIA_RULE ? "@media" : "@supports";
          parts.push(`${wrapper} ${condition} {\n  ${inner.join("\n  ")}\n}`);
        }
      } else if (rule.type === STYLE_RULE && !ruleIsExcluded(rule)) {
        let css = rule.cssText;
        if (css && !css.includes("@vite/") && !css.includes("import.meta.hot")) {
          css = await inlineCssUrls(css, baseUrl);
          parts.push(css);
        }
      } else if (rule.type !== STYLE_RULE) {
        let css = rule.cssText;
        if (css && !css.includes("@vite/") && !css.includes("import.meta.hot")) {
          css = await inlineCssUrls(css, baseUrl);
          parts.push(css);
        }
      }
    }
  }

  // Detect Vite dev mode: if any sheet was injected with data-vite-dev-id,
  // we can safely pick source files. In a production build the CSS is bundled
  // into one or a few sheets, so we fall back to including all sheets and
  // rely on the export layout CSS !important overrides to avoid conflicts.
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
    } catch {
      // Cross-origin sheets are not accessible — skip silently
    }
  }
  return parts.join("\n");
}

/**
 * Minimal CSS for the export layout (sidebar + content).
 * This is the only CSS that is export-specific — everything else
 * comes from the app's own stylesheets.
 */
function getExportLayoutCss() {
  return `
    /* =========================================================================
       Export layout resets — these use !important where needed to override
       any app CSS extracted from document.styleSheets that would otherwise
       conflict with the standalone exported page layout.
       ========================================================================= */

    html, body {
      height: auto !important;
      overflow: auto !important;
      min-height: 100% !important;
    }

    body {
      margin: 0 !important;
      background: var(--theme-bg, #f8f9fa) !important;
    }

    /* Make sure sections and content inside the export are fully visible */
    body.spotlight #content .export-section,
    #content .export-section {
      opacity: 1 !important;
    }

    .export-layout {
      display: block !important;
      min-height: 100vh !important;
    }

    .export-sidebar {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 260px !important;
      height: 100vh !important;
      display: flex !important;
      flex-direction: column !important;
      background: var(--surface-bg, #fff) !important;
      border-right: 1px solid var(--border-medium, #e5e7eb) !important;
      z-index: 100 !important;
      box-sizing: border-box !important;
      overflow: hidden !important;
      transition: width 0.2s ease !important;
    }

    .export-sidebar.is-collapsed {
      width: 44px !important;
    }

    .export-sidebar.is-collapsed .export-sidebar__title,
    .export-sidebar.is-collapsed .export-sidebar__body,
    .export-sidebar.is-collapsed .export-sidebar__footer {
      display: none !important;
    }

    .export-sidebar.is-collapsed .export-sidebar__header {
      justify-content: center !important;
      padding: 8px 0 !important;
    }

    .export-sidebar.is-collapsed .export-sidebar-reopen {
      display: flex !important;
    }

    .export-sidebar__header {
      flex-shrink: 0 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 8px !important;
      padding: 14px 12px 12px 16px !important;
      font-size: 16px !important;
      font-weight: 700 !important;
      color: var(--text-high, #1f2937) !important;
      background: var(--surface-bg, #fff) !important;
      border-bottom: 1px solid var(--border-subtle, #e5e7eb) !important;
    }

    .export-sidebar__title {
      display: block !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      flex: 1 !important;
    }

    .export-sidebar-toggle {
      flex-shrink: 0 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 28px !important;
      height: 28px !important;
      border: none !important;
      background: transparent !important;
      border-radius: var(--radius-sm, 4px) !important;
      color: var(--text-low, #6b7280) !important;
      cursor: pointer !important;
      padding: 0 !important;
      transition: background 0.1s ease, color 0.1s ease !important;
    }

    .export-sidebar-toggle:hover {
      background: var(--surface-hover, rgba(0,0,0,0.04)) !important;
      color: var(--text-high, #1f2937) !important;
    }

    .export-sidebar-reopen {
      display: none !important;
      position: absolute !important;
      top: 8px !important;
      left: 8px !important;
      align-items: center !important;
      justify-content: center !important;
      width: 28px !important;
      height: 28px !important;
      border: none !important;
      background: transparent !important;
      border-radius: var(--radius-sm, 4px) !important;
      color: var(--text-low, #6b7280) !important;
      cursor: pointer !important;
      padding: 0 !important;
    }

    .export-sidebar-reopen:hover {
      background: var(--surface-hover, rgba(0,0,0,0.04)) !important;
      color: var(--text-high, #1f2937) !important;
    }

    .export-sidebar__body {
      flex: 1 !important;
      display: flex !important;
      flex-direction: column !important;
      min-height: 0 !important;
      overflow: hidden !important;
    }

    .export-sidebar__nav {
      flex: 1 !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 2px !important;
      padding: 0 8px 8px !important;
      overflow-y: auto !important;
      min-height: 0 !important;
    }

    .export-nav-group {
      display: flex !important;
      flex-direction: column !important;
    }

    .export-nav-label {
      padding: 12px 12px 2px !important;
      color: var(--text-low, #6b7280) !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.06em !important;
      line-height: 1.4 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }

    .export-nav-item-row {
      display: flex !important;
      align-items: center !important;
      gap: 2px !important;
    }

    .export-nav-toggle {
      flex-shrink: 0 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 24px !important;
      height: 24px !important;
      border: none !important;
      background: transparent !important;
      cursor: pointer !important;
      border-radius: var(--radius-sm, 4px) !important;
      color: var(--text-low, #6b7280) !important;
      padding: 0 !important;
      transition: background 0.1s ease, color 0.1s ease !important;
    }

    .export-nav-toggle:hover {
      background: var(--surface-hover, rgba(0,0,0,0.04)) !important;
      color: var(--text-high, #1f2937) !important;
    }

    .export-nav-toggle svg {
      display: block !important;
      transition: transform 0.2s ease !important;
    }

    .export-nav-group.is-open .export-nav-toggle svg {
      transform: rotate(90deg) !important;
    }

    .export-nav-toc {
      display: none !important;
      flex-direction: column !important;
      gap: 1px !important;
      padding: 2px 0 4px 12px !important;
    }

    .export-nav-group.is-open .export-nav-toc {
      display: flex !important;
    }

    .export-sidebar__footer {
      flex-shrink: 0 !important;
      padding: 10px 12px 14px !important;
      border-top: 1px solid var(--border-subtle, #e5e7eb) !important;
      background: var(--surface-bg, #fff) !important;
    }

    .export-theme-toggle {
      width: 100% !important;
      display: block !important;
      padding: 8px 12px !important;
      border: 1px solid var(--border-medium, #e5e7eb) !important;
      border-radius: var(--radius-sm, 4px) !important;
      background: var(--surface-elevated, #f8f9fa) !important;
      color: var(--text-medium, #4b5563) !important;
      font-family: var(--font-sans, sans-serif) !important;
      font-size: 12px !important;
      font-weight: 500 !important;
      text-align: center !important;
      cursor: pointer !important;
    }

    .export-theme-toggle:hover {
      background: var(--surface-hover, rgba(0,0,0,0.04)) !important;
      color: var(--text-high, #1f2937) !important;
      border-color: var(--border-strong, #9ca3af) !important;
    }

    .export-nav-item {
      display: block !important;
      padding: 8px 12px !important;
      border-radius: var(--radius-sm, 4px) !important;
      font-size: 15px !important;
      font-weight: 600 !important;
      color: var(--text-high, #1f2937) !important;
      text-decoration: none !important;
      transition: background 0.1s ease, color 0.1s ease !important;
    }

    .export-nav-item:hover {
      background: var(--surface-hover, rgba(0,0,0,0.04)) !important;
      color: var(--text-high, #1f2937) !important;
    }

    .export-nav-item.active {
      background: var(--accent-bg, rgba(124,99,184,0.12)) !important;
      color: var(--accent-text, #7c63b8) !important;
      font-weight: 700 !important;
      box-shadow: inset 3px 0 0 var(--accent, #7c63b8) !important;
    }

    .export-toc-item.active {
      color: var(--accent-text, #7c63b8) !important;
      font-weight: 600 !important;
      background: var(--accent-bg, rgba(124,99,184,0.08)) !important;
    }

    .export-toc-item {
      display: block !important;
      padding: 5px 12px !important;
      border-radius: var(--radius-sm, 4px) !important;
      font-size: 14px !important;
      color: var(--text-high, #1f2937) !important;
      text-decoration: none !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      transition: background 0.1s ease, color 0.1s ease !important;
    }

    .export-toc-item--h2 {
      padding-left: 20px !important;
      font-size: 14px !important;
    }

    .export-toc-item--h3 {
      padding-left: 32px !important;
      font-size: 13px !important;
      color: var(--text-medium, #4b5563) !important;
    }

    .export-toc-item:hover {
      background: var(--surface-hover, rgba(0,0,0,0.04)) !important;
      color: var(--text-high, #1f2937) !important;
    }

    .export-toc-item.active {
      background: var(--accent-bg, rgba(124,99,184,0.12)) !important;
      color: var(--accent-text, #7c63b8) !important;
      font-weight: 600 !important;
    }

    .export-content {
      margin-left: 260px !important;
      min-height: 100vh !important;
    }

    .export-content main,
    .export-content > div {
      min-height: 100vh !important;
    }

    /* The #content wrapper lets the app's scoped styles (#content ...) apply */
    #content {
      max-width: 1200px !important;
      margin: 0 auto !important;
      padding: 48px 32px 80px !important;
      opacity: 1 !important;
      display: block !important;
      visibility: visible !important;
    }

    .export-section {
      display: block !important;
      scroll-margin-top: 24px !important;
      opacity: 1 !important;
      visibility: visible !important;
    }

    .export-divider {
      border: none !important;
      border-top: 1px solid var(--border-subtle, #e5e7eb) !important;
      margin: 48px 0 !important;
      display: block !important;
    }

    /* Hide app chrome that isn't relevant in the export */
    .topbar, .editor-pane, .toc-pane, .chapter-nav, .overlay, .modal { display: none !important; }

    @media (max-width: 768px) {
      .export-sidebar {
        width: 100% !important;
        height: auto !important;
        position: relative !important;
        top: auto !important;
        left: auto !important;
        border-right: none !important;
        border-bottom: 1px solid var(--border-medium, #e5e7eb) !important;
        z-index: auto !important;
      }
      /* On mobile the sidebar stacks above the content, so keep it expanded */
      .export-sidebar.is-collapsed {
        width: 100% !important;
      }
      .export-sidebar.is-collapsed .export-sidebar__title,
      .export-sidebar.is-collapsed .export-sidebar__body,
      .export-sidebar.is-collapsed .export-sidebar__footer {
        display: block !important;
      }
      .export-sidebar.is-collapsed .export-sidebar__header {
        justify-content: space-between !important;
        padding: 14px 12px 12px 16px !important;
      }
      .export-sidebar.is-collapsed .export-sidebar-reopen {
        display: none !important;
      }
      .export-content { margin-left: 0 !important; }
      #content { padding: 24px 16px 48px !important; }
    }
  `;
}

/**
 * Get the inline JavaScript for the exported HTML.
 * Handles copy button clicks and sidebar active state.
 */
function getExportScript() {
  // Inject shared function bodies into the standalone script so the export
  // uses the same logic as the app without duplicating code.
  const flashHeadingFn = flashHeading.toString();
  const parseLocationHashFn = parseLocationHash.toString();
  const formatLocationHashFn = formatLocationHash.toString();
  const navigateToTargetFn = navigateToTarget.toString();

  return `
    (function() {
      // SVG icon strings for copy button states
      var ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
      var CHECK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>';
      var X_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m15 11-6 6"/><path d="m9 11 6 6"/></svg>';

      function setCopyIcon(btn, svg) {
        var old = btn.querySelector("svg");
        if (old) old.remove();
        btn.insertAdjacentHTML("beforeend", svg);
      }

      // Copy button functionality
      document.addEventListener("click", function(e) {
        var btn = e.target.closest(".code-copy-button");
        if (!btn) return;
        e.preventDefault();
        var pre = btn.closest("pre");
        if (!pre) return;
        var code = pre.querySelector("code");
        if (!code) return;
        var text = code.textContent || "";

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function() {
            btn.classList.add("is-copied");
            setCopyIcon(btn, CHECK_SVG);
            setTimeout(reset, 2000);
          }).catch(function() {
            btn.classList.add("is-copy-failed");
            setCopyIcon(btn, X_SVG);
            setTimeout(reset, 2000);
          });
        } else {
          btn.classList.add("is-copy-failed");
          setCopyIcon(btn, X_SVG);
          setTimeout(reset, 2000);
        }

        function reset() {
          btn.classList.remove("is-copied", "is-copy-failed");
          setCopyIcon(btn, ICON_SVG);
        }
      });

      // Sidebar collapse/expand
      var sidebar = document.querySelector(".export-sidebar");
      var sidebarToggle = document.getElementById("exportSidebarToggle");
      var sidebarReopen = document.getElementById("exportSidebarReopen");

      function setSidebarCollapsed(collapsed) {
        if (!sidebar) return;
        sidebar.classList.toggle("is-collapsed", collapsed);
        if (sidebarToggle) sidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        if (sidebarReopen) {
          sidebarReopen.setAttribute("aria-hidden", collapsed ? "false" : "true");
          sidebarReopen.tabIndex = collapsed ? 0 : -1;
        }
      }

      if (sidebarToggle) {
        sidebarToggle.addEventListener("click", function() {
          setSidebarCollapsed(true);
        });
      }
      if (sidebarReopen) {
        sidebarReopen.addEventListener("click", function() {
          setSidebarCollapsed(false);
        });
      }

      // Theme toggle
      var themeToggle = document.querySelector(".export-theme-toggle");
      var themeLabel = themeToggle && themeToggle.querySelector(".export-theme-toggle__label");

      function updateThemeToggle(current) {
        if (themeLabel) themeLabel.textContent = current === "dark" ? "Switch to light" : "Switch to dark";
      }

      var savedTheme = null;
      try {
        savedTheme = localStorage.getItem("coursebookmd_theme");
      } catch {}
      if (savedTheme === "light" || savedTheme === "dark") {
        document.documentElement.setAttribute("data-theme", savedTheme);
      }
      updateThemeToggle(document.documentElement.getAttribute("data-theme") || "light");

      if (themeToggle) {
        themeToggle.addEventListener("click", function() {
          var current = document.documentElement.getAttribute("data-theme") || "light";
          var next = current === "dark" ? "light" : "dark";
          document.documentElement.setAttribute("data-theme", next);
          try {
            localStorage.setItem("coursebookmd_theme", next);
          } catch {}
          updateThemeToggle(next);
        });
      }

      // Shared functions injected from core modules (same logic as the app)
      var flashHeadingFn = ${flashHeadingFn};
      var parseLocationHashFn = ${parseLocationHashFn};
      var formatLocationHashFn = ${formatLocationHashFn};
      var navigateToTargetFn = ${navigateToTargetFn};

      // Sidebar: nav groups with inline TOCs
      var sections = document.querySelectorAll(".export-section");
      var navGroups = document.querySelectorAll(".export-nav-group");

      // Track which sections the user has manually toggled so scroll-spy
      // doesn't override their choice. Auto-expand only happens on initial
      // load for the active section.
      var userToggled = new Set();

      function updateActive() {
        var scrollY = window.scrollY;
        var offset = 100;
        var activeIdx = 0;
        for (var i = 0; i < sections.length; i++) {
          var rect = sections[i].getBoundingClientRect();
          var sectionTop = rect.top + scrollY;
          if (sectionTop - offset <= scrollY) {
            activeIdx = i;
          }
        }
        navGroups.forEach(function(group, i) {
          var navItem = group.querySelector(".export-nav-item");
          var isActive = i === activeIdx;
          if (navItem) navItem.classList.toggle("active", isActive);

          // Auto-expand the active section's TOC unless the user has
          // manually toggled this group.
          if (isActive && !userToggled.has(group)) {
            group.classList.add("is-open");
            var toggle = group.querySelector(".export-nav-toggle");
            if (toggle) toggle.setAttribute("aria-expanded", "true");
          }

          // Auto-collapse inactive sections only if the user hasn't
          // manually toggled them.
          if (!isActive && !userToggled.has(group)) {
            group.classList.remove("is-open");
            var toggle2 = group.querySelector(".export-nav-toggle");
            if (toggle2) toggle2.setAttribute("aria-expanded", "false");
          }
        });

        // Highlight the active TOC item based on scroll position
        var activeHeadingId = null;
        var allHeadings = [];
        for (var i = 0; i < sections.length; i++) {
          var headings = sections[i].querySelectorAll("h2, h3");
          for (var j = 0; j < headings.length; j++) {
            allHeadings.push(headings[j]);
          }
        }
        for (var k = 0; k < allHeadings.length; k++) {
          var hRect = allHeadings[k].getBoundingClientRect();
          if (hRect.top - offset <= 0) {
            activeHeadingId = allHeadings[k].id;
          }
        }
        document.querySelectorAll(".export-toc-item.active").forEach(function(el) {
          el.classList.remove("active");
        });
        if (activeHeadingId) {
          var escapedId = activeHeadingId.replace(/"/g, '\\"');
          var activeLink = document.querySelector(
            '.export-toc-item[href$="/' + escapedId + '"]'
          );
          if (activeLink) activeLink.classList.add("active");
        }
      }

      // Nav + TOC clicks — parse the unified hash format and navigate
      function handleNavClick(e) {
        var link = e.target.closest("a");
        if (!link) return;
        e.preventDefault();
        var hash = link.getAttribute("href").slice(1);
        var parsed = parseLocationHashFn(hash);
        var section = document.getElementById(parsed.chapterSlug);
        if (!section) return;
        var target = parsed.headingSlug
          ? section.querySelector("#" + CSS.escape(parsed.headingSlug))
          : section;
        if (target) {
          navigateToTargetFn(target, parsed.chapterSlug, parsed.headingSlug, flashHeadingFn);
        }
      }

      // Navigate to hash on load or on hashchange
      function navigateFromHash() {
        var parsed = parseLocationHashFn(location.hash.slice(1));
        if (!parsed.chapterSlug) return;
        var section = document.getElementById(parsed.chapterSlug);
        if (!section) return;
        var target = parsed.headingSlug
          ? section.querySelector("#" + CSS.escape(parsed.headingSlug))
          : section;
        if (target) {
          navigateToTargetFn(target, parsed.chapterSlug, parsed.headingSlug, flashHeadingFn);
        }
      }

      // Toggle button: expand/collapse the TOC for a nav group
      navGroups.forEach(function(group) {
        var toggle = group.querySelector(".export-nav-toggle");
        if (toggle) {
          toggle.addEventListener("click", function(e) {
            e.preventDefault();
            e.stopPropagation();
            userToggled.add(group);
            var isOpen = group.classList.toggle("is-open");
            toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
          });
        }
        group.addEventListener("click", handleNavClick);
      });

      window.addEventListener("hashchange", navigateFromHash);
      window.addEventListener("scroll", updateActive);
      updateActive();
      navigateFromHash();
    })();
  `;
}

/**
 * Escape HTML special characters for safe insertion into text content.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

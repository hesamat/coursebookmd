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
import { computeSectionNumbersForSections } from "../core/section-numbering.js";
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
    const markdown = await loadChapter(chapter.resolvedPath ?? chapter.path);
    renderedChapters.push({
      chapter,
      markdown,
      rendered: await renderSection(markdown),
    });
  }

  // Collect all headings across all sections and apply continuous
  // section numbering so each chapter continues from the previous one.
  const allRendered = [landing, ...renderedChapters.map((r) => r.rendered)];
  applyContinuousSectionNumbers(allRendered);

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
      id: `chapter-${i + 1}`,
      title: `${i + 1}. ${title}`,
      html: rendered.container.innerHTML,
      headings: rendered.headings,
    });
  }

  return buildHtmlDocument(coursebook.title, sections);
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
 * @returns {Promise<{container: HTMLElement, headings: Array<{id: string, level: number, title: string}>}>}
 */
async function renderSection(markdown) {
  const container = document.createElement("div");
  container.innerHTML = sanitizeHtml(renderMarkdown(markdown));

  const rawHeadings = Array.from(container.querySelectorAll("h1, h2, h3"));
  for (const heading of rawHeadings) {
    if (!heading.id) {
      heading.id = heading.textContent
        .trim()
        .toLowerCase()
        .replace(/[^\w]+/g, "-")
        .replace(/^-+|-+$/g, "");
    }
  }

  await ContentEnhancer.enhance(container);

  const headings = rawHeadings.map((heading) => ({
    id: heading.id,
    level: parseInt(heading.tagName.slice(1), 10),
    title: heading.textContent.trim(),
  }));

  return { container, headings };
}

/**
 * Apply continuous section numbers across all rendered sections.
 * The first section (the parent coursebook landing page) is left unnumbered,
 * and numbering continues from chapter to chapter so the second chapter does
 * not reset to "1".
 *
 * @param {Array<{container: HTMLElement, headings: Array<{id: string, level: number, title: string}>}>} rendered
 */
function applyContinuousSectionNumbers(rendered) {
  const sections = rendered.map((r) =>
    Array.from(r.container.querySelectorAll("h1, h2, h3")),
  );
  const numbersBySection = computeSectionNumbersForSections(sections);

  for (let s = 0; s < rendered.length; s++) {
    const { container, headings } = rendered[s];
    const numbers = numbersBySection[s];
    const containerHeadings = Array.from(container.querySelectorAll("h1, h2, h3"));

    for (let i = 0; i < containerHeadings.length; i++) {
      const num = numbers[i];
      const heading = containerHeadings[i];

      // Remove any existing number span so we can apply the correct one
      const existingNum = heading.querySelector(".heading-number");
      if (existingNum) existingNum.remove();
      delete heading.dataset.numbered;

      if (num && !heading.dataset.numbered) {
        const numSpan = document.createElement("span");
        numSpan.className = "heading-number";
        numSpan.textContent = num + " ";
        heading.insertBefore(numSpan, heading.firstChild);
        heading.dataset.numbered = "true";
      }

      if (headings[i]) headings[i].number = num;
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
async function buildHtmlDocument(title, sections) {
  const theme = ThemeManager.getCurrentTheme();
  const palette = ThemeManager.getPalette();

  const chapterNavItems = sections
    .map(
      (s) =>
        `<a href="#${s.id}" class="export-nav-item" data-level="chapter">${escapeHtml(s.title)}</a>`,
    )
    .join("\n      ");

  const tocData = sections.map((s) =>
    s.headings.map((h) => ({
      id: h.id,
      level: h.level,
      text: h.number ? `${h.number} ${h.title}` : h.title,
    })),
  );
  const tocDataJson = JSON.stringify(tocData).replace(/</g, "\\u003c");

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
    </div>
    <div class="export-sidebar__body">
      <div class="export-sidebar__section export-sidebar__section--chapters">
        <div class="export-sidebar__section-title">Chapters</div>
        <div class="export-sidebar__nav">
          ${chapterNavItems}
        </div>
      </div>
      <div class="export-sidebar__section export-sidebar__section--contents">
        <div class="export-sidebar__section-title">Contents</div>
        <div class="export-sidebar__toc"></div>
      </div>
    </div>
    <div class="export-sidebar__footer">
      <button type="button" class="export-theme-toggle" aria-label="Toggle theme">
        <span class="export-theme-toggle__label">${theme === "dark" ? "Switch to light" : "Switch to dark"}</span>
      </button>
    </div>
  </nav>
  <main class="export-content">
    <div id="content">
${sectionHtml}
    </div>
  </main>
</div>
<script>window.__TOC_DATA__ = ${tocDataJson};</script>
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
    }

    .export-sidebar__header {
      flex-shrink: 0 !important;
      padding: 14px 16px 10px !important;
      font-size: 14px !important;
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
    }

    .export-sidebar__body {
      flex: 1 !important;
      display: flex !important;
      flex-direction: column !important;
      min-height: 0 !important;
      overflow: hidden !important;
    }

    .export-sidebar__section {
      display: flex !important;
      flex-direction: column !important;
      min-height: 0 !important;
    }

    .export-sidebar__section--chapters {
      flex-shrink: 0 !important;
      max-height: 30% !important;
      border-bottom: 1px solid var(--border-subtle, #e5e7eb) !important;
    }

    .export-sidebar__section--contents {
      flex: 1 !important;
      min-height: 0 !important;
    }

    .export-sidebar__section-title {
      flex-shrink: 0 !important;
      padding: 10px 16px 6px !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      color: var(--text-low, #6b7280) !important;
      text-transform: uppercase !important;
      letter-spacing: 0.05em !important;
    }

    .export-sidebar__nav,
    .export-sidebar__toc {
      flex: 1 !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 2px !important;
      padding: 0 8px 8px !important;
      overflow-y: auto !important;
      min-height: 0 !important;
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
      padding: 7px 12px !important;
      border-radius: var(--radius-sm, 4px) !important;
      font-size: 13px !important;
      color: var(--text-medium, #4b5563) !important;
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
      font-weight: 600 !important;
    }

    .export-toc-item {
      display: block !important;
      padding: 5px 12px !important;
      border-radius: var(--radius-sm, 4px) !important;
      font-size: 12px !important;
      color: var(--text-medium, #4b5563) !important;
      text-decoration: none !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      transition: background 0.1s ease, color 0.1s ease !important;
    }

    .export-toc-item--h2 {
      padding-left: 20px !important;
      font-size: 12px !important;
    }

    .export-toc-item--h3 {
      padding-left: 32px !important;
      font-size: 11px !important;
      color: var(--text-low, #6b7280) !important;
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
      max-width: 820px !important;
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

      // Sidebar active state on scroll
      var sections = document.querySelectorAll(".export-section");
      var navItems = document.querySelectorAll(".export-nav-item");
      var tocContainer = document.querySelector(".export-sidebar__toc");
      var tocData = window.__TOC_DATA__ || [];

      function renderToc(idx) {
        if (!tocContainer) return;
        while (tocContainer.firstChild) {
          tocContainer.removeChild(tocContainer.firstChild);
        }
        var headings = tocData[idx] || [];
        for (var i = 0; i < headings.length; i++) {
          var h = headings[i];
          var a = document.createElement("a");
          a.href = "#" + h.id;
          a.className = "export-toc-item export-toc-item--h" + h.level;
          a.textContent = h.text;
          a.addEventListener("click", function(e) {
            e.preventDefault();
            var targetId = this.getAttribute("href").slice(1);
            var target = document.getElementById(targetId);
            if (target) {
              target.scrollIntoView({ behavior: "smooth", block: "start" });
              flashHeading(target);
            }
          });
          tocContainer.appendChild(a);
        }
      }

      function flashHeading(heading) {
        heading.classList.remove("flash");
        void heading.offsetWidth;
        heading.classList.add("flash");
        heading.addEventListener("animationend", function() {
          heading.classList.remove("flash");
        }, { once: true });
      }

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
        navItems.forEach(function(item, i) {
          item.classList.toggle("active", i === activeIdx);
        });
        renderToc(activeIdx);
      }

      // Chapter nav clicks — scroll + flash the section heading
      navItems.forEach(function(item) {
        item.addEventListener("click", function(e) {
          e.preventDefault();
          var targetId = this.getAttribute("href").slice(1);
          var target = document.getElementById(targetId);
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            flashHeading(target);
          }
        });
      });

      window.addEventListener("scroll", updateActive);
      updateActive();
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

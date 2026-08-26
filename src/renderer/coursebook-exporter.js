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
import { renderMarkdown } from "./markdown-renderer.js";
import { ContentEnhancer } from "./content-enhancer.js";
import { loadChapter, getChapterTitle } from "../core/coursebook-loader.js";
import { computeSectionNumbers } from "../core/section-numbering.js";
import { ThemeManager } from "../core/theme-manager.js";
import DOMPurify from "dompurify";

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
  const sections = [];

  // Ensure dynamic CSS (KaTeX, Mermaid) is loaded so it appears in
  // document.styleSheets when we extract CSS below.
  await ContentEnhancer.ensureStylesLoaded();

  // Render the landing page
  const landing = await renderAndEnhanceSection(coursebook.markdown);
  sections.push({
    id: "overview",
    title: "Overview",
    html: landing.html,
    headings: landing.headings,
  });

  // Render each chapter
  for (let i = 0; i < coursebook.chapters.length; i++) {
    const chapter = coursebook.chapters[i];
    const markdown = await loadChapter(chapter.resolvedPath ?? chapter.path);
    const title = getChapterTitle(markdown, chapter.title);
    const rendered = await renderAndEnhanceSection(markdown);
    sections.push({
      id: `chapter-${i + 1}`,
      title: `${i + 1}. ${title}`,
      html: rendered.html,
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
  const rendered = await renderAndEnhanceSection(markdown);
  return buildHtmlDocument(title, [
    { id: "content", title, html: rendered.html, headings: rendered.headings },
  ]);
}

/**
 * Render markdown to HTML and run content enhancement (Shiki, KaTeX, copy buttons).
 * Uses a detached container so enhancement doesn't affect the live DOM.
 *
 * @param {string} markdown
 * @returns {Promise<{html: string, headings: Array<{id: string, level: number, title: string}>}>}
 */
async function renderAndEnhanceSection(markdown) {
  const container = document.createElement("div");
  container.innerHTML = DOMPurify.sanitize(renderMarkdown(markdown));

  // Ensure every heading has an id for linking/TOC
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

  // Compute and prepend section numbers to headings
  const numbers = computeSectionNumbers(rawHeadings);
  for (let i = 0; i < rawHeadings.length; i++) {
    const num = numbers[i];
    const heading = rawHeadings[i];
    if (num && !heading.dataset.numbered) {
      const numSpan = document.createElement("span");
      numSpan.className = "heading-number";
      numSpan.textContent = num + " ";
      heading.insertBefore(numSpan, heading.firstChild);
      heading.dataset.numbered = "true";
    }
  }

  await ContentEnhancer.enhance(container);

  const headings = Array.from(container.querySelectorAll("h1, h2, h3")).map(
    (heading, i) => {
      const numSpanEl = heading.querySelector(".heading-number");
      const title = numSpanEl
        ? heading.textContent.replace(numSpanEl.textContent, "").trim()
        : heading.textContent.trim();
      return {
        id: heading.id,
        level: parseInt(heading.tagName.slice(1), 10),
        number: numbers[i],
        title,
      };
    },
  );

  return { html: container.innerHTML, headings };
}

/**
 * Build the complete HTML document with navigation and all sections.
 *
 * @param {string} title
 * @param {Array<{id: string, title: string, html: string, headings: Array<{id: string, level: number, number: string, title: string}>}>} sections
 * @returns {string}
 */
function buildHtmlDocument(title, sections) {
  const theme = ThemeManager.getCurrentTheme();
  const palette = ThemeManager.getPalette();

  const chapterNavItems = sections
    .map(
      (s) =>
        `<a href="#${s.id}" class="export-nav-item" data-level="chapter">${escapeHtml(s.title)}</a>`,
    )
    .join("\n      ");

  const tocItems = [];
  for (const section of sections) {
    for (const h of section.headings) {
      const tocText = h.number ? `${h.number} ${h.title}` : h.title;
      tocItems.push(
        `<a href="#${h.id}" class="export-toc-item export-toc-item--h${h.level}" data-level="${h.level}">${escapeHtml(tocText)}</a>`,
      );
    }
  }
  const tocNavItems = tocItems.join("\n      ");

  const sectionHtml = sections
    .map((s) => `<section id="${s.id}" class="export-section">\n${s.html}\n</section>`)
    .join('\n<hr class="export-divider">\n');

  const appCss = extractCssFromDocument();
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
      <button type="button" class="export-theme-toggle" aria-label="Toggle theme">
        <span class="export-theme-toggle__icon" aria-hidden="true"></span>
        <span class="export-theme-toggle__label">${theme === "dark" ? "Light" : "Dark"}</span>
      </button>
    </div>
    <div class="export-sidebar__section">
      <div class="export-sidebar__section-title">Chapters</div>
      <div class="export-sidebar__nav">
        ${chapterNavItems}
      </div>
    </div>
    <div class="export-sidebar__section">
      <div class="export-sidebar__section-title">Contents</div>
      <div class="export-sidebar__toc">
        ${tocNavItems}
      </div>
    </div>
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
 * Extract CSS rules from the live document's stylesheets for the export.
 * Only includes stylesheets that are safe and useful for the export:
 * base.css (variables), content.css (document styles), and vendor CSS
 * such as KaTeX. App layout CSS (layout.css, controls.css, present.css)
 * is excluded to prevent conflicts with the export layout.
 *
 * @returns {string}
 */
function extractCssFromDocument() {
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

  function collectRules(rules, parts) {
    for (const rule of rules) {
      if (rule.type === MEDIA_RULE || rule.type === SUPPORTS_RULE) {
        const inner = [];
        collectRules(rule.cssRules, inner);
        if (inner.length > 0) {
          const condition =
            rule.type === MEDIA_RULE ? rule.media.mediaText : rule.conditionText;
          const wrapper = rule.type === MEDIA_RULE ? "@media" : "@supports";
          parts.push(`${wrapper} ${condition} {\n  ${inner.join("\n  ")}\n}`);
        }
      } else if (rule.type === STYLE_RULE && !ruleIsExcluded(rule)) {
        const css = rule.cssText;
        if (css && !css.includes("@vite/") && !css.includes("import.meta.hot")) {
          parts.push(css);
        }
      } else if (rule.type !== STYLE_RULE) {
        const css = rule.cssText;
        if (css && !css.includes("@vite/") && !css.includes("import.meta.hot")) {
          parts.push(css);
        }
      }
    }
  }

  const parts = [];
  for (const sheet of document.styleSheets) {
    try {
      if (!sheet.cssRules || !isAllowedSheet(sheet)) continue;
      collectRules(sheet.cssRules, parts);
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
      overflow-y: auto !important;
      background: var(--surface-bg, #fff) !important;
      border-right: 1px solid var(--border-medium, #e5e7eb) !important;
      padding: 16px 0 !important;
      z-index: 100 !important;
      box-sizing: border-box !important;
    }

    .export-sidebar__header {
      position: sticky !important;
      top: 0 !important;
      z-index: 2 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 12px 16px 10px !important;
      font-size: 14px !important;
      font-weight: 700 !important;
      color: var(--text-high, #1f2937) !important;
      background: var(--surface-bg, #fff) !important;
      border-bottom: 1px solid var(--border-subtle, #e5e7eb) !important;
      margin-bottom: 8px !important;
    }

    .export-sidebar__title {
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      max-width: 170px !important;
    }

    .export-theme-toggle {
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      padding: 4px 10px !important;
      border: 1px solid var(--border-medium, #e5e7eb) !important;
      border-radius: var(--radius-sm, 4px) !important;
      background: var(--surface-elevated, #f8f9fa) !important;
      color: var(--text-medium, #4b5563) !important;
      font-family: var(--font-sans, sans-serif) !important;
      font-size: 12px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      white-space: nowrap !important;
    }

    .export-theme-toggle:hover {
      background: var(--surface-hover, rgba(0,0,0,0.04)) !important;
      color: var(--text-high, #1f2937) !important;
      border-color: var(--border-strong, #9ca3af) !important;
    }

    .export-theme-toggle__label {
      display: inline !important;
    }

    .export-theme-toggle__icon {
      display: inline-block !important;
      width: 14px !important;
      height: 14px !important;
      border-radius: 50% !important;
      border: 2px solid currentColor !important;
    }

    html[data-theme="dark"] .export-theme-toggle__icon {
      background: radial-gradient(circle, currentColor 40%, transparent 42%) !important;
    }

    html[data-theme="light"] .export-theme-toggle__icon {
      background: currentColor !important;
    }

    .export-sidebar__section {
      padding: 0 0 12px !important;
    }

    .export-sidebar__section-title {
      padding: 8px 16px 6px !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      color: var(--text-low, #6b7280) !important;
      text-transform: uppercase !important;
      letter-spacing: 0.05em !important;
    }

    .export-sidebar__nav,
    .export-sidebar__toc {
      display: flex !important;
      flex-direction: column !important;
      gap: 2px !important;
      padding: 0 8px !important;
      max-height: 35vh !important;
      overflow-y: auto !important;
    }

    .export-sidebar__toc {
      max-height: 45vh !important;
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
      // Copy button functionality
      document.addEventListener("click", function(e) {
        var btn = e.target.closest(".code-copy-button");
        if (!btn) return;
        e.preventDefault();
        var pre = btn.closest("pre");
        if (!pre) return;
        var code = pre.querySelector("code");
        if (!code) return;
        var label = btn.querySelector(".code-copy-button__label");
        var text = code.textContent || "";

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function() {
            if (label) label.textContent = "Copied";
            btn.classList.add("is-copied");
            setTimeout(reset, 2000);
          }).catch(function() {
            if (label) label.textContent = "Failed";
            btn.classList.add("is-copy-failed");
            setTimeout(reset, 2000);
          });
        } else {
          if (label) label.textContent = "Unsupported";
          btn.classList.add("is-copy-failed");
          setTimeout(reset, 2000);
        }

        function reset() {
          if (label) label.textContent = "Copy";
          btn.classList.remove("is-copied", "is-copy-failed");
        }
      });

      // Theme toggle
      var themeToggle = document.querySelector(".export-theme-toggle");
      var themeLabel = themeToggle && themeToggle.querySelector(".export-theme-toggle__label");

      function updateThemeToggle(current) {
        if (themeLabel) themeLabel.textContent = current === "dark" ? "Light" : "Dark";
      }

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
      }

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

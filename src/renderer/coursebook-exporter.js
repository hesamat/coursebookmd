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
  const sections = [];

  // Render the landing page
  const landingHtml = await renderAndEnhanceSection(coursebook.markdown);
  sections.push({
    id: "overview",
    title: "Overview",
    html: landingHtml,
  });

  // Render each chapter
  for (let i = 0; i < coursebook.chapters.length; i++) {
    const chapter = coursebook.chapters[i];
    const markdown = await loadChapter(chapter.path);
    const title = getChapterTitle(markdown, chapter.title);
    const html = await renderAndEnhanceSection(markdown);
    sections.push({
      id: `chapter-${i + 1}`,
      title: `${i + 1}. ${title}`,
      html,
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
  const html = await renderAndEnhanceSection(markdown);
  return buildHtmlDocument(title, [{ id: "content", title, html }]);
}

/**
 * Render markdown to HTML and run content enhancement (Shiki, KaTeX, copy buttons).
 * Uses a detached container so enhancement doesn't affect the live DOM.
 *
 * @param {string} markdown
 * @returns {Promise<string>}
 */
async function renderAndEnhanceSection(markdown) {
  const container = document.createElement("div");
  container.innerHTML = renderMarkdown(markdown);
  await ContentEnhancer.enhance(container);
  return container.innerHTML;
}

/**
 * Build the complete HTML document with navigation and all sections.
 *
 * @param {string} title
 * @param {Array<{id: string, title: string, html: string}>} sections
 * @returns {string}
 */
function buildHtmlDocument(title, sections) {
  const theme = ThemeManager.getCurrentTheme();
  const palette = ThemeManager.getPalette();

  const navItems = sections
    .map((s) => `<a href="#${s.id}" class="export-nav-item">${escapeHtml(s.title)}</a>`)
    .join("\n      ");

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
    <div class="export-sidebar__header">${escapeHtml(title)}</div>
    <div class="export-sidebar__nav">
      ${navItems}
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
 * Extract all CSS rules from the live document's stylesheets.
 * This captures the app's current styling (theme variables, content styles,
 * copy button styles, etc.) so the export matches what you see.
 *
 * @returns {string}
 */
function extractCssFromDocument() {
  const parts = [];
  for (const sheet of document.styleSheets) {
    try {
      if (!sheet.cssRules) continue;
      for (const rule of sheet.cssRules) {
        const css = rule.cssText;
        if (!css) continue;
        // Skip Vite hot-reload artifacts
        if (css.includes("@vite/") || css.includes("import.meta.hot")) continue;
        parts.push(css);
      }
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
    body { margin: 0; background: var(--theme-bg, #f8f9fa); }

    .export-layout {
      display: flex;
      min-height: 100vh;
    }

    .export-sidebar {
      width: 240px;
      flex-shrink: 0;
      background: var(--surface-bg, #fff);
      border-right: 1px solid var(--border-medium, #e5e7eb);
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      padding: 16px 0;
    }

    .export-sidebar__header {
      padding: 0 16px 12px;
      font-size: 14px;
      font-weight: 700;
      color: var(--text-high, #1f2937);
      border-bottom: 1px solid var(--border-subtle, #e5e7eb);
      margin-bottom: 8px;
    }

    .export-sidebar__nav {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 0 8px;
    }

    .export-nav-item {
      display: block;
      padding: 7px 12px;
      border-radius: var(--radius-sm, 4px);
      font-size: 13px;
      color: var(--text-medium, #4b5563);
      text-decoration: none;
      transition: background 0.1s ease, color 0.1s ease;
    }

    .export-nav-item:hover {
      background: var(--surface-hover, rgba(0,0,0,0.04));
      color: var(--text-high, #1f2937);
    }

    .export-nav-item.active {
      background: var(--accent-bg, rgba(124,99,184,0.12));
      color: var(--accent-text, #7c63b8);
      font-weight: 600;
    }

    .export-content {
      flex: 1;
      min-width: 0;
    }

    /* The #content wrapper lets the app's scoped styles (#content ...) apply */
    #content {
      max-width: 820px;
      margin: 0 auto;
      padding: 48px 32px 80px;
    }

    .export-section {
      scroll-margin-top: 24px;
    }

    .export-divider {
      border: none;
      border-top: 1px solid var(--border-subtle, #e5e7eb);
      margin: 48px 0;
    }

    /* Hide app chrome that isn't relevant in the export */
    .topbar, .editor-pane, .toc-pane, .chapter-nav, .overlay, .modal { display: none !important; }

    @media (max-width: 768px) {
      .export-layout { flex-direction: column; }
      .export-sidebar {
        width: 100%;
        height: auto;
        position: relative;
        border-right: none;
        border-bottom: 1px solid var(--border-medium, #e5e7eb);
      }
      #content { padding: 24px 16px 48px; }
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

        navigator.clipboard.writeText(text).then(function() {
          if (label) label.textContent = "Copied";
          btn.classList.add("is-copied");
          setTimeout(reset, 2000);
        }).catch(function() {
          if (label) label.textContent = "Failed";
          btn.classList.add("is-copy-failed");
          setTimeout(reset, 2000);
        });

        function reset() {
          if (label) label.textContent = "Copy";
          btn.classList.remove("is-copied", "is-copy-failed");
        }
      });

      // Sidebar active state on scroll
      var sections = document.querySelectorAll(".export-section");
      var navItems = document.querySelectorAll(".export-nav-item");

      function updateActive() {
        var scrollY = window.scrollY;
        var offset = 100;
        var activeIdx = 0;
        for (var i = 0; i < sections.length; i++) {
          if (sections[i].offsetTop - offset <= scrollY) {
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

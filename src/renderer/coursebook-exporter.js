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

  return buildHtmlDocument(coursebook.title, sections, coursebook.nav);
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
  return buildHtmlDocument(title, [
    {
      id: "overview",
      title,
      html: rendered.container.innerHTML,
    },
  ]);
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
 * @returns {Promise<string>}
 */
async function buildHtmlDocument(title, sections, nav = null) {
  const theme = ThemeManager.getCurrentTheme();
  const palette = ThemeManager.getPalette();

  const sectionHtml = sections
    .map(
      (s) => `<section id="${s.id}" class="coursebook-section">\n${s.html}\n</section>`,
    )
    .join("\n");

  const appCss = await extractCssFromDocument();
  const exportCss = getExportOverridesCss();
  const css = `${appCss}\n${exportCss}`;

  const config = {
    title,
    sections: sections.map((s) => ({ id: s.id, title: s.title })),
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

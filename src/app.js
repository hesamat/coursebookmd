/**
 * app.js — Application entry point.
 * Wires together coursebook loading, theme management, icon hydration,
 * menu dropdowns, the editor, renderer, sectionNavigator, and presentation mode.
 */
import { renderMarkdown, sanitizeHtml } from "./renderer/markdown-renderer.js";
import { ContentEnhancer } from "./renderer/content-enhancer.js";
import { LinkPreview, resolvePreview, extractLinks } from "./renderer/link-preview.js";
import { SectionNavigator } from "./navigator/section-navigator.js";
import { MarkdownEditor } from "./editor/markdown-editor.js";
import { ThemeManager, PALETTES } from "./core/theme-manager.js";
import { hydrateIcons } from "./core/icon.js";
import {
  loadCollapsedGroups,
  createGroupElement,
  autoExpandGroup,
} from "./core/nav-groups.js";
import {
  computeSectionNumbers,
  computeSectionNumbersForSections,
  extractHeadingsFromMarkdown,
  applyHeadingNumber,
} from "./core/section-numbering.js";
import { slugifyForId, resolveContentRefs } from "./core/utils.js";
import { parseLocationHash, formatLocationHash } from "./core/navigation.js";
import { extractTocItems } from "./core/toc-data.js";
import { addReadingAids } from "./core/reading-aids.js";
import { rebuildIndexSection, flashIndexedTerm } from "./core/indexed-terms.js";
import { createScrollSpy } from "./core/scroll-spy.js";
import {
  loadCoursebook,
  loadChapter,
  getChapterTitle,
  parseCoursebook,
  getBaseDir,
} from "./core/coursebook-loader.js";
import { findBrokenLinks } from "./core/link-checker.js";
import {
  exportCoursebookHtml,
  exportSingleHtml,
} from "./renderer/coursebook-exporter.js";

const DEFAULT_CONTENT = `# Welcome to CoursebookMD

Write your course chapter in Markdown. Use **Present** to teach from it.

## Getting Started

- Edit the Markdown on the left (click **Edit**)
- The preview updates live on the right
- Press **Present** or \`Ctrl+Alt+P\` (\`⌘+⌃+P\` on macOS) to toggle presentation mode
- Use arrow keys to navigate between headings
- Press \`S\` while presenting (or \`Ctrl+Alt+S\` / \`⌘+⌃+S\`) to toggle spotlight dimming

## Features

| Feature | Status |
| ------- | ------ |
| Markdown rendering | Working |
| Code highlighting (Shiki) | Working |
| Math (KaTeX) | Working |
| Diagrams (D2 + SVG) | Working |
| Tables | Working |
| Live editor | Basic |
| Save / Open | Basic |
| Export HTML | Basic |
| Dark mode + palettes | Working |

### Code example

\`\`\`python
def greet(name):
    print(f"Hello, {name}!")

greet("COMP 1510")
\`\`\`

### Math example

The area of a rectangle: $A = w \\times h$

$$E = mc^2$$

### D2 diagram example

\`\`\`d2
direction: right

Write -> Review -> Publish
\`\`\`

### Custom SVG example

\`\`\`svg
<svg viewBox="0 0 560 200" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="560" height="200" rx="12" fill="#f8f9fa" stroke="#d1d5db" stroke-width="1" />
  <defs>
    <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#4b5563" />
    </marker>
  </defs>
  <rect x="30" y="65" width="130" height="60" rx="10" fill="#4a90d9" stroke="#2c5aa0" stroke-width="2" />
  <text x="95" y="100" text-anchor="middle" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="14" font-weight="500">Author</text>
  <path d="M 160 95 L 200 95" fill="none" stroke="#4b5563" stroke-width="2" marker-end="url(#arrowhead)" />
  <rect x="210" y="65" width="130" height="60" rx="10" fill="#5bb66d" stroke="#3a7d44" stroke-width="2" />
  <text x="275" y="100" text-anchor="middle" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="14" font-weight="500">Review</text>
  <path d="M 340 95 L 380 95" fill="none" stroke="#4b5563" stroke-width="2" marker-end="url(#arrowhead)" />
  <rect x="390" y="65" width="130" height="60" rx="10" fill="#e6a23c" stroke="#a36f1b" stroke-width="2" />
  <text x="455" y="100" text-anchor="middle" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="14" font-weight="500">Publish</text>
  <path d="M 455 125 C 455 175, 95 175, 95 125" fill="none" stroke="#4b5563" stroke-width="2" marker-end="url(#arrowhead)" />
  <text x="275" y="185" text-anchor="middle" fill="#374151" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="12">Iterate on feedback</text>
</svg>
\`\`\`

## Try It

1. Click **Edit** to show the editor pane.
2. Modify this text and watch the preview update.
3. Click **Present** to enter full-screen presentation mode.
4. Use arrow keys to navigate between sections.
5. Toggle dark mode with the switch in the top bar.
6. Switch palettes from **Settings** in the menu.
`;

// ---- DOM refs ----
const contentEl = document.getElementById("content");
const editorEl = document.getElementById("editor");
const editorPane = document.getElementById("editorPane");
const editorResizer = document.getElementById("editorResizer");
const toggleEditBtn = document.getElementById("toggleEditBtn");
const toggleEditLabel = document.getElementById("toggleEditLabel");
const presentBtn = document.getElementById("presentBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const toggleFullscreenBtn = document.getElementById("toggleFullscreenBtn");
const menuBtn = document.getElementById("menuBtn");
const menuDropdown = document.getElementById("menuDropdown");
const menuOpenCoursebookBtn = document.getElementById("menuOpenCoursebookBtn");
const menuOpenFileBtn = document.getElementById("menuOpenFileBtn");
const menuToggleEditBtn = document.getElementById("menuToggleEditBtn");
const menuExportHtmlBtn = document.getElementById("menuExportHtmlBtn");
const menuSettingsBtn = document.getElementById("menuSettingsBtn");
const overlayCurrent = document.getElementById("overlayCurrent");
const overlayNext = document.getElementById("overlayNext");
const overlayProgress = document.getElementById("overlayProgress");
const tocPane = document.getElementById("tocPane");
const tocToggleBtn = document.getElementById("tocToggleBtn");
const settingsModal = document.getElementById("settingsModal");
const settingsBackdrop = document.getElementById("settingsBackdrop");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const settingsThemeToggle = document.getElementById("settingsThemeToggle");
const settingsPaletteWarm = document.getElementById("settingsPaletteWarm");
const settingsPaletteIndigo = document.getElementById("settingsPaletteIndigo");
const settingsPaletteBlue = document.getElementById("settingsPaletteBlue");
const chapterListEl = document.getElementById("chapterList");
const chapterPaneTitle = document.getElementById("chapterPaneTitle");
const chapterNav = document.getElementById("chapterNav");
const prevChapterBtn = document.getElementById("prevChapterBtn");
const nextChapterBtn = document.getElementById("nextChapterBtn");
const chapterTitleEl = document.getElementById("chapterTitle");
const previewPane = document.getElementById("previewPane");
const openFolderModal = document.getElementById("openFolderModal");
const openFolderBackdrop = document.getElementById("openFolderBackdrop");
const openFolderCloseBtn = document.getElementById("openFolderCloseBtn");
const openFolderSelectBtn = document.getElementById("openFolderSelectBtn");
const openFolderMessage = document.getElementById("openFolderMessage");
const saveBtn = document.getElementById("saveBtn");
const menuSaveBtn = document.getElementById("menuSaveBtn");
const menuSaveHint = document.getElementById("menuSaveHint");

// ---- State ----
let sectionNavigator = null;
let editMode = false;
let markdownEditor = null;
let liveEditorInput = Promise.resolve();
let currentMarkdown = DEFAULT_CONTENT;

// Pre-fetched link preview map. Filled at coursebook load, updated when the
// editor changes, and used by the hover popup and HTML export.
let linkPreviews = {};

// Per-section EditorState cache so undo/redo history survives chapter
// switches. Keys are String(sectionIdx) (0 = landing page, 1..N = chapters)
// or "standalone" when no coursebook is loaded. Capped LRU: oldest entry
// (by insertion order) is evicted beyond EDITOR_STATE_CACHE_LIMIT.
const editorStates = new Map();
const EDITOR_STATE_CACHE_LIMIT = 30;
// Key of the section whose state currently lives in the editor.
let currentEditorKey = null;

// Pending coursebook from "Open File" — stored while waiting for the user
// to select the chapter folder via the modal.
let pendingCoursebook = null;

// Local file handles for saving edited markdown back to disk.
// Only populated when a coursebook is opened via the File System Access
// API (showDirectoryPicker), which grants write access. The webkitdirectory
// fallback cannot write, so save stays disabled in that case.
let localFileStore = null;

// Relative paths (as keyed in localFileStore.handles) with unsaved edits.
let dirtyPaths = new Set();

// Object URLs for locally-loaded images, so they can be revoked on re-render.
let localImageUrls = [];

/** @type {import("./core/coursebook-loader.js").Coursebook | null} */
let coursebook = null;
let currentChapterIdx = -1; // -1 means parent/landing page

// Pre-loaded chapter markdowns and per-section heading/number data.
// sectionHeadings[0] is the parent landing page, sectionHeadings[i+1] is chapter i.
let sectionMarkdowns = [];
let sectionHeadings = [];
let sectionNumbers = [];

// ---- Scroll spy ----
// The engine (suppression guard, TOC highlighting, heading selection) lives
// in core/scroll-spy.js and is shared with the export runtime. Only the
// heading selection (see setupScrollSpyForCurrentChapter below) is
// app-specific.
const scrollSpy = createScrollSpy({
  pane: previewPane,
  resizeTarget: contentEl,
  getTocContainer: getCurrentChapterToc,
  getNavigator: () => sectionNavigator,
  getDefaultLock: () => document.body.classList.contains("presenting"),
});
scrollSpy.attach();

// ---- Theme ----
ThemeManager.initTheme();

/**
 * Re-highlight code blocks when the theme changes.
 * Shiki bakes colors into inline styles, so a theme switch requires
 * re-running the highlighter with the new theme.
 */
async function onThemeChange() {
  if (contentEl) {
    await ContentEnhancer.rehighlight(contentEl);
  }
}

themeToggleBtn.addEventListener("click", async () => {
  ThemeManager.toggleTheme();
  await onThemeChange();
});

// Settings modal theme toggle (mirrors the topbar toggle)
settingsThemeToggle.addEventListener("click", async () => {
  ThemeManager.toggleTheme();
  await onThemeChange();
});

// ---- Settings modal ----
function openSettings() {
  settingsModal.classList.remove("hidden");
  updateActivePalette();
}

function closeSettings() {
  settingsModal.classList.add("hidden");
}

function updateActivePalette() {
  const current = ThemeManager.getPalette();
  for (const palette of PALETTES) {
    const btn = document.querySelector(`.settings-palette[data-palette="${palette}"]`);
    if (btn) btn.classList.toggle("active", palette === current);
  }
}

settingsBackdrop.addEventListener("click", closeSettings);
settingsCloseBtn.addEventListener("click", closeSettings);

// Open Folder modal listeners
openFolderBackdrop.addEventListener("click", closeOpenFolderModal);
openFolderCloseBtn.addEventListener("click", closeOpenFolderModal);
openFolderSelectBtn.addEventListener("click", selectCoursebookFolder);

// Palette selection in settings
const paletteButtons = [settingsPaletteWarm, settingsPaletteIndigo, settingsPaletteBlue];
for (const btn of paletteButtons) {
  if (!btn) continue;
  btn.addEventListener("click", () => {
    const palette = btn.getAttribute("data-palette");
    ThemeManager.setPalette(palette);
    updateActivePalette();
  });
}

// ---- Icon hydration ----
hydrateIcons();

// ---- Rendering pipeline ----

/**
 * Load a local file from the active store (FileSystemDirectoryHandle or
 * webkitdirectory file map) for a relative path.
 * @param {string} relPath
 * @returns {Promise<File>}
 */
async function getLocalFile(relPath) {
  if (localFileStore.dirHandle) {
    const { file } = await readFileFromDirectory(localFileStore.dirHandle, relPath);
    return file;
  }
  if (localFileStore.fileMap) {
    const file = localFileStore.fileMap.get(relPath);
    if (file) return file;
    const lowerFile = localFileStore.fileMapLower?.get(relPath.toLowerCase());
    if (lowerFile) return lowerFile;
    console.warn("File not found in selected folder:", relPath);
    throw new Error("File not found in selected folder.");
  }
  throw new Error("No local file store available");
}

/**
 * Replace local image paths with blob URLs for sections loaded from the
 * file system. Falls back to the original (pre-resolution) src if the
 * resolved path is not found, so images stored at the coursebook root can
 * still be found from chapters.
 * @param {HTMLElement} container
 */
async function resolveLocalImages(container) {
  if (!localFileStore) return;

  for (const img of container.querySelectorAll("img")) {
    const resolved = img.getAttribute("src") || "";
    const original = img.dataset.originalSrc || resolved;
    if (!resolved || resolved.startsWith("data:") || resolved.startsWith("blob:")) {
      continue;
    }
    if (
      /^https?:/.test(resolved) ||
      resolved.startsWith("//") ||
      resolved.startsWith("/")
    ) {
      continue;
    }

    const tryRead = async (relPath) => {
      const file = await getLocalFile(relPath);
      const url = URL.createObjectURL(file);
      localImageUrls.push(url);
      img.src = url;
      img.removeAttribute("data-original-src");
    };

    try {
      await tryRead(resolved);
    } catch {
      // If the original src was a bare path (not ./ or ../) and differs from
      // the resolved path, also try the original at the coursebook root.
      if (
        original !== resolved &&
        !original.startsWith("./") &&
        !original.startsWith("../") &&
        !/^https?:/.test(original) &&
        !original.startsWith("//") &&
        !original.startsWith("/") &&
        !original.startsWith("data:")
      ) {
        try {
          await tryRead(original);
        } catch {
          // leave broken image as-is
        }
      }
    }
  }
}

/**
 * Convert a File object to a base64 data URI for export.
 * @param {File} file
 * @returns {Promise<string>}
 */
async function fileToDataUri(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const type = file.type || "application/octet-stream";
  return `data:${type};base64,${globalThis.btoa(binary)}`;
}

/**
 * Load a local image asset for export, converting it to a data URI.
 * Throws if the file is not available in the active local file store.
 * @param {string} relPath
 * @returns {Promise<string>}
 */
async function resolveAsset(relPath) {
  const file = await getLocalFile(relPath);
  return fileToDataUri(file);
}

/**
 * Render the entire coursebook as a single continuous page.
 * Each chapter (and the landing page) is wrapped in a <section> with an id,
 * so scroll-spy can track which chapter is currently in view.
 */
async function renderAllChapters() {
  // Revoke object URLs from the previous render before clearing the DOM.
  localImageUrls.forEach((url) => URL.revokeObjectURL(url));
  localImageUrls = [];
  // Disconnect the ResizeObserver before clearing the content so it does not
  // hold references to the detached sections.
  scrollSpy.disconnectObserver();
  contentEl.innerHTML = "";

  // Build all sections: landing page (idx -1) + chapters (0..N-1)
  const sectionEls = [];

  // Landing page section
  const landingSection = document.createElement("section");
  landingSection.id = "overview";
  landingSection.className = "coursebook-section";
  landingSection.innerHTML = sanitizeHtml(
    renderMarkdown(sectionMarkdowns[0] ?? coursebook.markdown),
  );
  for (const img of landingSection.querySelectorAll("img")) {
    img.dataset.originalSrc = img.getAttribute("src");
  }
  resolveContentRefs(landingSection, coursebook.parentPath);
  await resolveLocalImages(landingSection);
  contentEl.appendChild(landingSection);
  sectionEls.push(landingSection);

  // Chapter sections
  for (let i = 0; i < coursebook.chapters.length; i++) {
    const sectionIdx = i + 1;
    const markdown = sectionMarkdowns[sectionIdx];

    const section = document.createElement("section");
    section.id = chapterSlug(coursebook.chapters[i].title);
    section.className = "coursebook-section";
    if (markdown) {
      section.innerHTML = sanitizeHtml(renderMarkdown(markdown));
      for (const img of section.querySelectorAll("img")) {
        img.dataset.originalSrc = img.getAttribute("src");
      }
      resolveContentRefs(section, coursebook.chapters[i].resolvedPath);
      await resolveLocalImages(section);
    } else {
      // Render a placeholder so section index stays aligned 1:1 with
      // coursebook.chapters — scroll-spy relies on this mapping.
      section.innerHTML = sanitizeHtml(
        renderMarkdown(`## Chapter unavailable\n\nThe chapter file could not be loaded.`),
      );
    }
    contentEl.appendChild(section);
    sectionEls.push(section);
  }

  // Apply continuous section numbers across all headings.
  // Use computeSectionNumbersForSections so the landing page (section 0)
  // is left unnumbered and chapter 1 starts at "1". skipFirst ensures the
  // landing page is never numbered even with zero chapters.
  const sectionHeadingArrays = sectionEls.map((s) =>
    Array.from(s.querySelectorAll("h1, h2, h3")),
  );
  const numbersBySection = computeSectionNumbersForSections(sectionHeadingArrays, {
    skipFirst: true,
  });

  // Track used IDs to avoid duplicates across chapters.
  // Section IDs (overview, chapter slugs) must be reserved first so a
  // heading with the same text as a chapter title doesn't collide.
  const usedIds = new Set();
  for (const section of sectionEls) {
    if (section.id) usedIds.add(section.id);
  }
  for (let s = 0; s < sectionEls.length; s++) {
    const headings = sectionHeadingArrays[s];
    const numbers = numbersBySection[s];
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      // Ensure unique ID across all chapters
      if (!heading.id || usedIds.has(heading.id)) {
        const baseId = heading.id || slugifyForId(heading.textContent);
        let uniqueId = baseId;
        let suffix = 1;
        while (usedIds.has(uniqueId)) {
          uniqueId = `${baseId}-${suffix++}`;
        }
        heading.id = uniqueId;
      }
      usedIds.add(heading.id);
      applyHeadingNumber(heading, numbers[i]);
    }
  }

  // Rewrite parent chapter list .md links to in-app hash navigation
  rewriteChapterLinks();

  // Build TOCs for all chapters
  buildAllTOCs();

  // In-content reading aids (per-H2 go-up links). Runs after numbering/ids
  // after numbering/ids are final and before ContentEnhancer, so the aids
  // are plain DOM and never enhanced.
  for (const section of sectionEls) {
    addReadingAids(section);
  }

  // General index of ==term== occurrences. Appended last, after numbering
  // and id assignment, so it is excluded from section-number arithmetic.
  // Only coursebook mode: a standalone document gets no index section.
  if (coursebook) {
    rebuildIndexSection(contentEl);
    syncIndexNavItem();
  }

  // Re-observe the content area now that the new sections are in the DOM.
  scrollSpy.reobserve();

  // Enhance content (Shiki, KaTeX, copy buttons, D2/SVG diagrams)
  await ContentEnhancer.enhance(contentEl);

  // Set up sectionNavigator for presentation mode
  sectionNavigator = new SectionNavigator(contentEl, previewPane, {
    scrollToEl: (el, { instant }) =>
      instant ? scrollSpy.scrollToInstant(el) : scrollSpy.scrollToSmooth(el),
  });
  sectionNavigator.onNavigate = updateOverlay;
  sectionNavigator.setup();
  setupScrollSpyForCurrentChapter();
}

/**
 * Render a single markdown document (standalone mode, no coursebook).
 */
async function renderSingleMarkdown(markdown) {
  currentMarkdown = markdown;
  contentEl.innerHTML = sanitizeHtml(renderMarkdown(markdown));

  const headings = Array.from(contentEl.querySelectorAll("h1, h2, h3"));
  const numbers = computeSectionNumbers(headings);
  for (let i = 0; i < headings.length; i++) {
    if (!headings[i].id) {
      headings[i].id = slugifyForId(headings[i].textContent);
    }
    applyHeadingNumber(headings[i], numbers[i]);
  }

  // Clear all chapter TOCs in standalone mode
  if (chapterListEl) chapterListEl.innerHTML = "";

  await ContentEnhancer.enhance(contentEl);

  sectionNavigator = new SectionNavigator(contentEl, previewPane, {
    scrollToEl: (el, { instant }) =>
      instant ? scrollSpy.scrollToInstant(el) : scrollSpy.scrollToSmooth(el),
  });
  sectionNavigator.onNavigate = updateOverlay;
  sectionNavigator.setup();
  setupScrollSpyForCurrentChapter();

  previewPane.scrollTop = 0;
}

function updateOverlay(idx, heading) {
  if (!sectionNavigator || !coursebook) return;
  const current = heading?.textContent?.trim() || sectionNavigator.currentText;
  const next = sectionNavigator.nextText;
  const nextChapterTitle =
    currentChapterIdx === coursebook.chapters.length - 1
      ? null
      : currentChapterIdx === -1
        ? coursebook.chapters[0]?.title
        : coursebook.chapters[currentChapterIdx + 1]?.title;
  if (next) {
    overlayNext.textContent = "Next: " + next;
  } else if (nextChapterTitle) {
    overlayNext.textContent = "Next chapter: " + nextChapterTitle;
  } else {
    overlayNext.textContent = "End of coursebook";
  }
  overlayCurrent.textContent = current;
  overlayProgress.textContent = idx + 1 + " / " + sectionNavigator.count;
}

// ---- Coursebook loading ----
async function initCoursebook() {
  const params = new URLSearchParams(location.search);
  const requestedCoursebook = params.get("coursebook") || guessCoursebookPath();

  // URL-loaded coursebooks have no write access — never inherit a stale
  // store from a previously opened local coursebook.
  localFileStore = null;
  dirtyPaths = new Set();
  // A new coursebook is a new editing session: cached editor states from a
  // previous coursebook would have stale documents/history.
  clearEditorStates();

  try {
    coursebook = await loadCoursebookFrom(requestedCoursebook);
    chapterPaneTitle.textContent = coursebook.title;
    chapterTitleEl.textContent = coursebook.title;

    // Seed the link preview cache from any previously built previews.json.
    linkPreviews = await loadPreviewsForCoursebook(coursebook.parentPath);
    LinkPreview.setPreviews(linkPreviews);
    void preloadMissingLinkPreviews(coursebook);

    // Pre-load all chapter heading data so section numbering is
    // continuous across the whole coursebook.
    await preloadSectionHeadings();

    buildChapterList();
    // Render all chapters as a continuous page
    await renderAllChapters();

    updateSaveState();
    await reportLinkIssues();

    // If the URL has a hash, navigate to that section; otherwise start at top
    if (location.hash) {
      await navigateFromHash();
    } else {
      currentChapterIdx = -1;
      updateActiveChapter();
      updateChapterNav();
      updateVisibleSection();
      if (sectionNavigator) {
        sectionNavigator.setup();
        setupScrollSpyForCurrentChapter();
        updateOverlay(0);
      }
      previewPane.scrollTop = 0;
    }
  } catch (e) {
    // No coursebook.md found — fall back to standalone mode
    console.warn("Coursebook not loaded, using standalone mode:", e.message);
    coursebook = null;
    clearEditorStates();
    sectionMarkdowns = [];
    sectionHeadings = [];
    sectionNumbers = [];
    chapterListEl.innerHTML = "";
    chapterPaneTitle.textContent = "Chapters";
    chapterTitleEl.textContent = "CoursebookMD";
    chapterNav.classList.add("hidden");
    // Clear any stale chapter hash from a previously loaded coursebook
    if (location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    linkPreviews = {};
    LinkPreview.setPreviews(linkPreviews);
    await renderSingleMarkdown(DEFAULT_CONTENT);
  }

  LinkPreview.enhance(contentEl);
}

/**
 * Resolve the coursebook path from the URL, falling back through:
 * 1. ?coursebook=<path>
 * 2. /coursebook.md (when the app is served from a coursebook folder)
 * 3. docs/coursebook.md (default project layout)
 */
function guessCoursebookPath() {
  const { pathname } = location;
  if (pathname.endsWith(".md")) {
    if (pathname.endsWith("/coursebook.md")) {
      return pathname;
    }
    if (pathname.includes("/chapters/")) {
      const parent = pathname.replace(/\/chapters\/[^/]+$/, "/coursebook.md");
      if (parent) return parent;
    }
    return pathname;
  }
  return "docs/coursebook.md";
}

/**
 * Load a coursebook, with the default fallback chain.
 * @param {string} path
 * @returns {Promise<import("./core/coursebook-loader.js").Coursebook>}
 */
async function loadCoursebookFrom(path) {
  try {
    return await loadCoursebook(path);
  } catch (e) {
    if (path === "docs/coursebook.md") {
      return loadCoursebook("coursebook.md");
    }
    throw e;
  }
}

async function preloadSectionHeadings() {
  if (!coursebook) return;

  // Parent landing page is section 0
  sectionMarkdowns = [coursebook.markdown];
  sectionHeadings = [extractHeadingsFromMarkdown(coursebook.markdown)];

  // Chapters are sections 1..N. Use allSettled so a single missing chapter
  // does not prevent the whole coursebook from loading.
  // If chapter.markdown is pre-loaded (e.g. from a local directory), use it
  // directly instead of fetching.
  const results = await Promise.allSettled(
    coursebook.chapters.map((chapter) =>
      chapter.markdown !== undefined
        ? Promise.resolve(chapter.markdown)
        : loadChapter(chapter.resolvedPath),
    ),
  );
  for (const result of results) {
    if (result.status === "fulfilled") {
      sectionMarkdowns.push(result.value);
      sectionHeadings.push(extractHeadingsFromMarkdown(result.value));
    } else {
      sectionMarkdowns.push(null);
      sectionHeadings.push([]);
    }
  }

  sectionNumbers = computeSectionNumbersForSections(sectionHeadings, {
    skipFirst: true,
  });
}

function buildChapterList() {
  if (!coursebook || !chapterListEl) return;
  chapterListEl.innerHTML = "";

  const collapsedGroups = loadCollapsedGroups();

  // Add a "home" item for the landing page (with a nested TOC container)
  const homeWrapper = document.createElement("div");
  homeWrapper.className = "chapter-item-wrapper";
  homeWrapper.dataset.chapterIdx = "-1";

  const homeItem = document.createElement("button");
  homeItem.type = "button";
  homeItem.className = "chapter-item";
  const homeText = document.createElement("span");
  homeText.className = "chapter-item__text";
  homeText.textContent = "Course Overview";
  homeItem.appendChild(homeText);
  homeItem.addEventListener("click", () => showLandingPage());
  homeWrapper.appendChild(homeItem);

  const homeToc = document.createElement("nav");
  homeToc.className = "chapter-toc";
  homeWrapper.appendChild(homeToc);

  chapterListEl.appendChild(homeWrapper);

  // Render the navigation structure: unnumbered group labels (e.g. weeks)
  // followed by their chapters. Falls back to all chapters in order.
  const navEntries = coursebook.nav?.length
    ? coursebook.nav
    : coursebook.chapters.map((_, idx) => ({ type: "chapter", index: idx }));

  let currentGroup = null;
  let groupIdx = 0;
  for (const entry of navEntries) {
    if (entry.type === "group") {
      const groupKey = `${slugifyForId(entry.title)}-${groupIdx}`;
      groupIdx++;
      const group = createGroupElement(entry.title, collapsedGroups, groupKey);
      chapterListEl.appendChild(group);
      currentGroup = group;
      continue;
    }

    const idx = entry.index;
    const chapter = coursebook.chapters[idx];
    if (!chapter) continue;

    const wrapper = document.createElement("div");
    wrapper.className = "chapter-item-wrapper";
    wrapper.dataset.chapterIdx = String(idx);

    const item = document.createElement("button");
    item.type = "button";
    item.className = "chapter-item";

    const numSpan = document.createElement("span");
    numSpan.className = "chapter-item__number";
    numSpan.textContent = String(idx + 1);
    item.appendChild(numSpan);

    const textSpan = document.createElement("span");
    textSpan.className = "chapter-item__text";
    textSpan.textContent = chapter.title;
    item.appendChild(textSpan);

    item.addEventListener("click", () => loadChapterByIdx(idx));
    wrapper.appendChild(item);

    const toc = document.createElement("nav");
    toc.className = "chapter-toc";
    wrapper.appendChild(toc);

    if (currentGroup) {
      currentGroup.appendChild(wrapper);
    } else {
      chapterListEl.appendChild(wrapper);
    }
  }
}

/**
 * Keep the sidebar's Index entry in sync with the generated index section:
 * shown only when the coursebook actually contains indexed terms. Runs
 * after rebuildIndexSection (inside renderAllChapters), so the DOM truth
 * about term anchors exists — buildChapterList runs before rendering and
 * cannot know.
 */
function syncIndexNavItem() {
  chapterListEl.querySelector(".index-nav-item")?.remove();
  const indexSection = contentEl.querySelector("#index");
  if (!indexSection || !indexSection.querySelector(".idx-link")) return;

  const indexItem = document.createElement("button");
  indexItem.type = "button";
  indexItem.className = "chapter-item index-nav-item";
  const indexText = document.createElement("span");
  indexText.className = "chapter-item__text";
  indexText.textContent = "Index";
  indexItem.appendChild(indexText);
  indexItem.addEventListener("click", () => showIndexPage());
  chapterListEl.appendChild(indexItem);
}

function updateActiveChapter() {
  const wrappers = chapterListEl.querySelectorAll(".chapter-item-wrapper");
  wrappers.forEach((wrapper) => {
    const idx = parseInt(wrapper.dataset.chapterIdx, 10);
    const isActive = idx === currentChapterIdx;
    const item = wrapper.querySelector(".chapter-item");
    const toc = wrapper.querySelector(".chapter-toc");
    if (item) item.classList.toggle("active", isActive);
    if (toc) toc.classList.toggle("is-open", isActive);
  });
}

/**
 * Show only the current chapter/landing section and hide the others.
 */
function updateVisibleSection() {
  const sections = Array.from(contentEl.querySelectorAll(".coursebook-section"));
  const activeId =
    currentChapterIdx === -1
      ? "overview"
      : chapterSlug(coursebook.chapters[currentChapterIdx].title);
  for (const section of sections) {
    section.classList.toggle("active", section.id === activeId);
  }
}

/**
 * Scroll to the landing page section.
 */
async function showLandingPage({ skipHash = false } = {}) {
  if (!coursebook) return;
  if (editMode) await flushCurrentEditorChanges();
  currentChapterIdx = -1;
  chapterTitleEl.textContent = coursebook.title;
  updateActiveChapter();
  updateChapterNav();
  updateVisibleSection();
  if (sectionNavigator) {
    sectionNavigator.setup();
    setupScrollSpyForCurrentChapter();
    updateOverlay(0);
  }
  syncEditorWithCurrent();
  if (!skipHash) updateLocationHash();

  const section = contentEl.querySelector("#overview");
  if (section) scrollSpy.scrollToInstant(section);
}

/**
 * Show the generated general-index section. The index lives outside the
 * chapter list, so chapter state (currentChapterIdx, sidebar highlight)
 * is left untouched; chapter navigation deactivates it again via
 * updateVisibleSection.
 */
function showIndexPage({ skipHash = false } = {}) {
  if (!coursebook) return;
  for (const section of contentEl.querySelectorAll(".coursebook-section")) {
    section.classList.toggle("active", section.id === "index");
  }
  updateActiveChapter();
  if (!skipHash) history.replaceState(null, "", "#index");

  const section = contentEl.querySelector("#index");
  if (section) scrollSpy.scrollToInstant(section);
}

/**
 * Scroll to a chapter section by index.
 */
async function loadChapterByIdx(idx, { skipHash = false } = {}) {
  if (!coursebook || idx < 0 || idx >= coursebook.chapters.length) return;
  if (editMode) await flushCurrentEditorChanges();

  currentChapterIdx = idx;
  const chapter = coursebook.chapters[idx];
  const title = getChapterTitle(sectionMarkdowns[idx + 1], chapter.title);
  chapterTitleEl.textContent = `${coursebook.title} — ${title}`;
  updateActiveChapter();
  updateChapterNav();
  updateVisibleSection();
  if (sectionNavigator) {
    sectionNavigator.setup();
    setupScrollSpyForCurrentChapter();
    updateOverlay(0);
  }
  if (!skipHash) updateLocationHash();

  syncEditorWithCurrent();

  const activeWrapper = chapterListEl.querySelector(
    `.chapter-item-wrapper[data-chapter-idx="${idx}"]`,
  );
  autoExpandGroup(activeWrapper);

  const sectionId = chapterSlug(chapter.title);
  const section = contentEl.querySelector(`#${CSS.escape(sectionId)}`);
  if (section) scrollSpy.scrollToInstant(section);
}

/**
 * Get a URL-safe slug for a chapter title.
 * @param {string} title
 * @returns {string}
 */
function chapterSlug(title) {
  return slugifyForId(title);
}

/**
 * Rewrite in-content .md chapter links to #chapter-slug hash links so
 * clicking a chapter in the parent page navigates within the app instead of
 * opening the raw .md file in a new tab.
 */
function rewriteChapterLinks() {
  if (!coursebook) return;

  const pathToSlug = new Map();
  for (const chapter of coursebook.chapters) {
    const slug = chapterSlug(chapter.title);
    pathToSlug.set(chapter.path, slug);
    if (chapter.resolvedPath && chapter.resolvedPath !== chapter.path) {
      pathToSlug.set(chapter.resolvedPath, slug);
    }
  }

  for (const link of contentEl.querySelectorAll("a[href]")) {
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
 * Get the chapter slug for the current chapter (or "overview").
 * @returns {string}
 */
function currentChapterSlug() {
  if (currentChapterIdx === -1) return "overview";
  return chapterSlug(coursebook.chapters[currentChapterIdx].title);
}

/**
 * Find the chapter index that matches a slug.
 * @param {string} slug
 * @returns {number} chapter index (0-based), or -1 for overview, or -2 if not found
 */
function findChapterIdxBySlug(slug) {
  if (slug === "overview") return -1;
  for (let i = 0; i < coursebook.chapters.length; i++) {
    if (chapterSlug(coursebook.chapters[i].title) === slug) return i;
  }
  return -2;
}

/**
 * Update the URL hash to reflect the current chapter (and optionally a heading).
 * Uses the shared formatLocationHash for the unified hash format.
 *
 * @param {string} [headingSlug] - Optional heading slug to append after /
 */
function updateLocationHash(headingSlug) {
  const hash = formatLocationHash(currentChapterSlug(), headingSlug);
  if (location.hash !== hash) {
    history.replaceState(null, "", hash);
  }
}

/**
 * Parse the current URL hash and navigate to the matching chapter + heading.
 * Uses the shared parseLocationHash for the unified hash format.
 */
async function navigateFromHash() {
  if (!coursebook) return;
  if (editMode) await flushCurrentEditorChanges();
  const { chapterSlug, headingSlug } = parseLocationHash(location.hash.slice(1));
  if (!chapterSlug) return;
  if (chapterSlug === "index") {
    updateChapterNav();
    showIndexPage();
    return;
  }

  const idx = findChapterIdxBySlug(chapterSlug);
  if (idx === -2) {
    // Unknown chapter (e.g. stale hash after HMR) — fall back to overview
    history.replaceState(null, "", location.pathname + location.search);
    currentChapterIdx = -1;
    chapterTitleEl.textContent = coursebook.title;
    updateActiveChapter();
    updateChapterNav();
    updateVisibleSection();
    if (sectionNavigator) {
      sectionNavigator.setup();
      setupScrollSpyForCurrentChapter();
      updateOverlay(0);
    }
    syncEditorWithCurrent();
    const overview = contentEl.querySelector("#overview");
    if (overview) scrollSpy.scrollToInstant(overview);
    return;
  }

  // Update current chapter state
  currentChapterIdx = idx;
  if (idx === -1) {
    chapterTitleEl.textContent = coursebook.title;
  } else {
    const title = getChapterTitle(
      sectionMarkdowns[idx + 1],
      coursebook.chapters[idx].title,
    );
    chapterTitleEl.textContent = `${coursebook.title} — ${title}`;
  }
  updateActiveChapter();
  updateChapterNav();
  updateVisibleSection();
  if (sectionNavigator) {
    sectionNavigator.setup();
    setupScrollSpyForCurrentChapter();
    updateOverlay(0);
  }
  syncEditorWithCurrent();

  if (currentChapterIdx >= 0) {
    const activeWrapper = chapterListEl.querySelector(
      `.chapter-item-wrapper[data-chapter-idx="${currentChapterIdx}"]`,
    );
    autoExpandGroup(activeWrapper);
  }

  // Find the target element and navigate to it
  const section = contentEl.querySelector(`#${CSS.escape(chapterSlug)}`);
  if (!section) return;

  if (headingSlug) {
    const target = section.querySelector(`#${CSS.escape(headingSlug)}`);
    if (target) {
      // Smooth scroll for heading-level navigation (within a chapter)
      scrollSpy.scrollToSmooth(target);
      if (target.classList.contains("idx")) flashIndexedTerm(target, previewPane);
      const hash = formatLocationHash(chapterSlug, headingSlug);
      if (location.hash !== hash) history.replaceState(null, "", hash);
    }
  } else {
    // Instant scroll for chapter-level navigation
    scrollSpy.scrollToInstant(section);
  }
}

window.addEventListener("hashchange", () => navigateFromHash());

function updateChapterNav() {
  if (!coursebook || coursebook.chapters.length === 0) {
    chapterNav.classList.add("hidden");
    return;
  }
  chapterNav.classList.remove("hidden");

  const hasPrev = currentChapterIdx >= 0;
  const hasNext =
    currentChapterIdx >= -1 && currentChapterIdx < coursebook.chapters.length - 1;

  prevChapterBtn.disabled = !hasPrev;
  nextChapterBtn.disabled = !hasNext;

  // Update tooltips only — the visible label is always a short
  // "← Previous" / "Next →" so it doesn't compete with the chapter content.
  if (hasPrev) {
    const prevIdx = currentChapterIdx - 1;
    const prevLabel = prevIdx >= 0 ? coursebook.chapters[prevIdx].title : "Overview";
    prevChapterBtn.title = `Previous: ${prevLabel}`;
    prevChapterBtn.setAttribute("aria-label", `Previous chapter: ${prevLabel}`);
  } else {
    prevChapterBtn.title = "No previous chapter";
    prevChapterBtn.setAttribute("aria-label", "No previous chapter");
  }

  if (hasNext) {
    const nextIdx = currentChapterIdx + 1;
    const nextLabel = coursebook.chapters[nextIdx].title;
    nextChapterBtn.title = `Next: ${nextLabel}`;
    nextChapterBtn.setAttribute("aria-label", `Next chapter: ${nextLabel}`);
  } else {
    nextChapterBtn.title = "No next chapter";
    nextChapterBtn.setAttribute("aria-label", "No next chapter");
  }
}

function goPrevChapter() {
  if (currentChapterIdx > 0) {
    loadChapterByIdx(currentChapterIdx - 1);
  } else if (currentChapterIdx === 0) {
    showLandingPage();
  }
}

function goNextChapter() {
  if (currentChapterIdx === -1) {
    loadChapterByIdx(0);
  } else if (currentChapterIdx < coursebook.chapters.length - 1) {
    loadChapterByIdx(currentChapterIdx + 1);
  }
}

prevChapterBtn.addEventListener("click", goPrevChapter);
nextChapterBtn.addEventListener("click", goNextChapter);

// ---- Table of Contents ----

/**
 * Build TOC items for all chapters at once. Each chapter's TOC is populated
 * from the headings inside its <section> element.
 */
function buildAllTOCs() {
  if (!coursebook || !chapterListEl) return;

  // Landing page TOC (idx -1)
  buildChapterToc(-1, "overview");

  // Chapter TOCs
  for (let i = 0; i < coursebook.chapters.length; i++) {
    buildChapterToc(i, chapterSlug(coursebook.chapters[i].title));
  }
}

/**
 * Build the TOC for a single chapter by scanning headings in its section.
 * Uses the shared extractTocItems for heading data extraction.
 * @param {number} chapterIdx - Chapter index (-1 for overview)
 * @param {string} sectionId - The section element's id
 */
function buildChapterToc(chapterIdx, sectionId) {
  const wrapper = chapterListEl.querySelector(
    `.chapter-item-wrapper[data-chapter-idx="${chapterIdx}"]`,
  );
  if (!wrapper) return;
  const tocContainer = wrapper.querySelector(".chapter-toc");
  if (!tocContainer) return;
  tocContainer.innerHTML = "";

  const section = contentEl.querySelector(`#${CSS.escape(sectionId)}`);
  if (!section) return;

  const tocItems = extractTocItems(section);
  for (let itemIdx = 0; itemIdx < tocItems.length; itemIdx++) {
    const item = tocItems[itemIdx];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `toc-item toc-item--${item.level}`;
    btn.setAttribute("data-target", item.id);

    if (item.number) {
      const tocNumSpan = document.createElement("span");
      tocNumSpan.className = "toc-number";
      tocNumSpan.textContent = item.number;
      btn.appendChild(tocNumSpan);
      btn.appendChild(document.createTextNode(" " + item.text));
    } else {
      btn.textContent = item.text;
    }

    const headingEl = section.querySelector(`#${CSS.escape(item.id)}`);
    btn.addEventListener("click", () => {
      if (headingEl) {
        // Highlight immediately for instant feedback. The scroll-spy stays
        // consistent with this choice: the scroll below settles the heading
        // above the activation line, so a re-computation picks the same
        // item — no lock needed.
        const items = tocContainer.querySelectorAll(".toc-item");
        items.forEach((el, i) => el.classList.toggle("active", i === itemIdx));
        scrollSpy.scrollToSmooth(headingEl);
        const hash = formatLocationHash(sectionId, item.id);
        if (location.hash !== hash) history.replaceState(null, "", hash);
      }
    });
    tocContainer.appendChild(btn);
  }
}

/**
 * Get the TOC container for the currently active chapter.
 * @returns {HTMLElement | null}
 */
function getCurrentChapterToc() {
  if (!chapterListEl) return null;
  const selector = `.chapter-item-wrapper[data-chapter-idx="${currentChapterIdx}"] .chapter-toc`;
  return chapterListEl.querySelector(selector);
}

// ---- TOC collapse ----
tocToggleBtn.addEventListener("click", () => {
  tocPane.classList.toggle("collapsed");
  const collapsed = tocPane.classList.contains("collapsed");
  tocToggleBtn.setAttribute(
    "aria-label",
    collapsed ? "Expand contents" : "Collapse contents",
  );
  tocToggleBtn.setAttribute("title", collapsed ? "Expand" : "Collapse");
});

/**
 * Set up the scroll spy for the currently active chapter section.
 * Called after chapter switches, initial render, and content edits.
 * Standalone mode tracks every h2/h3 in the content; coursebook mode tracks
 * the active section's h2/h3.
 */
function setupScrollSpyForCurrentChapter() {
  if (!coursebook) {
    // Standalone mode — track all headings in the content
    scrollSpy.setHeadings(Array.from(contentEl.querySelectorAll("h2, h3")));
    return;
  }
  const sections = Array.from(contentEl.querySelectorAll(".coursebook-section"));
  const activeSection = sections[currentChapterIdx + 1] ?? sections[0];
  if (activeSection) {
    scrollSpy.setHeadings(Array.from(activeSection.querySelectorAll("h2, h3")));
  }
}

// ---- Editor ----
function stashEditorState() {
  if (!markdownEditor || !currentEditorKey) return;
  const state = markdownEditor.getState();
  if (!state) return;
  editorStates.set(currentEditorKey, state);
  if (editorStates.size > EDITOR_STATE_CACHE_LIMIT) {
    const oldest = editorStates.keys().next().value;
    if (oldest !== undefined) editorStates.delete(oldest);
  }
}

function clearEditorStates() {
  editorStates.clear();
  currentEditorKey = null;
}

function syncEditorWithCurrent() {
  if (!editMode || !markdownEditor) return;
  const sectionIdx = currentChapterIdx + 1;
  const markdown =
    coursebook && sectionMarkdowns[sectionIdx] !== undefined
      ? sectionMarkdowns[sectionIdx]
      : currentMarkdown;
  const key = coursebook ? String(sectionIdx) : "standalone";
  if (key === currentEditorKey) return;

  stashEditorState();

  // Only reuse a cached state whose document matches the expected markdown;
  // otherwise the source has changed outside the editor and history must go.
  const cached = editorStates.get(key);
  editorStates.delete(key);
  if (cached && cached.doc.toString() === markdown) {
    markdownEditor.setState(cached);
  } else {
    markdownEditor.setValue(markdown, { suppressOnChange: true });
  }
  currentEditorKey = key;
}

function flushCurrentEditorChanges() {
  if (!markdownEditor) return Promise.resolve();
  markdownEditor.cancelOnChange();
  return onEditorInput(markdownEditor.getValue());
}

async function setEditMode(on) {
  if (!on && editMode) {
    await flushCurrentEditorChanges();
  }

  editMode = on;
  editorPane.classList.toggle("hidden", !on);
  toggleEditLabel.textContent = on ? "Preview" : "Edit";
  if (on) {
    if (!markdownEditor) {
      markdownEditor = new MarkdownEditor(editorEl, {
        onChange: (value) => onEditorInput(value),
        debounceDelay: 300,
      });
      currentEditorKey = null;
    }
    syncEditorWithCurrent();
    markdownEditor.focus();
  }
}

async function onEditorInput(markdown) {
  const thisOp = (async () => {
    await liveEditorInput;

    const sectionIdx = currentChapterIdx + 1;
    if (coursebook && sectionMarkdowns[sectionIdx] !== undefined) {
      if (sectionMarkdowns[sectionIdx] === markdown) return;
      sectionMarkdowns[sectionIdx] = markdown;
      markCurrentDirty();
      // Keep the coursebook object's markdown in sync so exports and saves
      // use the latest edits.
      if (currentChapterIdx === -1) {
        coursebook.markdown = markdown;
      } else {
        const chapter = coursebook.chapters[currentChapterIdx];
        if (chapter) chapter.markdown = markdown;
      }
      sectionHeadings[sectionIdx] = extractHeadingsFromMarkdown(markdown);
      sectionNumbers = computeSectionNumbersForSections(sectionHeadings, {
        skipFirst: true,
      });

      // Re-render just the current section in-place
      const sectionId =
        currentChapterIdx === -1
          ? "overview"
          : chapterSlug(coursebook.chapters[currentChapterIdx].title);
      const section = contentEl.querySelector(`#${CSS.escape(sectionId)}`);
      if (section) {
        // Revoke any blob URLs this section currently owns before replacing
        // its DOM, so per-section re-renders don't leak object URLs.
        for (const img of section.querySelectorAll("img")) {
          const src = img.getAttribute("src") || "";
          if (src.startsWith("blob:")) {
            URL.revokeObjectURL(src);
            localImageUrls = localImageUrls.filter((url) => url !== src);
          }
        }

        const scrollTop = previewPane.scrollTop;
        section.innerHTML = sanitizeHtml(renderMarkdown(markdown));

        // Preserve the original src so resolveLocalImages can fall back to the
        // coursebook root if the resolved path is not found.
        for (const img of section.querySelectorAll("img")) {
          img.dataset.originalSrc = img.getAttribute("src");
        }

        if (currentChapterIdx >= 0) {
          resolveContentRefs(
            section,
            coursebook.chapters[currentChapterIdx].resolvedPath,
          );
        } else {
          resolveContentRefs(section, coursebook.parentPath);
        }

        await resolveLocalImages(section);

        // Re-apply section numbers and unique IDs across ALL sections.
        // Adding/removing a heading in one chapter shifts every later
        // chapter's numbers, so we must update them all. The generated
        // index section is excluded: it holds an unnumbered heading and
        // would otherwise desync sectionNumbers indices.
        const allSections = Array.from(
          contentEl.querySelectorAll(".coursebook-section"),
        ).filter((s) => !s.classList.contains("index-section"));
        const usedIds = new Set();
        for (const s of allSections) {
          if (s.id) usedIds.add(s.id);
        }
        for (let sIdx = 0; sIdx < allSections.length; sIdx++) {
          const s = allSections[sIdx];
          const headings = Array.from(s.querySelectorAll("h1, h2, h3"));
          const numbers = sectionNumbers[sIdx] ?? computeSectionNumbers(headings);
          for (let i = 0; i < headings.length; i++) {
            if (!headings[i].id || usedIds.has(headings[i].id)) {
              const baseId = headings[i].id || slugifyForId(headings[i].textContent);
              let uniqueId = baseId;
              let suffix = 1;
              while (usedIds.has(uniqueId)) {
                uniqueId = `${baseId}-${suffix++}`;
              }
              headings[i].id = uniqueId;
            }
            usedIds.add(headings[i].id);
            applyHeadingNumber(headings[i], numbers[i]);
          }
        }

        // Rebuild ALL chapter TOCs since numbers may have shifted.
        buildAllTOCs();

        // Rebuild reading aids in every section: an edit shifts numbers and
        // ids in later chapters too, and the edited section's DOM was
        // rebuilt from scratch (re-adding links elsewhere is a no-op).
        for (const s of contentEl.querySelectorAll(".coursebook-section")) {
          addReadingAids(s);
        }

        // Rebuild the general index: the edited section's terms and anchor
        // ids may have changed, and term anchors in other chapters must
        // keep pointing at first occurrences.
        rebuildIndexSection(contentEl);

        // Re-enhance the updated section only (other sections are unchanged)
        await ContentEnhancer.enhance(section);
        previewPane.scrollTop = scrollTop;

        // Re-setup scroll spy for the new heading elements
        setupScrollSpyForCurrentChapter();
      }
    } else {
      // Standalone mode
      if (currentMarkdown === markdown) return;
      const scrollTop = previewPane.scrollTop;
      currentMarkdown = markdown;
      await renderSingleMarkdown(markdown);
      previewPane.scrollTop = scrollTop;
    }
  })();

  liveEditorInput = thisOp.catch((e) => console.warn("Editor re-render failed:", e));
  return liveEditorInput;
}

toggleEditBtn.addEventListener("click", async () => setEditMode(!editMode));
menuToggleEditBtn.addEventListener("click", async () => {
  await setEditMode(!editMode);
  closeMenu();
});

// ---- Editor pane resize ----
function setupEditorResizer() {
  if (!editorResizer || !editorPane) return;

  editorResizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    editorResizer.classList.add("is-resizing");

    const startX = e.clientX;
    const startWidth = editorPane.getBoundingClientRect().width;
    const maxWidth = window.innerWidth * 0.6;

    function onMove(moveEvent) {
      let newWidth = startWidth + (moveEvent.clientX - startX);
      newWidth = Math.max(280, Math.min(maxWidth, newWidth));
      editorPane.style.width = `${newWidth}px`;
    }

    function onUp() {
      editorResizer.classList.remove("is-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      localStorage.setItem("editorPaneWidth", editorPane.style.width);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

setupEditorResizer();

const savedEditorWidth = localStorage.getItem("editorPaneWidth");
if (savedEditorWidth) {
  editorPane.style.width = savedEditorWidth;
}

// ---- Menu dropdown ----
function toggleMenu() {
  const isHidden = menuDropdown.classList.contains("hidden");
  closeMenu();
  if (isHidden) {
    menuDropdown.classList.remove("hidden");
    menuBtn.setAttribute("aria-expanded", "true");
  }
}

function closeMenu() {
  menuDropdown.classList.add("hidden");
  menuBtn.setAttribute("aria-expanded", "false");
}

menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMenu();
});

document.addEventListener("click", (e) => {
  if (!menuDropdown.classList.contains("hidden")) {
    if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
      closeMenu();
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!settingsModal.classList.contains("hidden")) {
      closeSettings();
    } else if (!menuDropdown.classList.contains("hidden")) {
      closeMenu();
    }
  }
});

// ---- Presentation mode ----
function enterPresent() {
  document.body.classList.add("presenting");
  if (sectionNavigator?.spotlight) document.body.classList.add("spotlight");

  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }

  // The double requestAnimationFrame waits for the visual mode change to
  // apply (CSS display:none on the app chrome) before scrolling, so the
  // scroll position is computed against the final layout.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      previewPane.scrollTo({ top: 0, behavior: "auto" });
      sectionNavigator?.setup();
      setupScrollSpyForCurrentChapter();
      updateOverlay(sectionNavigator?.currentIdx, sectionNavigator?.current);
    });
  });
}

function exitPresent() {
  document.body.classList.remove("presenting", "spotlight");
  sectionNavigator?.clearHighlight();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

presentBtn.addEventListener("click", enterPresent);
toggleFullscreenBtn.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});

function isMac() {
  const nav = navigator;
  if (nav.userAgentData?.platform) {
    return /mac/i.test(nav.userAgentData.platform);
  }
  if (typeof nav.platform === "string" && /mac/i.test(nav.platform)) {
    return true;
  }
  return /macintosh|mac os x|macos/i.test(nav.userAgent);
}

const isMacPlatform = isMac();

function updateShortcutTooltips() {
  const mod = isMacPlatform ? "⌘+⌃" : "Ctrl+Alt";
  if (presentBtn) presentBtn.title = `Present (${mod}+P)`;
  if (toggleEditBtn) toggleEditBtn.title = `Toggle Editor (${mod}+E)`;
  if (themeToggleBtn) themeToggleBtn.title = `Toggle Dark Mode (${mod}+I)`;
  if (settingsThemeToggle) settingsThemeToggle.title = `Toggle Dark Mode (${mod}+I)`;
  const menuEditHint = document.getElementById("menuEditHint");
  if (menuEditHint) menuEditHint.textContent = `${mod}+E`;
  if (menuSaveHint) menuSaveHint.textContent = isMacPlatform ? "⌘+S" : "Ctrl+S";
}

// Save shortcut — intercept before the editor guard so it works while typing.
document.addEventListener("keydown", (e) => {
  const saveShortcut = (e.metaKey && isMacPlatform) || (e.ctrlKey && !isMacPlatform);
  if (saveShortcut && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    if (localFileStore && dirtyPaths.size > 0) {
      saveAll();
    }
  }
});

updateShortcutTooltips();

function isShortcut(e) {
  if (isMacPlatform) {
    // macOS: Command+Control (⌘+⌃)
    return e.metaKey && e.ctrlKey && !e.altKey && !e.shiftKey;
  }
  // Windows/Linux: Ctrl+Alt
  return e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey;
}

document.addEventListener("keydown", async (e) => {
  // Don't intercept when typing in the editor, unless the user is using the
  // edit-mode shortcut to close the editor while it has focus.
  const inEditor = editorEl.contains(e.target);
  const closingEditor =
    inEditor && editMode && (e.key === "e" || e.key === "E") && isShortcut(e);
  if (inEditor && !closingEditor) return;

  if (isShortcut(e)) {
    const presenting = document.body.classList.contains("presenting");
    switch (e.key) {
      case "p":
      case "P":
        e.preventDefault();
        if (presenting) exitPresent();
        else enterPresent();
        break;
      case "e":
      case "E":
        if (presenting) break;
        e.preventDefault();
        await setEditMode(!editMode);
        break;
      case "i":
      case "I":
        if (presenting) break;
        e.preventDefault();
        ThemeManager.toggleTheme();
        onThemeChange();
        break;
      case "s":
      case "S":
        if (!presenting) break;
        e.preventDefault();
        sectionNavigator?.toggleSpotlight();
        break;
    }
    return;
  }

  const presenting = document.body.classList.contains("presenting");

  // In normal mode, only use arrow/page/home/space keys when focus is inside
  // the preview pane, the navigation sidebar, or on the body. Never while a
  // modal/menu is open or focus is in a text input.
  const isTextInput =
    e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/i.test(e.target.tagName);
  const modalOpen =
    !settingsModal.classList.contains("hidden") ||
    !openFolderModal.classList.contains("hidden") ||
    !menuDropdown.classList.contains("hidden");
  const inPreview =
    presenting ||
    previewPane.contains(e.target) ||
    tocPane.contains(e.target) ||
    e.target === document.body;
  if (isTextInput || modalOpen || !inPreview) return;

  // macOS: Command+Up/Down scrolls to top/bottom of the current chapter.
  if (isMacPlatform && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      previewPane.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      previewPane.scrollTo({ top: previewPane.scrollHeight, behavior: "smooth" });
      return;
    }
  }

  const SCROLL_STEP = Math.max(120, Math.round(previewPane.clientHeight * 0.5));

  // Let Space/Page on a button activate the button (e.g. a TOC/chapter item
  // or the prev/next chapter controls) instead of treating it as section nav.
  if (
    e.target.closest("button") &&
    (e.key === " " || e.key === "PageUp" || e.key === "PageDown")
  ) {
    return;
  }

  // Section and scroll navigation. Works in both present and normal mode:
  //   Left/Right/Space/Page move between sections, Up/Down scroll, Home/End
  //   jump to the first/last section.
  switch (e.key) {
    case "ArrowRight":
      e.preventDefault();
      scrollSpy.withNavigatorScroll(() => sectionNavigator?.next(), true);
      break;
    case " ":
    case "PageDown":
      e.preventDefault();
      scrollSpy.withNavigatorScroll(
        () => sectionNavigator?.next({ syncVisual: false }),
        false,
      );
      break;
    case "ArrowLeft":
      e.preventDefault();
      scrollSpy.withNavigatorScroll(() => sectionNavigator?.prev(), true);
      break;
    case "PageUp":
      e.preventDefault();
      scrollSpy.withNavigatorScroll(
        () => sectionNavigator?.prev({ syncVisual: false }),
        false,
      );
      break;
    case "ArrowUp":
      e.preventDefault();
      previewPane.scrollBy({ top: -SCROLL_STEP, behavior: "smooth" });
      break;
    case "ArrowDown":
      e.preventDefault();
      previewPane.scrollBy({ top: SCROLL_STEP, behavior: "smooth" });
      break;
    case "Home":
      e.preventDefault();
      scrollSpy.withNavigatorScroll(
        () => sectionNavigator?.first({ syncVisual: false }),
        false,
      );
      break;
    case "End":
      e.preventDefault();
      scrollSpy.withNavigatorScroll(
        () => sectionNavigator?.last({ syncVisual: false }),
        false,
      );
      break;
    case "s":
    case "S":
      if (!presenting) break;
      e.preventDefault();
      sectionNavigator?.toggleSpotlight();
      break;
    case "Escape":
      if (!presenting) break;
      e.preventDefault();
      exitPresent();
      break;
  }
});

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && document.body.classList.contains("presenting")) {
    exitPresent();
  }
});

// ---- File operations ----

/**
 * Open a coursebook by picking its folder directly (single dialog).
 * Finds coursebook.md in the selected folder and loads it with all
 * chapters. Uses the File System Access API when available (granting
 * write access for Save), falling back to a webkitdirectory input.
 */
async function openCoursebookFolder() {
  if ("showDirectoryPicker" in window) {
    try {
      const dirHandle = await window.showDirectoryPicker();
      await openCoursebookFromDirHandle(dirHandle);
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
      showToast(
        "Could not access the selected folder for writing. " +
          "Make sure you grant permission so the coursebook can be saved.",
      );
      console.warn("Directory picker failed:", e);
      return;
    }
  }
  showToast(
    "This browser doesn't support folder write access. " +
      "The coursebook will open read-only; use Chrome/Edge to edit and save.",
  );
  await openCoursebookViaWebkitDirectoryInput();
}

/**
 * Load a coursebook from a FileSystemDirectoryHandle that the user
 * picked with "Open Coursebook Folder".
 * @param {FileSystemDirectoryHandle} dirHandle
 */
async function openCoursebookFromDirHandle(dirHandle) {
  let parentMarkdown;
  try {
    const parentHandle = await dirHandle.getFileHandle("coursebook.md");
    const parentFile = await parentHandle.getFile();
    parentMarkdown = await parentFile.text();
  } catch {
    showToast("No coursebook.md found in the selected folder.");
    return;
  }

  const parsed = parseCoursebook(parentMarkdown, "coursebook.md");
  if (parsed.chapters.length === 0) {
    showToast("The coursebook.md in this folder has no chapters.");
    return;
  }
  await loadCoursebookFromDirectoryHandle(parentMarkdown, dirHandle, "coursebook.md");
}

/**
 * Fallback for "Open Coursebook Folder" when the File System Access API
 * is unavailable (Firefox/Safari). Uses a webkitdirectory input.
 */
function openCoursebookViaWebkitDirectoryInput() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;

    input.onchange = async () => {
      const files = Array.from(input.files || []);
      const fileMap = new Map();
      for (const file of files) {
        const relPath = file.webkitRelativePath
          ? file.webkitRelativePath.split("/").slice(1).join("/")
          : file.name;
        if (relPath) fileMap.set(relPath, file);
      }

      const parentFile = fileMap.get("coursebook.md");
      if (!parentFile) {
        showToast("No coursebook.md found in the selected folder.");
        resolve();
        return;
      }
      const parentMarkdown = await parentFile.text();

      const fileMapLower = new Map(
        [...fileMap.entries()].map(([path, f]) => [path.toLowerCase(), f]),
      );

      const loadFile = async (resolvedPath) => {
        const file =
          fileMap.get(resolvedPath) ?? fileMapLower.get(resolvedPath.toLowerCase());
        if (!file) {
          console.warn("File not found:", resolvedPath);
          throw new Error("File not found.");
        }
        return file.text();
      };

      // webkitdirectory grants read-only access — no write handles available.
      localFileStore = { fileMap, fileMapLower, parentPath: "coursebook.md" };
      const coursebook = await loadCoursebook("coursebook.md", parentMarkdown, loadFile);
      await activateCoursebook(coursebook, coursebook.markdown);
      resolve();
    };

    input.click();
  });
}

function openFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".md,.markdown,.txt";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();

    // Check if this looks like a coursebook (has chapter links)
    const parsed = parseCoursebook(text, file.name);
    if (parsed.chapters.length > 0) {
      await openCoursebookFromFile(text, file.name);
      return;
    }

    // Regular single-file markdown
    currentMarkdown = text;
    linkPreviews = {};
    LinkPreview.setPreviews(linkPreviews);
    // Opening a new file is a new editing session for the standalone key.
    clearEditorStates();
    markdownEditor?.setValue(text, { suppressOnChange: true });
    if (markdownEditor) currentEditorKey = "standalone";
    await renderSingleMarkdown(text);
    chapterTitleEl.textContent = file.name;
    // Clear chapter context when opening a standalone file
    coursebook = null;
    currentChapterIdx = -1;
    chapterListEl.innerHTML = "";
    chapterPaneTitle.textContent = "Chapters";
    chapterNav.classList.add("hidden");
    // Plain file inputs don't grant write access
    localFileStore = null;
    dirtyPaths = new Set();
    updateSaveState();
  };
  input.click();
}

/**
 * Load a coursebook from a local file by showing a modal that prompts the
 * user to select the directory containing the chapter files.
 *
 * The modal is required because the browser only allows file/directory
 * picker dialogs within a user activation event (a click). The original
 * file picker's user activation has expired by the time we detect the
 * file is a coursebook, so we need a fresh click on the modal's
 * "Select Folder" button.
 *
 * @param {string} parentMarkdown - The coursebook.md content.
 * @param {string} parentFileName - The coursebook.md filename.
 */
async function openCoursebookFromFile(parentMarkdown, parentFileName) {
  const parsed = parseCoursebook(parentMarkdown, parentFileName);
  pendingCoursebook = { parsed, parentMarkdown, parentFileName };

  const chapterWord = parsed.chapters.length === 1 ? "chapter" : "chapters";
  openFolderMessage.textContent =
    `This file references ${parsed.chapters.length} ${chapterWord}. ` +
    "Select the folder that contains the chapter files to load the full coursebook. " +
    "(Tip: File → Open Coursebook Folder opens a whole coursebook in one step.)";

  openFolderModal.classList.remove("hidden");
}

/**
 * Handle the "Select Folder" button click from the modal.
 * Uses the File System Access API when available, falling back to
 * a webkitdirectory input.
 */
async function selectCoursebookFolder() {
  if (!pendingCoursebook) return;
  const { parentMarkdown, parentFileName = "coursebook.md" } = pendingCoursebook;
  closeOpenFolderModal();

  // Try the File System Access API first (Chromium-based browsers)
  if ("showDirectoryPicker" in window) {
    try {
      const dirHandle = await window.showDirectoryPicker();
      await loadCoursebookFromDirectoryHandle(parentMarkdown, dirHandle, parentFileName);
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
      showToast(
        "Could not access the selected folder for writing. " +
          "Make sure you grant permission so the coursebook can be saved.",
      );
      console.warn("Directory picker failed:", e);
      return;
    }
  }

  showToast(
    "This browser doesn't support folder write access. " +
      "The coursebook will open read-only; use Chrome/Edge to edit and save.",
  );
  // Fallback: use webkitdirectory input (Firefox, Safari)
  await loadCoursebookViaWebkitDirectory(parentMarkdown, parentFileName);
}

function closeOpenFolderModal() {
  openFolderModal.classList.add("hidden");
  pendingCoursebook = null;
}

/**
 * Load all chapter files from a FileSystemDirectoryHandle.
 * Also records the file handles so edits can be saved back to disk.
 * @param {import("./core/coursebook-loader.js").Coursebook} parsed
 * @param {string} parentMarkdown
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} [parentFileName] - Name of the parent coursebook file.
 */
async function loadCoursebookFromDirectoryHandle(
  parentMarkdown,
  dirHandle,
  parentFileName = "coursebook.md",
) {
  const handles = new Map();

  // Record the parent coursebook.md file handle (at the directory root)
  try {
    const { fileHandle } = await readFileFromDirectory(dirHandle, parentFileName);
    if (fileHandle) handles.set(parentFileName, fileHandle);
  } catch {
    // Parent handle not available — saving the landing page will be skipped
  }

  const loadFile = async (resolvedPath, sourcePath) => {
    const { file, fileHandle } = await readFileFromDirectory(dirHandle, resolvedPath);
    if (fileHandle) handles.set(sourcePath, fileHandle);
    return await file.text();
  };

  const coursebook = await loadCoursebook(parentFileName, parentMarkdown, loadFile);

  localFileStore = {
    dirHandle,
    handles,
    parentPath: parentFileName,
  };
  dirtyPaths = new Set();
  updateSaveState();

  await activateCoursebook(coursebook, coursebook.markdown);
}

/**
 * Recursively read a file from a directory handle given a relative path
 * like "chapters/01-intro.md".
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} relativePath
 * @returns {Promise<{markdown: string, fileHandle: FileSystemFileHandle}>}
 */
async function findEntryName(dirHandle, name, kind) {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === kind && entry.name.toLowerCase() === name.toLowerCase()) {
      return entry.name;
    }
  }
  return null;
}

async function readFileFromDirectory(dirHandle, relativePath) {
  const parts = relativePath.split("/").filter(Boolean);
  let current = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    const name = parts[i];
    try {
      current = await current.getDirectoryHandle(name);
    } catch {
      const real = await findEntryName(current, name, "directory");
      if (!real) {
        console.warn("Directory not found in selected folder:", relativePath);
        throw new Error("Directory not found in selected folder.");
      }
      current = await current.getDirectoryHandle(real);
    }
  }
  const fileName = parts[parts.length - 1];
  let fileHandle;
  try {
    fileHandle = await current.getFileHandle(fileName);
  } catch {
    const real = await findEntryName(current, fileName, "file");
    if (!real) {
      console.warn("File not found in selected folder:", relativePath);
      throw new Error("File not found in selected folder.");
    }
    fileHandle = await current.getFileHandle(real);
  }
  const file = await fileHandle.getFile();
  return { file, fileHandle };
}

function collectCoursebookUrls(coursebook) {
  if (!coursebook) return [];
  const markdowns = [coursebook.markdown, ...coursebook.chapters.map((c) => c.markdown)];
  const all = new Set();
  for (const md of markdowns) {
    for (const url of extractLinks(md)) {
      all.add(url);
    }
  }
  return [...all];
}

async function preloadMissingLinkPreviews(loadedCoursebook) {
  if (loadedCoursebook !== coursebook) return;

  const urls = collectCoursebookUrls(loadedCoursebook);
  if (urls.length === 0) return;

  const missing = urls.filter((url) => !linkPreviews.hasOwnProperty(url));
  if (missing.length === 0) return;

  showToast("Building link previews...");

  let builtCount = 0;
  // Fetch a few at a time to avoid hammering the network.
  const CONCURRENCY = 3;
  let index = 0;

  const jinaApiKey = import.meta.env?.JINA_API_KEY;

  async function worker() {
    while (index < missing.length) {
      const url = missing[index++];
      try {
        const preview = await resolvePreview(url, { apiKey: jinaApiKey });
        if (loadedCoursebook !== coursebook) return;
        if (preview) {
          linkPreviews[url] = preview;
          LinkPreview.setPreviews(linkPreviews);
          builtCount++;
        }
      } catch (e) {
        // A single failing preview should not block the rest.
        console.warn("Failed to fetch preview for", url, e);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (builtCount > 0) showToast("Link previews ready");
}

/**
 * Fallback: use a hidden <input webkitdirectory> to let the user pick
 * the coursebook folder, then match chapter paths to the selected files.
 * @param {string} parentMarkdown
 * @param {string} [parentFileName="coursebook.md"]
 */
function loadCoursebookViaWebkitDirectory(
  parentMarkdown,
  parentFileName = "coursebook.md",
) {
  // webkitdirectory grants read-only access — no write handles available.
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;

    input.onchange = async () => {
      const files = Array.from(input.files || []);
      // Build a map of relative paths to file content
      const fileMap = new Map();
      for (const file of files) {
        // webkitRelativePath includes the selected folder name as the first segment
        const relPath = file.webkitRelativePath
          ? file.webkitRelativePath.split("/").slice(1).join("/")
          : file.name;
        if (relPath) fileMap.set(relPath, file);
      }

      const fileMapLower = new Map(
        [...fileMap.entries()].map(([path, f]) => [path.toLowerCase(), f]),
      );

      const loadFile = async (resolvedPath) => {
        const file =
          fileMap.get(resolvedPath) ?? fileMapLower.get(resolvedPath.toLowerCase());
        if (!file) {
          console.warn("File not found:", resolvedPath);
          throw new Error("File not found.");
        }
        return file.text();
      };

      // webkitdirectory grants read-only access — no write handles available.
      localFileStore = { fileMap, fileMapLower, parentPath: parentFileName };
      const coursebook = await loadCoursebook(parentFileName, parentMarkdown, loadFile);
      await activateCoursebook(coursebook, coursebook.markdown);
      resolve();
    };

    input.click();
  });
}

/**
 * Activate a coursebook that has been loaded from local files.
 * Sets the global coursebook state and renders all chapters.
 * @param {import("./core/coursebook-loader.js").Coursebook} parsed
 * @param {string} parentMarkdown
 */
async function activateCoursebook(parsed, parentMarkdown) {
  if (editMode) await setEditMode(false);

  // New coursebook = new editing session; drop any cached editor states.
  clearEditorStates();

  coursebook = { ...parsed, markdown: parentMarkdown };
  chapterPaneTitle.textContent = coursebook.title;
  chapterTitleEl.textContent = coursebook.title;
  chapterNav.classList.remove("hidden");

  linkPreviews = await loadPreviewsForCoursebook(coursebook.parentPath);
  LinkPreview.setPreviews(linkPreviews);
  void preloadMissingLinkPreviews(coursebook);

  // If this coursebook wasn't loaded with write access (e.g. webkitdirectory
  // fallback or URL-loaded coursebook), keep save disabled.
  if (!localFileStore?.dirHandle) {
    dirtyPaths = new Set();
    updateSaveState();
  }

  await preloadSectionHeadings();
  buildChapterList();
  await renderAllChapters();
  await reportLinkIssues();

  currentChapterIdx = -1;
  updateActiveChapter();
  updateChapterNav();
  updateVisibleSection();
  previewPane.scrollTop = 0;
}

// ---- Save ----

/**
 * Update the save buttons' enabled state.
 * The button is enabled whenever there are unsaved changes, regardless of
 * whether the coursebook has write handles — clicking it gives feedback
 * either way (writes to disk, or explains how to enable saving).
 */
function updateSaveState() {
  const hasChanges = dirtyPaths.size > 0;
  saveBtn.disabled = !hasChanges;
  menuSaveBtn.disabled = !hasChanges;
}

/**
 * Mark the currently edited file as dirty so the save buttons enable.
 * Works regardless of write access so the button can give feedback.
 */
function markCurrentDirty() {
  if (!coursebook) return;
  const path = dirtyPathForCurrentChapter();
  if (path) {
    dirtyPaths.add(path);
    updateSaveState();
  }
}

/**
 * Resolve the file path for the section currently being edited.
 * Uses the write store when available, otherwise falls back to the
 * chapter's path so dirty tracking still works in URL mode.
 * @returns {string|null}
 */
function dirtyPathForCurrentChapter() {
  if (!coursebook) return null;
  if (currentChapterIdx === -1) {
    return localFileStore ? localFileStore.parentPath : "coursebook.md";
  }
  const chapter = coursebook.chapters[currentChapterIdx];
  return chapter.path;
}

// ---- Link validation ----

/**
 * Normalized set of chapter paths as matched by rewriteChapterLinks:
 * both the raw `path` from coursebook.md and the `resolvedPath`.
 * @returns {Set<string>}
 */
function buildKnownChapterPathSet() {
  const paths = new Set();
  if (coursebook) {
    for (const chapter of coursebook.chapters) {
      if (chapter.path) paths.add(chapter.path);
      if (chapter.resolvedPath) paths.add(chapter.resolvedPath);
    }
  }
  return paths;
}

/**
 * The set of heading ids that renderAllChapters mints, emulated from
 * sectionHeadings: section ids (overview + chapter slugs) are reserved
 * first, then headings are slugged in document order with the same
 * `-1` suffix dedup scheme.
 * @returns {Set<string>}
 */
function buildHeadingSlugSet() {
  const used = new Set(["overview"]);
  if (coursebook) {
    for (const chapter of coursebook.chapters) {
      used.add(chapterSlug(chapter.title));
    }
  }
  for (const headings of sectionHeadings) {
    for (const heading of headings) {
      const baseId = slugifyForId(heading.title);
      let id = baseId;
      let suffix = 1;
      while (used.has(id)) {
        id = `${baseId}-${suffix++}`;
      }
      used.add(id);
    }
  }
  return used;
}

/**
 * Existence check for a resolved relative path in the active file store.
 * Returns null when existence cannot be determined (no store), which
 * disables path checks in URL-loaded mode.
 * @param {string} relPath
 * @returns {Promise<boolean|null>}
 */
async function localFileExists(relPath) {
  if (!localFileStore) return null;
  if (localFileStore.dirHandle) {
    try {
      await readFileFromDirectory(localFileStore.dirHandle, relPath);
      return true;
    } catch {
      return false;
    }
  }
  if (localFileStore.fileMap) {
    if (localFileStore.fileMap.has(relPath)) return true;
    if (localFileStore.fileMapLower?.has(relPath.toLowerCase())) return true;
    return false;
  }
  return null;
}

/**
 * Validate all loaded sections for broken internal links.
 * Path checks are skipped when no local file store is available
 * (URL-loaded coursebooks); chapter and #hash checks still run.
 * @returns {Promise<Array|null>} Issues, or null when not applicable.
 */
async function validateCoursebookLinks() {
  if (!coursebook) return null;
  const exists = localFileStore ? localFileExists : undefined;

  const knownChapterPaths = buildKnownChapterPathSet();
  const headingSlugs = buildHeadingSlugSet();
  const coursebookRoot = getBaseDir(localFileStore?.parentPath ?? coursebook.parentPath);

  const issues = [];
  const sections = [
    { path: localFileStore?.parentPath ?? coursebook.parentPath, idx: 0 },
  ];
  coursebook.chapters.forEach((chapter, i) => {
    sections.push({ path: chapter.resolvedPath || chapter.path, idx: i + 1 });
  });

  for (const { path, idx } of sections) {
    const markdown = sectionMarkdowns[idx];
    if (markdown === undefined || markdown === null) continue;
    const sectionIssues = await findBrokenLinks({
      markdown,
      sourcePath: path,
      knownChapterPaths,
      headingSlugs,
      coursebookRoot,
      exists,
    });
    for (const issue of sectionIssues) {
      issues.push({ ...issue, source: path });
    }
  }
  return issues;
}

/**
 * Run validation and surface a summary toast plus console details.
 * @param {Array|null} issues - Pre-computed issues, or null to validate now.
 */
async function reportLinkIssues(issues) {
  if (issues === null || issues === undefined) issues = await validateCoursebookLinks();
  if (!issues || issues.length === 0) return;
  logLinkIssues(issues);
  showToast(
    `${issues.length} broken link${issues.length === 1 ? "" : "s"} found — ` +
      "details in the browser console.",
  );
}

function logLinkIssues(issues) {
  for (const issue of issues) {
    console.warn(
      `Broken link (${issue.kind}) in ${issue.source}:${issue.line ?? "?"} ` +
        `→ ${issue.target}: ${issue.reason}`,
    );
  }
}

/**
 * Write all dirty .md files back to disk using the recorded file handles.
 * The landing page is section 0; each chapter is section idx+1.
 * When the coursebook wasn't opened with write access, explains how to
 * enable saving instead.
 * @returns {Promise<number>} Number of files saved.
 */
async function saveAll() {
  await flushCurrentEditorChanges();

  if (!localFileStore?.dirHandle) {
    showToast(
      "This coursebook was opened read-only. " +
        "Use Chrome/Edge with File System Access API enabled and grant write permission to save.",
    );
    return 0;
  }
  if (dirtyPaths.size === 0) return 0;

  // Validate what is about to be written so broken-link feedback lands at
  // the moment that matters. v1 is informational — saving proceeds.
  const linkIssues = await validateCoursebookLinks();
  if (linkIssues?.length) logLinkIssues(linkIssues);

  const writes = [];

  // Landing page (section 0) → parent coursebook file
  if (dirtyPaths.has(localFileStore.parentPath) && sectionMarkdowns[0] !== undefined) {
    writes.push({
      path: localFileStore.parentPath,
      markdown: sectionMarkdowns[0],
    });
  }

  // Chapters (section idx+1) → chapter files
  if (coursebook) {
    coursebook.chapters.forEach((chapter, idx) => {
      const markdown = sectionMarkdowns[idx + 1];
      if (dirtyPaths.has(chapter.path) && markdown !== undefined) {
        writes.push({ path: chapter.path, markdown });
      }
    });
  }

  let saved = 0;
  let failed = 0;
  for (const { path, markdown } of writes) {
    const handle = localFileStore.handles.get(path);
    if (!handle) {
      failed++;
      continue;
    }
    try {
      const writable = await handle.createWritable();
      await writable.write(markdown);
      await writable.close();
      dirtyPaths.delete(path);
      saved++;
    } catch (e) {
      failed++;
      console.warn(`Failed to save ${path}:`, e);
    }
  }

  updateSaveState();
  const linkNote =
    linkIssues && linkIssues.length > 0
      ? ` — ${linkIssues.length} broken link${linkIssues.length === 1 ? "" : "s"} found`
      : "";
  if (saved > 0) {
    showToast(`Saved ${saved} file${saved === 1 ? "" : "s"}${linkNote}`);
  } else if (failed > 0) {
    showToast("Save failed — check the browser console for details.");
  }
  return saved;
}

/**
 * Show a transient toast notification.
 * @param {string} message
 */
function showToast(message) {
  let toast = document.getElementById("appToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "appToast";
    toast.className = "app-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 3500);
}

async function exportHtml() {
  await flushCurrentEditorChanges();

  const assetResolver = localFileStore ? resolveAsset : undefined;
  const previews = linkPreviews;
  let html;
  let filename;
  if (coursebook) {
    html = await exportCoursebookHtml(coursebook, assetResolver, previews);
    filename = coursebook.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".html";
  } else {
    const markdown = markdownEditor?.getValue() ?? currentMarkdown;
    html = await exportSingleHtml(
      chapterTitleEl.textContent,
      markdown,
      assetResolver,
      previews,
    );
    filename = "chapter.html";
  }
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function loadPreviewsForCoursebook(parentPath) {
  if (!parentPath) return {};
  const baseDir = getBaseDir(parentPath);
  const previewPath = baseDir ? `${baseDir}/previews.json` : "previews.json";

  try {
    if (localFileStore?.dirHandle) {
      const { file } = await readFileFromDirectory(localFileStore.dirHandle, previewPath);
      return JSON.parse(await file.text());
    }

    if (localFileStore?.fileMap) {
      const f =
        localFileStore.fileMap.get(previewPath) ??
        localFileStore.fileMapLower?.get(previewPath.toLowerCase());
      if (!f) return {};
      return JSON.parse(await f.text());
    }

    const res = await fetch(previewPath);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

menuOpenCoursebookBtn.addEventListener("click", () => {
  openCoursebookFolder();
  closeMenu();
});

menuOpenFileBtn.addEventListener("click", () => {
  openFile();
  closeMenu();
});

menuSaveBtn.addEventListener("click", async () => {
  await saveAll();
  closeMenu();
});

saveBtn.addEventListener("click", async () => {
  await saveAll();
});

menuExportHtmlBtn.addEventListener("click", async () => {
  await exportHtml();
  closeMenu();
});

menuSettingsBtn.addEventListener("click", () => {
  closeMenu();
  openSettings();
});

// ---- In-content navigation ----
// Catch any relative .md link that wasn't rewritten (e.g. user-authored links
// inside a chapter) and navigate in-app instead of opening the raw .md file.
contentEl.addEventListener("click", (event) => {
  if (!coursebook) return;
  const link = event.target.closest("a[href]");
  if (!link) return;

  const href = link.getAttribute("href") || "";
  if (
    href.startsWith("#") ||
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("//") ||
    href.startsWith("mailto:") ||
    !href.endsWith(".md")
  )
    return;

  const idx = coursebook.chapters.findIndex(
    (chapter) => chapter.path === href || chapter.resolvedPath === href,
  );
  if (idx >= 0) {
    event.preventDefault();
    loadChapterByIdx(idx);
  }
});

// ---- Reading aids ----
// Delegated clicks for the go-up links.
contentEl.addEventListener("click", (event) => {
  const goUp = event.target.closest(".go-up-link");
  if (!goUp) return;
  event.preventDefault();
  scrollSpy.scrollToSmooth(goUp.closest(".coursebook-section") ?? contentEl);
});

// ---- Index links ----
// Index entries link to the first occurrence of a term, which may live in
// a hidden chapter: switch to that chapter first, then scroll to the term.
contentEl.addEventListener("click", async (event) => {
  const link = event.target.closest(".idx-link");
  if (!link) return;
  event.preventDefault();

  const target = document.getElementById(link.getAttribute("data-target") || "");
  const section = target?.closest(".coursebook-section");
  if (!target || !section || !coursebook) return;
  if (section.classList.contains("index-section")) return;

  const idx = section.id === "overview" ? -1 : findChapterIdxBySlug(section.id);
  if (idx >= -1) {
    await loadChapterByIdx(idx, { skipHash: true });
  }
  scrollSpy.scrollToSmooth(target);
  flashIndexedTerm(target, previewPane);
  const hash = formatLocationHash(section.id, target.id);
  if (location.hash !== hash) history.replaceState(null, "", hash);
});

// ---- Initial load ----
initCoursebook();

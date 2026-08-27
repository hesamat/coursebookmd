/**
 * app.js — Application entry point.
 * Wires together coursebook loading, theme management, icon hydration,
 * menu dropdowns, the editor, renderer, navigator, and presentation mode.
 */
import { renderMarkdown, sanitizeHtml } from "./renderer/markdown-renderer.js";
import { ContentEnhancer } from "./renderer/content-enhancer.js";
import { SectionNavigator } from "./navigator/section-navigator.js";
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
import { slugifyForId } from "./core/utils.js";
import { flashHeading } from "./core/heading-flash.js";
import { parseLocationHash, formatLocationHash } from "./core/navigation.js";
import { extractTocItems } from "./core/toc-data.js";
import {
  loadCoursebook,
  loadChapter,
  getChapterTitle,
  parseCoursebook,
} from "./core/coursebook-loader.js";
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
| Diagrams (Mermaid) | Working |
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

### Diagram example

\`\`\`mermaid
graph TD
    A[Write] --> B[Run]
    B --> C{Works?}
    C -->|No| D[Fix]
    D --> B
    C -->|Yes| E[Done]
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
let navigator = null;
let editMode = false;
let renderTimer = null;
let currentMarkdown = DEFAULT_CONTENT;
let suppressScrollSpy = false;

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

/** @type {import("./core/coursebook-loader.js").Coursebook | null} */
let coursebook = null;
let currentChapterIdx = -1; // -1 means parent/landing page

// Pre-loaded chapter markdowns and per-section heading/number data.
// sectionHeadings[0] is the parent landing page, sectionHeadings[i+1] is chapter i.
let sectionMarkdowns = [];
let sectionHeadings = [];
let sectionNumbers = [];

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
 * Render the entire coursebook as a single continuous page.
 * Each chapter (and the landing page) is wrapped in a <section> with an id,
 * so scroll-spy can track which chapter is currently in view.
 */
async function renderAllChapters() {
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

  // Enhance content (Shiki, KaTeX, copy buttons, Mermaid)
  await ContentEnhancer.enhance(contentEl);

  // Set up navigator for presentation mode
  navigator = new SectionNavigator(contentEl);
  navigator.onNavigate = updateOverlay;
  navigator.setup();
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

  navigator = new SectionNavigator(contentEl);
  navigator.onNavigate = updateOverlay;
  navigator.setup();

  previewPane.scrollTop = 0;
}

function updateOverlay(idx) {
  if (!navigator) return;
  overlayCurrent.textContent = navigator.currentText;
  const next = navigator.nextText;
  overlayNext.textContent = next ? "Next: " + next : "End of chapter";
  overlayProgress.textContent = idx + 1 + " / " + navigator.count;
}

// ---- Coursebook loading ----
async function initCoursebook() {
  const params = new URLSearchParams(location.search);
  const requestedCoursebook = params.get("coursebook") || guessCoursebookPath();

  // URL-loaded coursebooks have no write access — never inherit a stale
  // store from a previously opened local coursebook.
  localFileStore = null;
  dirtyPaths = new Set();

  try {
    coursebook = await loadCoursebookFrom(requestedCoursebook);
    chapterPaneTitle.textContent = coursebook.title;
    chapterTitleEl.textContent = coursebook.title;

    // Pre-load all chapter markdowns and heading data so section numbering is
    // continuous across the whole coursebook.
    await preloadSectionHeadings();

    buildChapterList();
    // Render all chapters as a continuous page
    await renderAllChapters();

    updateSaveState();

    // If the URL has a hash, navigate to that section; otherwise start at top
    if (location.hash) {
      navigateFromHash();
    } else {
      currentChapterIdx = -1;
      updateActiveChapter();
      updateChapterNav();
      previewPane.scrollTop = 0;
    }
  } catch (e) {
    // No coursebook.md found — fall back to standalone mode
    console.warn("Coursebook not loaded, using standalone mode:", e.message);
    coursebook = null;
    sectionMarkdowns = [];
    sectionHeadings = [];
    sectionNumbers = [];
    chapterListEl.innerHTML = "";
    chapterPaneTitle.textContent = "Chapters";
    chapterTitleEl.textContent = "CoursebookMD";
    chapterNav.classList.add("hidden");
    await renderSingleMarkdown(DEFAULT_CONTENT);
  }
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
  homeItem.addEventListener("click", () =>
    showLandingPage({ flash: true, skipHash: false }),
  );
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
  for (const entry of navEntries) {
    if (entry.type === "group") {
      const group = createGroupElement(entry.title, collapsedGroups);
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

    item.addEventListener("click", () => loadChapterByIdx(idx, { flash: true }));
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

  // Auto-expand the group containing the active chapter so it stays visible.
  if (currentChapterIdx >= 0) {
    const activeWrapper = chapterListEl.querySelector(
      `.chapter-item-wrapper[data-chapter-idx="${currentChapterIdx}"]`,
    );
    autoExpandGroup(activeWrapper);
  }
}

/** How far from the top of the preview pane a scrolled-to element should sit. */
const SCROLL_OFFSET = 80;

/**
 * Compute the preview pane's scrollTop that places `el` SCROLL_OFFSET px
 * below the top of the pane. Uses getBoundingClientRect so the math is
 * consistent with the scroll-spy (which also uses rects).
 * @param {HTMLElement} el
 * @returns {number}
 */
function scrollTopForElement(el) {
  const paneRect = previewPane.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  return previewPane.scrollTop + (elRect.top - paneRect.top) - SCROLL_OFFSET;
}

/**
 * Scroll to an element instantly (no smooth animation). Used for chapter-level
 * navigation. The caller is responsible for setting currentChapterIdx, sidebar
 * state, and hash — the scroll-spy is suppressed so it doesn't override them.
 * @param {HTMLElement} el
 */
function scrollToElInstant(el) {
  suppressScrollSpy = true;
  previewPane.scrollTop = scrollTopForElement(el);
  // Keep scroll-spy suppressed until after the queued scroll event fires,
  // then run it once so the active chapter/TOC highlighting updates.
  requestAnimationFrame(() => {
    suppressScrollSpy = false;
    updateScrollSpy({ lockChapter: true });
  });
}

/**
 * Scroll to an element smoothly, suppressing scroll-spy during the animation.
 * Uses the scrollend event when available, with a fallback timeout.
 * @param {HTMLElement} el
 * @param {Function} [onSettled] - Called after scroll completes
 */
function scrollToElSmooth(el, onSettled) {
  suppressScrollSpy = true;
  previewPane.scrollTo({ top: scrollTopForElement(el), behavior: "smooth" });

  const reenable = () => {
    suppressScrollSpy = false;
    updateScrollSpy({ lockChapter: true });
    if (onSettled) onSettled();
  };

  // Prefer the scrollend event (fires when scroll animation completes)
  if ("onscrollend" in previewPane) {
    previewPane.addEventListener("scrollend", reenable, { once: true });
  } else {
    setTimeout(reenable, 600);
  }
}

/**
 * Scroll to the landing page section.
 */
function showLandingPage({ flash = false, skipHash = false } = {}) {
  if (!coursebook) return;
  currentChapterIdx = -1;
  chapterTitleEl.textContent = coursebook.title;
  updateActiveChapter();
  updateChapterNav();
  syncEditorWithCurrent();
  if (!skipHash) updateLocationHash();

  const section = contentEl.querySelector("#overview");
  if (section) {
    scrollToElInstant(section);
    if (flash) {
      const h1 = section.querySelector("h1");
      if (h1) flashHeading(h1);
    }
  }
}

/**
 * Scroll to a chapter section by index.
 */
function loadChapterByIdx(idx, { skipHash = false, flash = true } = {}) {
  if (!coursebook || idx < 0 || idx >= coursebook.chapters.length) return;

  currentChapterIdx = idx;
  const chapter = coursebook.chapters[idx];
  const title = getChapterTitle(sectionMarkdowns[idx + 1], chapter.title);
  chapterTitleEl.textContent = `${coursebook.title} — ${title}`;
  updateActiveChapter();
  updateChapterNav();
  if (!skipHash) updateLocationHash();

  syncEditorWithCurrent();

  const sectionId = chapterSlug(chapter.title);
  const section = contentEl.querySelector(`#${CSS.escape(sectionId)}`);
  if (section) {
    scrollToElInstant(section);
    if (flash) {
      const h1 = section.querySelector("h1");
      if (h1) flashHeading(h1);
    }
  }
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
function navigateFromHash() {
  if (!coursebook) return;
  const { chapterSlug, headingSlug } = parseLocationHash(location.hash.slice(1));
  if (!chapterSlug) return;

  const idx = findChapterIdxBySlug(chapterSlug);
  if (idx === -2) return; // unknown chapter

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
  syncEditorWithCurrent();

  // Find the target element and navigate to it
  const section = contentEl.querySelector(`#${CSS.escape(chapterSlug)}`);
  if (!section) return;

  if (headingSlug) {
    const target = section.querySelector(`#${CSS.escape(headingSlug)}`);
    if (target) {
      // Smooth scroll for heading-level navigation (within a chapter)
      scrollToElSmooth(target, () => flashHeading(target));
      const hash = formatLocationHash(chapterSlug, headingSlug);
      if (location.hash !== hash) history.replaceState(null, "", hash);
    }
  } else {
    // Instant scroll for chapter-level navigation
    scrollToElInstant(section);
  }
}

window.addEventListener("hashchange", navigateFromHash);

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

  // Update labels
  if (hasPrev) {
    const prevIdx = currentChapterIdx - 1;
    const prevLabel = prevIdx >= 0 ? coursebook.chapters[prevIdx].title : "Overview";
    prevChapterBtn.querySelector(".chapter-nav__label").textContent = prevLabel;
  } else {
    prevChapterBtn.querySelector(".chapter-nav__label").textContent = "Previous";
  }

  if (hasNext) {
    const nextIdx = currentChapterIdx + 1;
    nextChapterBtn.querySelector(".chapter-nav__label").textContent =
      coursebook.chapters[nextIdx].title;
  } else {
    nextChapterBtn.querySelector(".chapter-nav__label").textContent = "Next";
  }
}

prevChapterBtn.addEventListener("click", () => {
  if (currentChapterIdx > 0) {
    loadChapterByIdx(currentChapterIdx - 1);
  } else if (currentChapterIdx === 0) {
    showLandingPage({ flash: true });
  }
});

nextChapterBtn.addEventListener("click", () => {
  if (currentChapterIdx === -1) {
    loadChapterByIdx(0);
  } else if (currentChapterIdx < coursebook.chapters.length - 1) {
    loadChapterByIdx(currentChapterIdx + 1);
  }
});

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
  for (const item of tocItems) {
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
        scrollToElSmooth(headingEl, () => flashHeading(headingEl));
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

// ---- Scroll spy: highlight current TOC item ----
let scrollSpyTimer = null;

previewPane.addEventListener("scroll", () => {
  if (suppressScrollSpy) return;
  if (scrollSpyTimer) cancelAnimationFrame(scrollSpyTimer);
  scrollSpyTimer = requestAnimationFrame(updateScrollSpy);
});

/**
 * Scroll spy: detect which chapter section is currently in view and update
 * the sidebar (active chapter + active TOC item) accordingly.
 *
 * @param {{ lockChapter?: boolean }} [opts] - When true (used after a click
 *   navigation), keep the current chapter selection and only update the
 *   active TOC item within it. This prevents sub-pixel rounding from
 *   overriding the user's explicit chapter click.
 */
function updateScrollSpy({ lockChapter = false } = {}) {
  if (!coursebook) return;

  const sections = Array.from(contentEl.querySelectorAll(".coursebook-section"));
  if (sections.length === 0) return;

  // Use rect math consistent with scrollTopForElement: a section is "active"
  // when its top is within SCROLL_OFFSET px of the pane's top (or above it).
  const paneRect = previewPane.getBoundingClientRect();

  // Find the section closest to the top
  let activeSectionIdx = 0;
  for (let i = 0; i < sections.length; i++) {
    const sectionTop = sections[i].getBoundingClientRect().top;
    if (sectionTop - paneRect.top <= SCROLL_OFFSET) {
      activeSectionIdx = i;
    } else {
      break;
    }
  }

  if (!lockChapter) {
    // Map section index to chapter index (-1 for overview, 0..N-1 for chapters)
    const newChapterIdx = activeSectionIdx === 0 ? -1 : activeSectionIdx - 1;
    if (newChapterIdx !== currentChapterIdx) {
      currentChapterIdx = newChapterIdx;
      updateActiveChapter();
      updateChapterNav();
      updateLocationHash();
    }
  } else {
    // After a click navigation, use the section that matches the current
    // chapter rather than the scroll-derived one.
    activeSectionIdx = currentChapterIdx + 1;
  }

  // Update active TOC item within the current chapter
  const tocContainer = getCurrentChapterToc();
  if (!tocContainer) return;

  const activeSection = sections[activeSectionIdx];
  if (!activeSection) return;
  const headings = Array.from(activeSection.querySelectorAll("h2, h3"));
  let activeHeadingIdx = -1;
  for (let i = 0; i < headings.length; i++) {
    const headingTop = headings[i].getBoundingClientRect().top;
    if (headingTop - paneRect.top <= SCROLL_OFFSET) {
      activeHeadingIdx = i;
    } else {
      break;
    }
  }

  const items = tocContainer.querySelectorAll(".toc-item");
  items.forEach((item, i) => item.classList.toggle("active", i === activeHeadingIdx));
}

// ---- Editor ----
function syncEditorWithCurrent() {
  if (!editMode) return;
  const sectionIdx = currentChapterIdx + 1;
  editorEl.value =
    coursebook && sectionMarkdowns[sectionIdx] !== undefined
      ? sectionMarkdowns[sectionIdx]
      : currentMarkdown;
}

function setEditMode(on) {
  editMode = on;
  editorPane.classList.toggle("hidden", !on);
  toggleEditLabel.textContent = on ? "Preview" : "Edit";
  if (on) {
    syncEditorWithCurrent();
    editorEl.focus();
  }
}

editorEl.addEventListener("input", () => {
  markCurrentDirty();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(async () => {
    const markdown = editorEl.value;
    const sectionIdx = currentChapterIdx + 1;
    if (coursebook && sectionMarkdowns[sectionIdx] !== undefined) {
      sectionMarkdowns[sectionIdx] = markdown;
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
        const scrollTop = previewPane.scrollTop;
        section.innerHTML = sanitizeHtml(renderMarkdown(markdown));

        // Re-apply section numbers and unique IDs across ALL sections.
        // Adding/removing a heading in one chapter shifts every later
        // chapter's numbers, so we must update them all.
        const allSections = Array.from(contentEl.querySelectorAll(".coursebook-section"));
        const usedIds = new Set();
        for (const s of allSections) {
          if (s.id) usedIds.add(s.id);
        }
        for (const s of allSections) {
          const sIdx = allSections.indexOf(s);
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

        // Re-enhance the updated section only (other sections are unchanged)
        await ContentEnhancer.enhance(section);
        previewPane.scrollTop = scrollTop;
      }
    } else {
      // Standalone mode
      currentMarkdown = markdown;
      await renderSingleMarkdown(markdown);
    }
  }, 300);
});

toggleEditBtn.addEventListener("click", () => setEditMode(!editMode));
menuToggleEditBtn.addEventListener("click", () => {
  setEditMode(!editMode);
  closeMenu();
});

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
  if (navigator?.spotlight) document.body.classList.add("spotlight");

  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }

  // Wait for layout to settle (fullscreen + CSS transitions) before scrolling.
  // Without this, scrollIntoView fires against the old layout and the heading
  // ends up out of view.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      navigator?.navigateTo(0, { instant: true });
    });
  });
}

function exitPresent() {
  document.body.classList.remove("presenting", "spotlight");
  navigator?.clearHighlight();
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
  const nav = window.navigator;
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

document.addEventListener("keydown", (e) => {
  // Don't intercept when typing in the editor, unless the user is using the
  // edit-mode shortcut to close the editor while it has focus.
  const closingEditor =
    e.target === editorEl &&
    editMode &&
    (e.key === "e" || e.key === "E") &&
    isShortcut(e);
  if (e.target === editorEl && !closingEditor) return;

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
        setEditMode(!editMode);
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
        navigator?.toggleSpotlight();
        break;
    }
    return;
  }

  if (!document.body.classList.contains("presenting")) return;

  // macOS: Command+Up/Down maps to Home/End since Mac keyboards lack those keys.
  if (isMacPlatform && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      navigator?.first();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      navigator?.last();
      return;
    }
  }

  // Present mode navigation
  switch (e.key) {
    case "ArrowRight":
    case " ":
    case "PageDown":
      e.preventDefault();
      navigator?.next();
      break;
    case "ArrowLeft":
    case "PageUp":
      e.preventDefault();
      navigator?.prev();
      break;
    case "Home":
      e.preventDefault();
      navigator?.first();
      break;
    case "End":
      e.preventDefault();
      navigator?.last();
      break;
    case "s":
    case "S":
      e.preventDefault();
      navigator?.toggleSpotlight();
      break;
    case "Escape":
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
      console.warn("Directory picker failed, falling back:", e);
    }
  }
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
  await loadCoursebookFromDirectoryHandle(
    parsed,
    parentMarkdown,
    dirHandle,
    "coursebook.md",
  );
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
      const parsed = parseCoursebook(parentMarkdown, "coursebook.md");
      if (parsed.chapters.length === 0) {
        showToast("The coursebook.md in this folder has no chapters.");
        resolve();
        return;
      }

      // webkitdirectory grants read-only access — no write handles available.
      localFileStore = null;
      for (const chapter of parsed.chapters) {
        const file = fileMap.get(chapter.path);
        if (file) chapter.markdown = await file.text();
      }
      await activateCoursebook(parsed, parentMarkdown);
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
    editorEl.value = text;
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
  const { parsed, parentMarkdown, parentFileName = "coursebook.md" } = pendingCoursebook;
  closeOpenFolderModal();

  // Try the File System Access API first (Chromium-based browsers)
  if ("showDirectoryPicker" in window) {
    try {
      const dirHandle = await window.showDirectoryPicker();
      await loadCoursebookFromDirectoryHandle(
        parsed,
        parentMarkdown,
        dirHandle,
        parentFileName,
      );
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
      console.warn("Directory picker failed, falling back:", e);
    }
  }

  // Fallback: use webkitdirectory input (Firefox, Safari)
  await loadCoursebookViaWebkitDirectory(parsed, parentMarkdown);
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
  parsed,
  parentMarkdown,
  dirHandle,
  parentFileName = "coursebook.md",
) {
  // Attach pre-loaded markdown to each chapter and record file handles
  const handles = new Map();
  for (const chapter of parsed.chapters) {
    try {
      const { markdown, fileHandle } = await readFileFromDirectory(
        dirHandle,
        chapter.path,
      );
      chapter.markdown = markdown;
      if (fileHandle) handles.set(chapter.path, fileHandle);
    } catch {
      chapter.markdown = undefined;
    }
  }

  // Record the parent coursebook.md file handle (at the directory root)
  try {
    const parentHandle = await dirHandle.getFileHandle(parentFileName);
    handles.set(parentFileName, parentHandle);
  } catch {
    // Parent handle not available — saving the landing page will be skipped
  }

  localFileStore = {
    dirHandle,
    handles,
    parentPath: parentFileName,
  };
  dirtyPaths = new Set();
  updateSaveState();

  await activateCoursebook(parsed, parentMarkdown);
}

/**
 * Recursively read a file from a directory handle given a relative path
 * like "chapters/01-intro.md".
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} relativePath
 * @returns {Promise<{markdown: string, fileHandle: FileSystemFileHandle}>}
 */
async function readFileFromDirectory(dirHandle, relativePath) {
  const parts = relativePath.split("/").filter(Boolean);
  let current = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    current = await current.getDirectoryHandle(parts[i]);
  }
  const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
  const file = await fileHandle.getFile();
  return { markdown: await file.text(), fileHandle };
}

/**
 * Fallback: use a hidden <input webkitdirectory> to let the user pick
 * the coursebook folder, then match chapter paths to the selected files.
 * @param {import("./core/coursebook-loader.js").Coursebook} parsed
 * @param {string} parentMarkdown
 */
function loadCoursebookViaWebkitDirectory(parsed, parentMarkdown) {
  // webkitdirectory grants read-only access — no write handles available.
  localFileStore = null;
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

      // Attach pre-loaded markdown to each chapter
      for (const chapter of parsed.chapters) {
        const file = fileMap.get(chapter.path);
        if (file) {
          chapter.markdown = await file.text();
        }
      }

      await activateCoursebook(parsed, parentMarkdown);
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
  coursebook = { ...parsed, markdown: parentMarkdown };
  chapterPaneTitle.textContent = coursebook.title;
  chapterTitleEl.textContent = coursebook.title;
  chapterNav.classList.remove("hidden");

  // If this coursebook wasn't loaded with write access (e.g. webkitdirectory
  // fallback or URL-loaded coursebook), keep save disabled.
  if (!localFileStore) {
    dirtyPaths = new Set();
    updateSaveState();
  }

  await preloadSectionHeadings();
  buildChapterList();
  await renderAllChapters();

  currentChapterIdx = -1;
  updateActiveChapter();
  updateChapterNav();
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

/**
 * Write all dirty .md files back to disk using the recorded file handles.
 * The landing page is section 0; each chapter is section idx+1.
 * When the coursebook wasn't opened with write access, explains how to
 * enable saving instead.
 * @returns {Promise<number>} Number of files saved.
 */
async function saveAll() {
  if (!localFileStore) {
    showToast(
      "This coursebook was opened from a URL, so files can't be written back. " +
        "Use File → Open File and select the coursebook folder to enable saving.",
    );
    return 0;
  }
  if (dirtyPaths.size === 0) return 0;

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
  if (saved > 0) {
    showToast(`Saved ${saved} file${saved === 1 ? "" : "s"}`);
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
  let html;
  let filename;
  if (coursebook) {
    html = await exportCoursebookHtml(coursebook);
    filename = coursebook.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".html";
  } else {
    // Use editor value directly when in edit mode to capture latest edits
    const markdown = editMode ? editorEl.value : currentMarkdown;
    html = await exportSingleHtml(chapterTitleEl.textContent, markdown);
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

// ---- Initial load ----
initCoursebook();

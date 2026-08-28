/**
 * app.js — Application entry point.
 * Wires together coursebook loading, theme management, icon hydration,
 * menu dropdowns, the editor, renderer, sectionNavigator, and presentation mode.
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
import { slugifyForId, resolveContentRefs } from "./core/utils.js";
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
let sectionNavigator = null;
let editMode = false;
let renderTimer = null;
let currentMarkdown = DEFAULT_CONTENT;
let suppressScrollSpy = false;
// Increments each time a programmatic scroll starts. A pending scrollend
// re-enable captures the generation it started with and only re-enables
// the scroll-spy if no newer scroll has superseded it.
let suppressScrollGeneration = 0;

/** @type {ResizeObserver | null} */
let scrollSpyResizeObserver = null;

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
  scrollSpyResizeObserver.disconnect();
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

  // Re-observe the content area now that the new sections are in the DOM.
  scrollSpyResizeObserver.observe(contentEl);

  // Enhance content (Shiki, KaTeX, copy buttons, Mermaid)
  await ContentEnhancer.enhance(contentEl);

  // Set up sectionNavigator for presentation mode
  sectionNavigator = new SectionNavigator(contentEl, previewPane);
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

  sectionNavigator = new SectionNavigator(contentEl, previewPane);
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

/** How far from the top of the preview pane a scrolled-to element should sit. */
const SCROLL_OFFSET = 80;

/** When within this many pixels of the content bottom, force the last heading. */
const BOTTOM_THRESHOLD = 100;

/** How close the actual scroll top must be to the expected target to use the
    intended heading instead of recomputing from position. */
const SCROLL_TARGET_TOLERANCE = 4;

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
  // Bump the generation and then arm the scroll-spy guard so the two are
  // set atomically. A stale re-enable from a superseded scroll will see a
  // different generation and be ignored.
  const gen = ++suppressScrollGeneration;
  suppressScrollSpy = true;
  previewPane.scrollTop = scrollTopForElement(el);
  // Instant scrolls jump immediately, so a single rAF is enough to let the
  // DOM settle before re-enabling the spy. Polling is not needed here.
  requestAnimationFrame(() => {
    // Ignore this re-enable if a newer scroll has already started.
    if (gen !== suppressScrollGeneration) return;
    cancelScheduledScrollSpyUpdate();
    suppressScrollSpy = false;
    // Chapter/landing switches already set currentChapterIdx and call
    // sectionNavigator.setup(); do not let the scroll-spy override the
    // sectionNavigator's current heading after the jump.
    syncScrollSpyAfterScroll({ lockNavigator: true });
  });
}

/** Beyond this many pixels, programmatic scrolls jump instantly. */
const LONG_SCROLL_DISTANCE = 3000;

/**
 * Scroll to an element smoothly, suppressing scroll-spy during the animation.
 * Very long jumps scroll instantly: Chrome's smooth scrolling can take well
 * over a second for thousands of pixels, which reads as a hang.
 * @param {HTMLElement} el
 */
function scrollToElSmooth(el) {
  const maxTop = Math.max(0, previewPane.scrollHeight - previewPane.clientHeight);
  const targetTop = Math.min(Math.max(scrollTopForElement(el), 0), maxTop);
  const distance = Math.abs(targetTop - previewPane.scrollTop);
  // Arm the scroll-spy guard and start the re-enable monitor before the
  // scroll begins. Smooth animations need polling because they can take
  // longer than one frame and may not fire a scrollend event. This shares
  // the same generation guard as scrollToElInstant.
  suppressScrollSpyUntilDone({ activeHeading: el, expectedTop: targetTop });
  previewPane.scrollTo({
    top: targetTop,
    behavior: distance > LONG_SCROLL_DISTANCE ? "auto" : "smooth",
  });
}

/**
 * Suppress scroll-spy while a programmatic scroll is in progress and
 * re-enable it once the scroll settles. scrollend is used when available;
 * the polling fallback below also covers browsers without scrollend and
 * the case where no scrolling occurs at all (scrollend never fires then).
 * Polling is used instead of a fixed timeout so long smooth animations stay
 * suppressed until they truly end — waking mid-animation would let the spy
 * highlight intermediate headings and clobber the user's selection.
 *
 * @param {{ lockNavigator?: boolean, activeHeading?: HTMLElement | null, expectedTop?: number | null }} [opts]
 */
function suppressScrollSpyUntilDone({
  lockNavigator = false,
  activeHeading = null,
  expectedTop = null,
} = {}) {
  // Increment the generation and arm the guard atomically. Every re-enable
  // path below checks the generation so a stale re-enable from an earlier,
  // superseded scroll cannot turn the spy back on.
  const gen = ++suppressScrollGeneration;
  suppressScrollSpy = true;
  let done = false;
  let quietPolls = 0;
  let started = false;
  let lastTop = previewPane.scrollTop;
  let pollTimer = null;
  let noStartTimer = null;
  let capTimer = null;

  function reenable() {
    if (done) return;
    // Stale re-enable from a superseded scroll has a different generation
    // and must not turn the spy back on.
    if (gen !== suppressScrollGeneration) return;
    done = true;
    clearInterval(pollTimer);
    clearTimeout(noStartTimer);
    clearTimeout(capTimer);
    previewPane.removeEventListener("scrollend", reenable);
    cancelScheduledScrollSpyUpdate();
    suppressScrollSpy = false;
    syncScrollSpyAfterScroll({ lockNavigator, activeHeading, expectedTop });
  }

  pollTimer = setInterval(() => {
    const top = previewPane.scrollTop;
    if (top !== lastTop) {
      lastTop = top;
      started = true;
      quietPolls = 0;
      return;
    }
    // Still for two consecutive polls after movement: the animation ended.
    if (started && ++quietPolls >= 2) reenable();
  }, 100);
  // A scroll that never starts (already at the target) settles quickly.
  noStartTimer = setTimeout(() => {
    if (!started) reenable();
  }, 250);
  // Absolute cap in case of a stuck animation.
  capTimer = setTimeout(reenable, 4000);

  if ("onscrollend" in previewPane) {
    previewPane.addEventListener("scrollend", reenable, { once: true });
  }
}

/**
 * Run a sectionNavigator action (next/prev/first/last) and suppress the scroll-spy
 * while the resulting smooth scroll is in progress. Re-enables spy when the
 * scroll animation ends, settling on the sectionNavigator's heading so the TOC
 * agrees with it.
 *
 * @param {Function} action - A no-argument function that performs the navigation.
 * @param {boolean} [syncVisual] - Whether to visually highlight the target heading.
 *   When false, the scroll-spy is not locked to the sectionNavigator.
 */
function withNavigatorScroll(action, syncVisual = true) {
  if (!sectionNavigator) return;
  const before = sectionNavigator.currentIdx;
  action();
  if (sectionNavigator.currentIdx === before) return;
  suppressScrollSpyUntilDone({
    lockNavigator: syncVisual,
    activeHeading: sectionNavigator.current,
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
function showLandingPage({ skipHash = false } = {}) {
  if (!coursebook) return;
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
  if (section) scrollToElInstant(section);
}

/**
 * Scroll to a chapter section by index.
 */
function loadChapterByIdx(idx, { skipHash = false } = {}) {
  if (!coursebook || idx < 0 || idx >= coursebook.chapters.length) return;

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
  if (section) scrollToElInstant(section);
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
      scrollToElSmooth(target);
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
    const itemIdx = tocItems.indexOf(item);
    btn.addEventListener("click", () => {
      if (headingEl) {
        // Highlight immediately for instant feedback. The scroll-spy stays
        // consistent with this choice: the scroll below settles the heading
        // above the activation line, so a re-computation picks the same
        // item — no lock needed.
        const items = tocContainer.querySelectorAll(".toc-item");
        items.forEach((el, i) => el.classList.toggle("active", i === itemIdx));
        scrollToElSmooth(headingEl);
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

// ---- Scroll spy (position-based) ----
//
// The active heading is the LAST heading (in document order) whose top has
// scrolled up to the activation line near the top of the preview pane.
// This agrees with programmatic navigation in the common case: TOC clicks
// land their target at SCROLL_OFFSET (80px) and sectionNavigator moves land at the
// heading's scroll-margin-top (20px) — both above the line. Clamped
// landings (targets near the top/bottom of the scroll range) are handled by
// settling programmatic scrolls on their INTENDED heading instead of
// re-computing from the position (see syncScrollSpyAfterScroll), so no
// click-lock state is needed anywhere.
//
// Edge cases:
//   - Near the bottom of a scrollable chapter: force the last heading so
//     short final sections are always reachable.
//   - Above the first heading (chapter intro): no active TOC item; the
//     sectionNavigator keeps its current heading.
//   - Programmatic scrolls suppress updates while animating; a stale
//     scrollend re-enable from a superseded scroll is discarded by
//     generation counter.

/** A heading at or above this many pixels from the pane top is "active". */
const ACTIVATION_LINE = 120;

/** @type {HTMLElement[]} headings of the active section, in document order */
let scrollSpyHeadings = [];
let scrollSpyFrame = null;

/**
 * Store the headings to track and run one update pass.
 * Replaces any previous heading set.
 * @param {HTMLElement[]} headings
 */
function setupScrollSpy(headings) {
  scrollSpyHeadings = headings;
  scrollSpyUpdate();
}

/**
 * Set up the scroll spy for the currently active chapter section.
 * Called after chapter switches, initial render, and content edits.
 */
function setupScrollSpyForCurrentChapter() {
  if (!coursebook) {
    // Standalone mode — track all headings in the content
    setupScrollSpy(Array.from(contentEl.querySelectorAll("h2, h3")));
    return;
  }
  const sections = Array.from(contentEl.querySelectorAll(".coursebook-section"));
  const activeSection = sections[currentChapterIdx + 1] ?? sections[0];
  if (activeSection) {
    setupScrollSpy(Array.from(activeSection.querySelectorAll("h2, h3")));
  }
}

/**
 * Compute the active heading from the current scroll position and update
 * the TOC + sectionNavigator. This is the user-driven update path (scroll,
 * resize); programmatic scrolls settle on their intended heading instead
 * (see syncScrollSpyAfterScroll). Cheap (a few rect reads over ~dozens of
 * headings), idempotent, and safe to call on every frame.
 */
function scrollSpyUpdate({ lockNavigator = false } = {}) {
  if (suppressScrollSpy) return;
  if (scrollSpyHeadings.length === 0) return;

  const { scrollTop, clientHeight, scrollHeight } = previewPane;

  // Near the bottom of a scrollable chapter: force the last heading so
  // short final sections are always reachable (the last heading may never
  // reach the activation line because there isn't enough content below it).
  if (scrollHeight > clientHeight) {
    const nearBottom = scrollTop + clientHeight >= scrollHeight - BOTTOM_THRESHOLD;
    if (nearBottom) {
      scrollSpySetActive(scrollSpyHeadings[scrollSpyHeadings.length - 1], {
        lockNavigator,
      });
      return;
    }
  }

  // Pick the last heading whose top is at or above the activation line.
  // Heading tops are monotonically non-decreasing in document order, so we
  // can stop at the first heading below the line.
  const paneTop = previewPane.getBoundingClientRect().top;
  let active = null;
  for (const heading of scrollSpyHeadings) {
    if (heading.getBoundingClientRect().top - paneTop <= ACTIVATION_LINE) {
      active = heading;
    } else {
      break;
    }
  }

  scrollSpySetActive(active, { lockNavigator });
}

/**
 * Set the active heading: update TOC highlight, sectionNavigator, and overlay.
 * Pass null to clear the TOC highlight (chapter intro is on screen);
 * the sectionNavigator keeps its current heading in that case.
 * @param {HTMLElement | null} heading
 * @param {{ lockNavigator?: boolean }} [opts]
 */
function scrollSpySetActive(heading, { lockNavigator = false } = {}) {
  const idx = heading ? scrollSpyHeadings.indexOf(heading) : -1;

  // Update TOC highlight
  const tocContainer = getCurrentChapterToc();
  if (tocContainer) {
    const items = tocContainer.querySelectorAll(".toc-item");
    items.forEach((item, i) => item.classList.toggle("active", i === idx));
  }

  if (!heading) return;

  // Update sectionNavigator: walk up to the parent H2 (sectionNavigator tracks H1/H2).
  // Skip when lockNavigator is true (keyboard nav) — the sectionNavigator's
  // current heading was set explicitly and shouldn't be overridden.
  if (sectionNavigator && !lockNavigator) {
    let h2 = heading;
    for (let i = idx; i >= 0; i--) {
      if (scrollSpyHeadings[i].tagName === "H2") {
        h2 = scrollSpyHeadings[i];
        break;
      }
    }
    const navIdx = sectionNavigator.headings.indexOf(h2);
    if (navIdx >= 0) {
      sectionNavigator.setCurrent(navIdx);
    }
  }
}

// Scroll-driven updates. The rAF throttle coalesces bursts of scroll events
// into one update per frame; the ResizeObserver catches layout changes that
// happen without scrolling (async Mermaid/KaTeX rendering, editor re-renders,
// window resizes).
function scheduleScrollSpyUpdate() {
  if (scrollSpyFrame !== null) return;
  scrollSpyFrame = requestAnimationFrame(() => {
    scrollSpyFrame = null;
    scrollSpyUpdate();
  });
}

/**
 * Drop a pending spy update scheduled from scroll events that arrived while
 * a programmatic scroll was still suppressed. Without this, the frame fires
 * right after the scroll settles and its position re-computation can stomp
 * the intended heading (e.g. near the bottom, where the rule forces the
 * last heading).
 */
function cancelScheduledScrollSpyUpdate() {
  if (scrollSpyFrame !== null) {
    cancelAnimationFrame(scrollSpyFrame);
    scrollSpyFrame = null;
  }
}

previewPane.addEventListener("scroll", scheduleScrollSpyUpdate, { passive: true });

scrollSpyResizeObserver = new ResizeObserver(() => {
  if (!suppressScrollSpy) scheduleScrollSpyUpdate();
});
scrollSpyResizeObserver.observe(contentEl);

/**
 * Sync the scroll spy after a programmatic scroll settles (used by
 * scrollToElInstant, scrollToElSmooth, and keyboard navigation).
 *
 * When the scroll had an intended heading (TOC click, hash navigation,
 * sectionNavigator move), settle on THAT heading: clamped landings near the top or
 * bottom of the scroll range place the heading outside the activation line,
 * so a position re-computation would immediately override the user's
 * navigation. If the user interrupted the scroll (position off target), or
 * there was no intended heading (chapter switches), fall back to a
 * position-based update.
 *
 * @param {{ lockNavigator?: boolean, activeHeading?: HTMLElement | null, expectedTop?: number | null }} [opts]
 */
function syncScrollSpyAfterScroll({
  lockNavigator = false,
  activeHeading = null,
  expectedTop = null,
} = {}) {
  if (lockNavigator && sectionNavigator) {
    sectionNavigator.syncVisual();
  }
  const onTarget =
    expectedTop == null ||
    Math.abs(previewPane.scrollTop - expectedTop) <= SCROLL_TARGET_TOLERANCE;
  if (activeHeading && document.contains(activeHeading) && onTarget) {
    scrollSpySetActive(activeHeading, { lockNavigator });
  } else {
    scrollSpyUpdate({ lockNavigator });
  }
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

        // Re-setup scroll spy for the new heading elements
        setupScrollSpyForCurrentChapter();
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
      withNavigatorScroll(() => sectionNavigator?.next({ syncVisual: true }));
      break;
    case " ":
    case "PageDown":
      e.preventDefault();
      withNavigatorScroll(() => sectionNavigator?.next({ syncVisual: false }));
      break;
    case "ArrowLeft":
      e.preventDefault();
      withNavigatorScroll(() => sectionNavigator?.prev({ syncVisual: true }));
      break;
    case "PageUp":
      e.preventDefault();
      withNavigatorScroll(() => sectionNavigator?.prev({ syncVisual: false }));
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
      withNavigatorScroll(() => sectionNavigator?.first({ syncVisual: false }));
      break;
    case "End":
      e.preventDefault();
      withNavigatorScroll(() => sectionNavigator?.last({ syncVisual: false }));
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
  coursebook = { ...parsed, markdown: parentMarkdown };
  chapterPaneTitle.textContent = coursebook.title;
  chapterTitleEl.textContent = coursebook.title;
  chapterNav.classList.remove("hidden");

  // If this coursebook wasn't loaded with write access (e.g. webkitdirectory
  // fallback or URL-loaded coursebook), keep save disabled.
  if (!localFileStore?.dirHandle) {
    dirtyPaths = new Set();
    updateSaveState();
  }

  await preloadSectionHeadings();
  buildChapterList();
  await renderAllChapters();

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

/**
 * Write all dirty .md files back to disk using the recorded file handles.
 * The landing page is section 0; each chapter is section idx+1.
 * When the coursebook wasn't opened with write access, explains how to
 * enable saving instead.
 * @returns {Promise<number>} Number of files saved.
 */
async function saveAll() {
  if (!localFileStore?.dirHandle) {
    showToast(
      "This coursebook was opened read-only. " +
        "Use Chrome/Edge with File System Access API enabled and grant write permission to save.",
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

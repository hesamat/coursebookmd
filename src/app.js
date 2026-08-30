/**
 * app.js — Application entry point.
 * Wires together coursebook loading, theme management, icon hydration,
 * menu dropdowns, the editor, renderer, sectionNavigator, and presentation mode.
 */
import { MarkdownEditor } from "./editor/markdown-editor.js";
import { ContentEnhancer } from "./renderer/content-enhancer.js";
import { LinkPreview, resolvePreview, extractLinks } from "./renderer/link-preview.js";
import { createUndoTrail } from "./core/undo-trail.js";
import { ThemeManager, PALETTES } from "./core/theme-manager.js";
import { hydrateIcons } from "./core/icon.js";
import {
  computeSectionNumbersForSections,
  extractHeadingsFromMarkdown,
} from "./core/section-numbering.js";
import { slugifyForId, isMacPlatform, isShortcut } from "./core/utils.js";
import { formatLocationHash } from "./core/navigation.js";
import { flashIndexedTerm } from "./core/indexed-terms.js";
import { resolveSourceLine, SOURCE_TARGET_SELECTOR } from "./core/source-jump.js";
import { createScrollSpy } from "./core/scroll-spy.js";
import {
  loadCoursebook,
  loadChapter,
  parseCoursebook,
  getBaseDir,
  getChapterTitle,
  resolveLink,
  buildChapterSlugMap,
  assignChapterSlugs,
  chapterSectionSlug,
} from "./core/coursebook-loader.js";
import { findBrokenLinks } from "./core/link-checker.js";
import {
  exportCoursebookHtml,
  exportSingleHtml,
} from "./renderer/coursebook-exporter.js";
import { state, DEFAULT_CONTENT } from "./state.js";
import { createMenuController } from "./controllers/menu-controller.js";
import { createChapterRenderer } from "./controllers/chapter-renderer.js";
import { createEditorController } from "./controllers/editor-controller.js";
import { createFileWatcher, parentChaptersChanged } from "./controllers/file-watcher.js";

// ---- State ----
// The single mutable state object lives in state.js. The undo trail and
// scroll spy are constructed here because state.js is the bottom layer and
// imports nothing.
state.undoTrail = createUndoTrail();

// ---- Controllers ----
// The chapter renderer must flush the editor before navigating, and the
// editor controller re-renders through the chapter renderer; `wired` binds
// those references after construction so the controllers never import each
// other.
const wired = {};

// ---- Scroll spy ----
// The engine (suppression guard, TOC highlighting, heading selection) lives
// in core/scroll-spy.js and is shared with the export runtime. Only the
// heading selection (see setupScrollSpyForCurrentChapter in the chapter
// renderer) is app-specific.
state.scrollSpy = createScrollSpy({
  pane: state.previewPane,
  resizeTarget: state.contentEl,
  getTocContainer: () => wired.chapters.getCurrentChapterToc(),
  getNavigator: () => state.sectionNavigator,
  getDefaultLock: () => document.body.classList.contains("presenting"),
});
state.scrollSpy.attach();

const chapterRenderer = createChapterRenderer({
  state,
  beforeNavigate: () => wired.editor.flushCurrentEditorChanges(),
  resolveLocalImages,
  updateOverlay,
  syncEditorWithCurrent: () => wired.editor.syncEditorWithCurrent(),
  updateActiveChapter: (...args) => wired.menu.updateActiveChapter(...args),
  updateChapterNav: (...args) => wired.menu.updateChapterNav(...args),
  syncIndexNavItem: (...args) => wired.menu.syncIndexNavItem(...args),
});
const menuController = createMenuController({
  state,
  navigate: {
    loadChapterByIdx: chapterRenderer.loadChapterByIdx,
    showLandingPage: chapterRenderer.showLandingPage,
    showIndexPage: chapterRenderer.showIndexPage,
  },
});
wired.menu = menuController;
wired.chapters = chapterRenderer;

// Undo-trail keys map to sections: "0" is the landing page, "1".."N" are the
// chapters in order.
function navigateToSection(key) {
  if (key === "0") return chapterRenderer.showLandingPage();
  return chapterRenderer.loadChapterByIdx(Number(key) - 1);
}

const editorController = createEditorController({
  state,
  MarkdownEditor,
  markCurrentDirty,
  refreshCurrentSection: (markdown) => refreshFromEditor(markdown),
  renderSingleMarkdown: chapterRenderer.renderSingleMarkdown,
  navigateToSection,
});
wired.editor = editorController;

// ---- Theme ----
ThemeManager.initTheme();

/**
 * Re-highlight code blocks when the theme changes.
 * Shiki bakes colors into inline styles, so a theme switch requires
 * re-running the highlighter with the new theme.
 */
async function onThemeChange() {
  if (state.contentEl) {
    await ContentEnhancer.rehighlight(state.contentEl);
  }
}

state.themeToggleBtn.addEventListener("click", async () => {
  ThemeManager.toggleTheme();
  await onThemeChange();
});

// Settings modal theme toggle (mirrors the topbar toggle)
state.settingsThemeToggle.addEventListener("click", async () => {
  ThemeManager.toggleTheme();
  await onThemeChange();
});

// ---- Settings modal ----
function openSettings() {
  state.settingsModal.classList.remove("hidden");
  updateActivePalette();
}

function closeSettings() {
  state.settingsModal.classList.add("hidden");
}

function updateActivePalette() {
  const current = ThemeManager.getPalette();
  for (const palette of PALETTES) {
    const btn = document.querySelector(`.settings-palette[data-palette="${palette}"]`);
    if (btn) btn.classList.toggle("active", palette === current);
  }
}

state.settingsBackdrop.addEventListener("click", closeSettings);
state.settingsCloseBtn.addEventListener("click", closeSettings);

// Open Folder modal listeners
state.openFolderBackdrop.addEventListener("click", closeOpenFolderModal);
state.openFolderCloseBtn.addEventListener("click", closeOpenFolderModal);
state.openFolderSelectBtn.addEventListener("click", selectCoursebookFolder);

// Palette selection in settings
const paletteButtons = [
  state.settingsPaletteWarm,
  state.settingsPaletteIndigo,
  state.settingsPaletteBlue,
];
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
  if (state.localFileStore.dirHandle) {
    const { file } = await readFileFromDirectory(state.localFileStore.dirHandle, relPath);
    return file;
  }
  if (state.localFileStore.fileMap) {
    const file = state.localFileStore.fileMap.get(relPath);
    if (file) return file;
    const lowerFile = state.localFileStore.fileMapLower?.get(relPath.toLowerCase());
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
  if (!state.localFileStore) return;

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
      state.localImageUrls.push(url);
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

function updateOverlay(idx, heading) {
  if (!state.sectionNavigator || !state.coursebook) return;
  const current = heading?.textContent?.trim() || state.sectionNavigator.currentText;
  const next = state.sectionNavigator.nextText;
  const nextChapterTitle =
    state.currentChapterIdx === state.coursebook.chapters.length - 1
      ? null
      : state.currentChapterIdx === -1
        ? state.coursebook.chapters[0]?.title
        : state.coursebook.chapters[state.currentChapterIdx + 1]?.title;
  if (next) {
    state.overlayNext.textContent = "Next: " + next;
  } else if (nextChapterTitle) {
    state.overlayNext.textContent = "Next chapter: " + nextChapterTitle;
  } else {
    state.overlayNext.textContent = "End of coursebook";
  }
  state.overlayCurrent.textContent = current;
  state.overlayProgress.textContent = idx + 1 + " / " + state.sectionNavigator.count;
}

// ---- Coursebook loading ----
async function initCoursebook() {
  const params = new URLSearchParams(location.search);
  const requestedCoursebook = params.get("coursebook") || guessCoursebookPath();

  // URL-loaded coursebooks have no write access — never inherit a stale
  // store from a previously opened local coursebook.
  state.localFileStore = null;
  state.dirtyPaths = new Set();
  // A new coursebook is a new editing session: cached editor states from a
  // previous coursebook would have stale documents/history.
  editorController.clearEditorStates();

  try {
    state.coursebook = await loadCoursebookFrom(requestedCoursebook);
    state.chapterPaneTitle.textContent = state.coursebook.title;
    state.chapterTitleEl.textContent = state.coursebook.title;

    // Seed the link preview cache from any previously built previews.json.
    state.linkPreviews = await loadPreviewsForCoursebook(state.coursebook.parentPath);
    LinkPreview.setPreviews(state.linkPreviews);
    void preloadMissingLinkPreviews(state.coursebook);

    // Pre-load all chapter markdowns and heading data so section numbering is
    // continuous across the whole coursebook.
    await preloadSectionHeadings();

    menuController.buildChapterList();
    // Render all chapters as a continuous page
    await chapterRenderer.renderAllChapters();

    updateSaveState();
    await reportLinkIssues();

    // If the URL has a hash, navigate to that section; otherwise start at top
    if (location.hash) {
      await chapterRenderer.navigateFromHash();
    } else {
      state.currentChapterIdx = -1;
      menuController.updateActiveChapter();
      menuController.updateChapterNav();
      chapterRenderer.updateVisibleSection();
      if (state.sectionNavigator) {
        state.sectionNavigator.setup();
        chapterRenderer.setupScrollSpyForCurrentChapter();
        updateOverlay(0);
      }
      state.previewPane.scrollTop = 0;
    }
  } catch (e) {
    // No coursebook.md found — fall back to standalone mode
    console.warn("Coursebook not loaded, using standalone mode:", e.message);
    state.coursebook = null;
    editorController.clearEditorStates();
    state.sectionMarkdowns = [];
    state.sectionHeadings = [];
    state.sectionNumbers = [];
    state.chapterListEl.innerHTML = "";
    state.chapterPaneTitle.textContent = "Chapters";
    state.chapterTitleEl.textContent = "CoursebookMD";
    state.chapterNav.classList.add("hidden");
    // Clear any stale chapter hash from a previously loaded coursebook
    if (location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    state.linkPreviews = {};
    LinkPreview.setPreviews(state.linkPreviews);
    await chapterRenderer.renderSingleMarkdown(DEFAULT_CONTENT);
  }

  LinkPreview.enhance(state.contentEl);
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
  if (!state.coursebook) return;

  // Parent landing page is section 0
  state.sectionMarkdowns = [state.coursebook.markdown];
  state.sectionHeadings = [extractHeadingsFromMarkdown(state.coursebook.markdown)];

  // Chapters are sections 1..N. Use allSettled so a single missing chapter
  // does not prevent the whole coursebook from loading.
  // If chapter.markdown is pre-loaded (e.g. from a local directory), use it
  // directly instead of fetching.
  const results = await Promise.allSettled(
    state.coursebook.chapters.map((chapter) =>
      chapter.markdown !== undefined
        ? Promise.resolve(chapter.markdown)
        : loadChapter(chapter.resolvedPath),
    ),
  );
  for (const result of results) {
    if (result.status === "fulfilled") {
      state.sectionMarkdowns.push(result.value);
      state.sectionHeadings.push(extractHeadingsFromMarkdown(result.value));
    } else {
      state.sectionMarkdowns.push(null);
      state.sectionHeadings.push([]);
    }
  }

  state.sectionNumbers = computeSectionNumbersForSections(state.sectionHeadings, {
    skipFirst: true,
  });
}

window.addEventListener("hashchange", () => chapterRenderer.navigateFromHash());

state.prevChapterBtn.addEventListener("click", menuController.goPrevChapter);
state.nextChapterBtn.addEventListener("click", menuController.goNextChapter);

// ---- Table of Contents ----

// ---- TOC collapse ----
state.tocToggleBtn.addEventListener("click", () => {
  state.tocPane.classList.toggle("collapsed");
  const collapsed = state.tocPane.classList.contains("collapsed");
  state.tocToggleBtn.setAttribute(
    "aria-label",
    collapsed ? "Expand contents" : "Collapse contents",
  );
  state.tocToggleBtn.setAttribute("title", collapsed ? "Expand" : "Collapse");
});

state.toggleEditBtn.addEventListener("click", async () =>
  editorController.setEditMode(!state.editMode),
);
state.menuToggleEditBtn.addEventListener("click", async () => {
  await editorController.setEditMode(!state.editMode);
  menuController.closeMenu();
});

// ---- Editor pane resize ----
editorController.setupEditorResizer();

// ---- Menu dropdown ----
state.menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  menuController.toggleMenu();
});

document.addEventListener("click", (e) => {
  if (!state.menuDropdown.classList.contains("hidden")) {
    if (!state.menuDropdown.contains(e.target) && e.target !== state.menuBtn) {
      menuController.closeMenu();
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!state.settingsModal.classList.contains("hidden")) {
      closeSettings();
    } else if (!state.menuDropdown.classList.contains("hidden")) {
      menuController.closeMenu();
    }
  }
});

// ---- Presentation mode ----
function enterPresent() {
  document.body.classList.add("presenting");
  if (state.sectionNavigator?.spotlight) document.body.classList.add("spotlight");

  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }

  // The double requestAnimationFrame waits for the visual mode change to
  // apply (CSS display:none on the app chrome) before scrolling, so the
  // scroll position is computed against the final layout.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      state.previewPane.scrollTo({ top: 0, behavior: "auto" });
      state.sectionNavigator?.setup();
      chapterRenderer.setupScrollSpyForCurrentChapter();
      updateOverlay(state.sectionNavigator?.currentIdx, state.sectionNavigator?.current);
    });
  });
}

function exitPresent() {
  document.body.classList.remove("presenting", "spotlight");
  state.sectionNavigator?.clearHighlight();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

state.presentBtn.addEventListener("click", enterPresent);
state.toggleFullscreenBtn.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});

// Save shortcut — intercept before the editor guard so it works while typing.
document.addEventListener("keydown", (e) => {
  const saveShortcut = (e.metaKey && isMacPlatform) || (e.ctrlKey && !isMacPlatform);
  if (saveShortcut && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    if (state.localFileStore && state.dirtyPaths.size > 0) {
      saveAll();
    }
  }
});

menuController.updateShortcutTooltips();

document.addEventListener("keydown", async (e) => {
  // Don't intercept when typing in the editor, unless the user is using the
  // edit-mode shortcut to close the editor while it has focus.
  const inEditor = state.editorEl.contains(e.target);
  const closingEditor =
    inEditor && state.editMode && (e.key === "e" || e.key === "E") && isShortcut(e);
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
        await editorController.setEditMode(!state.editMode);
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
        state.sectionNavigator?.toggleSpotlight();
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
    !state.settingsModal.classList.contains("hidden") ||
    !state.openFolderModal.classList.contains("hidden") ||
    !state.menuDropdown.classList.contains("hidden");
  const inPreview =
    presenting ||
    state.previewPane.contains(e.target) ||
    state.tocPane.contains(e.target) ||
    e.target === document.body;
  if (isTextInput || modalOpen || !inPreview) return;

  // macOS: Command+Up/Down scrolls to top/bottom of the current chapter.
  if (isMacPlatform && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      state.previewPane.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.previewPane.scrollTo({
        top: state.previewPane.scrollHeight,
        behavior: "smooth",
      });
      return;
    }
  }

  const SCROLL_STEP = Math.max(120, Math.round(state.previewPane.clientHeight * 0.5));

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
      state.scrollSpy.withNavigatorScroll(() => state.sectionNavigator?.next(), true);
      break;
    case " ":
    case "PageDown":
      e.preventDefault();
      state.scrollSpy.withNavigatorScroll(
        () => state.sectionNavigator?.next({ syncVisual: false }),
        false,
      );
      break;
    case "ArrowLeft":
      e.preventDefault();
      state.scrollSpy.withNavigatorScroll(() => state.sectionNavigator?.prev(), true);
      break;
    case "PageUp":
      e.preventDefault();
      state.scrollSpy.withNavigatorScroll(
        () => state.sectionNavigator?.prev({ syncVisual: false }),
        false,
      );
      break;
    case "ArrowUp":
      e.preventDefault();
      state.previewPane.scrollBy({ top: -SCROLL_STEP, behavior: "smooth" });
      break;
    case "ArrowDown":
      e.preventDefault();
      state.previewPane.scrollBy({ top: SCROLL_STEP, behavior: "smooth" });
      break;
    case "Home":
      e.preventDefault();
      state.scrollSpy.withNavigatorScroll(
        () => state.sectionNavigator?.first({ syncVisual: false }),
        false,
      );
      break;
    case "End":
      e.preventDefault();
      state.scrollSpy.withNavigatorScroll(
        () => state.sectionNavigator?.last({ syncVisual: false }),
        false,
      );
      break;
    case "s":
    case "S":
      if (!presenting) break;
      e.preventDefault();
      state.sectionNavigator?.toggleSpotlight();
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

// ---- Live preview watcher ----
// Created before the file-operation flows that trigger its first poll; the
// apply/notify functions it references are hoisted and only run later.
const fileWatcher = createFileWatcher({
  state,
  readSectionFile,
  applySection: applyExternalSectionChange,
  applyCoursebook: reloadCoursebookFromDisk,
  notifySkipped: (dirtyPath) =>
    showToast(
      `${dirtyPath} changed on disk, but it has unsaved edits here — keeping your edits. ` +
        "Save to overwrite the file, or undo your edits to pick up the file's version.",
    ),
  notifyUnreadable: (readPath) =>
    showToast(
      `${readPath} is missing or unreadable — live preview is paused for it until it returns.`,
    ),
});

// File System Access handles report external writes on re-read; there is no
// watch API, so poll while a coursebook is open. Hidden tabs skip polling.
setInterval(() => {
  fileWatcher.poll().catch((e) => console.warn("Live preview poll failed:", e));
}, 2000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    fileWatcher.poll().catch((e) => console.warn("File watch poll failed:", e));
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
      state.localFileStore = { fileMap, fileMapLower, parentPath: "coursebook.md" };
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
    state.currentMarkdown = text;
    state.linkPreviews = {};
    LinkPreview.setPreviews(state.linkPreviews);
    // Opening a new file is a new editing session for the standalone key.
    editorController.clearEditorStates();
    state.markdownEditor?.setValue(text, { suppressOnChange: true });
    if (state.markdownEditor) state.currentEditorKey = "standalone";
    await chapterRenderer.renderSingleMarkdown(text);
    state.chapterTitleEl.textContent = file.name;
    // Clear chapter context when opening a standalone file
    state.coursebook = null;
    state.currentChapterIdx = -1;
    state.chapterListEl.innerHTML = "";
    state.chapterPaneTitle.textContent = "Chapters";
    state.chapterNav.classList.add("hidden");
    // Plain file inputs don't grant write access
    state.localFileStore = null;
    state.dirtyPaths = new Set();
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
  state.pendingCoursebook = { parsed, parentMarkdown, parentFileName };

  const chapterWord = parsed.chapters.length === 1 ? "chapter" : "chapters";
  state.openFolderMessage.textContent =
    `This file references ${parsed.chapters.length} ${chapterWord}. ` +
    "Select the folder that contains the chapter files to load the full coursebook. " +
    "(Tip: File → Open Coursebook Folder opens a whole coursebook in one step.)";

  state.openFolderModal.classList.remove("hidden");
}

/**
 * Handle the "Select Folder" button click from the modal.
 * Uses the File System Access API when available, falling back to
 * a webkitdirectory input.
 */
async function selectCoursebookFolder() {
  if (!state.pendingCoursebook) return;
  const { parentMarkdown, parentFileName = "coursebook.md" } = state.pendingCoursebook;
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
  state.openFolderModal.classList.add("hidden");
  state.pendingCoursebook = null;
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

  state.localFileStore = {
    dirHandle,
    handles,
    parentPath: parentFileName,
  };
  state.dirtyPaths = new Set();
  updateSaveState();

  await activateCoursebook(coursebook, coursebook.markdown);

  // Seed the watcher's baseline right away so edits saved between the
  // coursebook load and the first poll tick are detected instead of being
  // consumed as "initial state".
  fileWatcher.poll().catch((e) => console.warn("File watch poll failed:", e));
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
      state.localFileStore = { fileMap, fileMapLower, parentPath: parentFileName };
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
  if (state.editMode) await editorController.setEditMode(false);

  // New coursebook = new editing session; drop any cached editor states.
  editorController.clearEditorStates();

  state.coursebook = { ...parsed, markdown: parentMarkdown };
  state.chapterPaneTitle.textContent = state.coursebook.title;
  state.chapterTitleEl.textContent = state.coursebook.title;
  state.chapterNav.classList.remove("hidden");

  // Seed the link preview cache from any previously built previews.json.
  state.linkPreviews = await loadPreviewsForCoursebook(state.coursebook.parentPath);
  LinkPreview.setPreviews(state.linkPreviews);
  void preloadMissingLinkPreviews(state.coursebook);

  // If this coursebook wasn't loaded with write access (e.g. webkitdirectory
  // fallback or URL-loaded coursebook), keep save disabled.
  if (!state.localFileStore?.dirHandle) {
    state.dirtyPaths = new Set();
    updateSaveState();
  }

  await preloadSectionHeadings();
  menuController.buildChapterList();
  await chapterRenderer.renderAllChapters();
  await reportLinkIssues();

  state.currentChapterIdx = -1;
  menuController.updateActiveChapter();
  menuController.updateChapterNav();
  chapterRenderer.updateVisibleSection();
  state.previewPane.scrollTop = 0;
}

// ---- Save ----

/**
 * Update the save buttons' enabled state.
 * The button is enabled whenever there are unsaved changes, regardless of
 * whether the coursebook has write handles — clicking it gives feedback
 * either way (writes to disk, or explains how to enable saving).
 */
function updateSaveState() {
  const hasChanges = state.dirtyPaths.size > 0;
  state.saveBtn.disabled = !hasChanges;
  state.menuSaveBtn.disabled = !hasChanges;
}

/**
 * Mark the currently edited file as dirty so the save buttons enable.
 * Works regardless of write access so the button can give feedback.
 */
function markCurrentDirty() {
  if (!state.coursebook) return;
  const path = dirtyPathForCurrentChapter();
  if (path) {
    state.dirtyPaths.add(path);
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
  if (!state.coursebook) return null;
  if (state.currentChapterIdx === -1) {
    return state.localFileStore ? state.localFileStore.parentPath : "coursebook.md";
  }
  const chapter = state.coursebook.chapters[state.currentChapterIdx];
  return chapter.path;
}

// ---- Live preview (external file changes) ----

/**
 * Read one coursebook file fresh from disk via its directory handle.
 * Returns null when the file is missing or unreadable — the watcher treats
 * that as "temporarily gone" and stops watching the path until it returns.
 * @param {string} readPath - Path relative to the coursebook root.
 * @returns {Promise<{text: string, mtimeMs: number, size: number} | null>}
 */
async function readSectionFile(readPath) {
  if (!state.localFileStore?.dirHandle) return null;
  try {
    const { file } = await readFileFromDirectory(
      state.localFileStore.dirHandle,
      readPath,
    );
    return { text: await file.text(), mtimeMs: file.lastModified, size: file.size };
  } catch (e) {
    console.warn("Could not read file while watching for changes:", readPath, e);
    return null;
  }
}

/**
 * Apply one externally changed file (chapter or content-only coursebook.md
 * change) to app state and re-render just that section. Serialized behind
 * pending editor renders; local unsaved edits always win.
 * @param {number} sectionIdx - Section index, 0 = landing page.
 * @param {string} text - Fresh file content.
 */
async function applyExternalSectionChange(sectionIdx, text) {
  const thisOp = (async () => {
    await state.liveEditorInput;
    if (!state.coursebook || !state.localFileStore?.dirHandle) return;
    if (state.sectionMarkdowns[sectionIdx] === text) return;

    // Flush a debounced editor buffer for this section first: genuine local
    // edits become dirty and the change below is then skipped by design.
    // liveEditorInput is reset first — this op is already serialized behind
    // it, and a flush chained onto this very op would deadlock.
    if (state.currentEditorKey === String(sectionIdx)) {
      state.liveEditorInput = Promise.resolve();
      await editorController.flushCurrentEditorChanges();
      // Re-serialize later ops behind this op, so editor input during the
      // section re-render below queues up instead of interleaving with it.
      state.liveEditorInput = Promise.resolve().then(() => thisOp.catch(() => {}));
      if (state.sectionMarkdowns[sectionIdx] === text) return;
    }
    if (state.dirtyPaths.has(sectionPathFor(sectionIdx))) return;

    state.sectionMarkdowns[sectionIdx] = text;
    if (sectionIdx === 0) {
      state.coursebook.markdown = text;
    } else {
      const chapter = state.coursebook.chapters[sectionIdx - 1];
      if (chapter) chapter.markdown = text;
    }
    const renamed = syncSectionTitleFromMarkdown(sectionIdx, text);
    state.sectionHeadings[sectionIdx] = extractHeadingsFromMarkdown(text);
    state.sectionNumbers = computeSectionNumbersForSections(state.sectionHeadings, {
      skipFirst: true,
    });

    if (
      state.editMode &&
      state.markdownEditor &&
      state.currentEditorKey === String(sectionIdx)
    ) {
      state.markdownEditor.setValue(text, { suppressOnChange: true });
    }

    await chapterRenderer.refreshSectionByIndex(sectionIdx - 1, text);
    if (renamed) applyExternalTitleChange(sectionIdx - 1, renamed);
  })();

  state.liveEditorInput = thisOp.catch((e) =>
    console.warn("External change re-render failed:", e),
  );
  return state.liveEditorInput;
}

function sectionPathFor(sectionIdx) {
  if (sectionIdx === 0) return state.localFileStore.parentPath;
  return state.coursebook.chapters[sectionIdx - 1]?.path ?? "";
}

/**
 * Follow a section's # h1 title change. Titles come from a section's first
 * heading everywhere (the coursebook.md link text is only the load-time
 * fallback), so renames — typed in-app or saved externally — re-derive the
 * title. The chapter's section DOM id moves before any re-render: the
 * refresh looks sections up by the current slug, and reserving the new id
 * first makes heading ids mint exactly like a fresh load would. The new slug
 * is deduplicated against every other chapter's so duplicated titles keep
 * navigation working (matching assignChapterSlugs).
 * @param {number} sectionIdx - Section index, 0 = landing page.
 * @param {string} text - Section markdown.
 * @returns {{from: string, to: string, fromSlug?: string, toSlug?: string}|null}
 *   Rename, or null when unchanged. Slugs are present for chapter sections.
 */
function syncSectionTitleFromMarkdown(sectionIdx, text) {
  if (!state.coursebook) return null;
  const current =
    sectionIdx === 0
      ? state.coursebook.title
      : state.coursebook.chapters[sectionIdx - 1]?.title;
  if (current === undefined) return null;
  const newTitle = getChapterTitle(text, current);
  if (newTitle === current) return null;
  if (sectionIdx === 0) {
    state.coursebook.title = newTitle;
    return { from: current, to: newTitle };
  }

  const chapter = state.coursebook.chapters[sectionIdx - 1];
  const fromSlug = chapterSectionSlug(chapter);
  const used = new Set(["overview", "index"]);
  for (const other of state.coursebook.chapters) {
    if (other !== chapter) used.add(chapterSectionSlug(other));
  }
  let toSlug = slugifyForId(newTitle) || "chapter";
  let suffix = 1;
  while (used.has(toSlug)) {
    toSlug = `${slugifyForId(newTitle)}-${suffix++}`;
  }
  chapter.title = newTitle;
  chapter.slug = toSlug;
  const section = state.contentEl.querySelector(`#${CSS.escape(fromSlug)}`);
  if (section) section.id = toSlug;
  return { from: current, to: newTitle, fromSlug, toSlug };
}

/**
 * Propagate a renamed title (a section's # h1) to the chrome built from the
 * old one: sidebar list and pane header, in-content #hash links, and the top
 * bar / location hash when the section is open. The model and section id
 * were already updated by syncSectionTitleFromMarkdown.
 * @param {number} chapterIdx - Chapter index, -1 for the landing page.
 * @param {{from: string, to: string, fromSlug?: string, toSlug?: string}} rename
 */
function applyExternalTitleChange(chapterIdx, { from, to, fromSlug, toSlug }) {
  if (chapterIdx === -1) {
    state.chapterPaneTitle.textContent = to;
    if (state.currentChapterIdx === -1) {
      state.chapterTitleEl.textContent = to;
    }
    return;
  }
  const oldSlug = fromSlug ?? from;
  const newSlug = toSlug ?? to;

  // Links already rewritten to #hash form no longer match rewriteChapterLinks,
  // so remap the old slug directly; unrewritten .md links go through it.
  for (const link of state.contentEl.querySelectorAll(`a[href="#${oldSlug}"]`)) {
    link.setAttribute("href", `#${newSlug}`);
  }
  chapterRenderer.rewriteChapterLinks();

  menuController.buildChapterList();
  // buildChapterList always appends the Index entry; prune it when the
  // coursebook has no index section (same as after a full render).
  menuController.syncIndexNavItem();
  menuController.updateActiveChapter();
  menuController.updateChapterNav();
  if (state.currentChapterIdx === chapterIdx) {
    state.chapterTitleEl.textContent = `${state.coursebook.title} — ${to}`;
    chapterRenderer.updateLocationHash();
  }
}

/**
 * Debounced editor input: the section body re-renders live, and the chrome
 * derived from the section's # h1 follows (chapter title, sidebar, hash
 * links). Landing-page edits that change the coursebook structure (chapter
 * list, nav groups) rebuild the coursebook in place so the sidebar tracks
 * the editor.
 * @param {string} markdown - Current editor content.
 */
async function refreshFromEditor(markdown) {
  if (!state.coursebook) return chapterRenderer.refreshCurrentSection(markdown);
  if (state.currentChapterIdx === -1) {
    // Chapter list / nav edits rebuild the coursebook in place; the course
    // title is handled by the title sync like any other content edit.
    const chaptersChanged = parentChaptersChanged(
      markdown,
      state.localFileStore?.parentPath ?? state.coursebook.parentPath,
      state.coursebook,
    );
    if (chaptersChanged && (await rebuildCoursebookFromMarkdown(markdown))) return;
    const renamedTitle = syncSectionTitleFromMarkdown(0, markdown);
    await chapterRenderer.refreshCurrentSection(markdown);
    if (renamedTitle) applyExternalTitleChange(-1, renamedTitle);
    return;
  }
  const renamed = syncSectionTitleFromMarkdown(state.currentChapterIdx + 1, markdown);
  await chapterRenderer.refreshCurrentSection(markdown);
  if (renamed) applyExternalTitleChange(state.currentChapterIdx, renamed);
}

/**
 * Rebuild the coursebook in place from edited coursebook.md content (typed
 * in the app editor) so the sidebar and sections track structural edits
 * live. Chapter files load from the active store; a chapter whose file does
 * not exist yet renders as a placeholder section. Deliberately keeps edit
 * mode, the editor buffer, undo history, and the preview scroll position.
 * @param {string} markdown - Edited coursebook.md content.
 * @returns {Promise<boolean>} True when the coursebook was rebuilt.
 */
async function rebuildCoursebookFromMarkdown(markdown) {
  const store = state.localFileStore;
  const handles = store?.dirHandle ? new Map(store.handles) : null;
  let loadFile;
  if (handles) {
    loadFile = async (resolvedPath, sourcePath) => {
      const { file, fileHandle } = await readFileFromDirectory(
        store.dirHandle,
        resolvedPath,
      );
      if (fileHandle && sourcePath) handles.set(sourcePath, fileHandle);
      return file.text();
    };
  } else if (store?.fileMap) {
    // webkitdirectory stores hold File objects, not handles; reuse the same
    // case-insensitive lookup as the opening flow instead of network fetch.
    loadFile = async (resolvedPath) => {
      const file =
        store.fileMap.get(resolvedPath) ??
        store.fileMapLower?.get(resolvedPath.toLowerCase());
      if (!file) throw new Error("File not found.");
      return file.text();
    };
  }

  // Unsaved chapter edits survive the rebuild: keep their in-memory markdown
  // keyed by stable path and re-apply it to the newly loaded model.
  const dirtyChapters = new Map();
  state.coursebook.chapters.forEach((chapter, i) => {
    if (!chapter.path || !state.dirtyPaths.has(chapter.path)) return;
    const chapterMarkdown = state.sectionMarkdowns[i + 1];
    if (chapterMarkdown != null) {
      dirtyChapters.set(chapter.path, {
        markdown: chapterMarkdown,
        title: chapter.title,
      });
    }
  });

  const coursebook = await loadCoursebook(
    state.coursebook.parentPath,
    markdown,
    loadFile,
  );
  if (coursebook.chapters.length === 0) return false;

  if (handles) state.localFileStore.handles = handles;
  state.coursebook = coursebook;
  state.sectionMarkdowns = [
    markdown,
    ...coursebook.chapters.map((chapter) => chapter.markdown ?? null),
  ];
  const droppedDirtyTitles = [];
  for (const [path, dirty] of dirtyChapters) {
    const idx = coursebook.chapters.findIndex((chapter) => chapter.path === path);
    if (idx === -1) {
      // The structural edit removed a chapter that had unsaved edits —
      // dropped deliberately, but not silently.
      state.dirtyPaths.delete(path);
      droppedDirtyTitles.push(dirty.title);
      continue;
    }
    state.sectionMarkdowns[idx + 1] = dirty.markdown;
    coursebook.chapters[idx].markdown = dirty.markdown;
    // The preserved content's h1 is the displayed title (link text is only
    // the load-time fallback).
    coursebook.chapters[idx].title = getChapterTitle(
      dirty.markdown,
      coursebook.chapters[idx].title,
    );
  }
  if (droppedDirtyTitles.length > 0) {
    showToast(
      `Removed ${droppedDirtyTitles.length === 1 ? "chapter" : "chapters"} ` +
        `${droppedDirtyTitles.map((title) => `"${title}"`).join(", ")} ` +
        "had unsaved edits — they were discarded.",
    );
  }
  assignChapterSlugs(coursebook.chapters);
  state.sectionHeadings = state.sectionMarkdowns.map((sectionMarkdown) =>
    extractHeadingsFromMarkdown(sectionMarkdown ?? ""),
  );
  state.sectionNumbers = computeSectionNumbersForSections(state.sectionHeadings, {
    skipFirst: true,
  });

  menuController.buildChapterList();
  menuController.syncIndexNavItem();
  await chapterRenderer.renderAllChapters();
  menuController.updateActiveChapter();
  menuController.updateChapterNav();
  chapterRenderer.updateVisibleSection();
  if (state.sectionNavigator) {
    state.sectionNavigator.setup();
    chapterRenderer.setupScrollSpyForCurrentChapter();
    updateOverlay(0);
  }
  return true;
}

/**
 * Reload the whole coursebook after a structural coursebook.md change
 * (chapter added/removed/renamed). Keeps the viewer on the same section
 * when it still exists.
 * @param {string} parentMarkdown
 */
async function reloadCoursebookFromDisk(parentMarkdown) {
  if (!state.localFileStore?.dirHandle) return;
  if (state.dirtyPaths.size > 0) {
    showToast(
      "coursebook.md changed on disk, but there are unsaved edits — " +
        "save or revert them, then use File → Open Coursebook Folder to reload.",
    );
    return;
  }

  const prevResolvedPath =
    state.currentChapterIdx >= 0
      ? state.coursebook.chapters[state.currentChapterIdx]?.resolvedPath
      : null;
  const prevScrollTop = state.previewPane.scrollTop;

  const parsed = parseCoursebook(parentMarkdown, state.localFileStore.parentPath);
  if (parsed.chapters.length === 0) {
    showToast(
      "The changed coursebook.md has no chapters — keeping the loaded coursebook.",
    );
    return;
  }

  await loadCoursebookFromDirectoryHandle(
    parentMarkdown,
    state.localFileStore.dirHandle,
    state.localFileStore.parentPath,
  );

  // Restore the previously visible section when it still exists.
  if (prevResolvedPath === null) {
    state.previewPane.scrollTop = 0;
    return;
  }
  const idx = state.coursebook.chapters.findIndex(
    (chapter) => chapter.resolvedPath === prevResolvedPath,
  );
  if (idx >= 0) {
    await chapterRenderer.loadChapterByIdx(idx, { skipHash: true });
    state.previewPane.scrollTop = prevScrollTop;
  }
}

// ---- Link validation ----

/**
 * Normalized set of chapter paths as matched by rewriteChapterLinks:
 * both the raw `path` from coursebook.md and the `resolvedPath`.
 * @returns {Set<string>}
 */
function buildKnownChapterPathSet() {
  const paths = new Set();
  if (state.coursebook) {
    for (const chapter of state.coursebook.chapters) {
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
  if (state.coursebook) {
    for (const chapter of state.coursebook.chapters) {
      used.add(chapterSectionSlug(chapter));
    }
  }
  for (const headings of state.sectionHeadings) {
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
  if (!state.localFileStore) return null;
  if (state.localFileStore.dirHandle) {
    try {
      await readFileFromDirectory(state.localFileStore.dirHandle, relPath);
      return true;
    } catch {
      return false;
    }
  }
  if (state.localFileStore.fileMap) {
    if (state.localFileStore.fileMap.has(relPath)) return true;
    if (state.localFileStore.fileMapLower?.has(relPath.toLowerCase())) return true;
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
  if (!state.coursebook) return null;
  const exists = state.localFileStore ? localFileExists : undefined;

  const knownChapterPaths = buildKnownChapterPathSet();
  const headingSlugs = buildHeadingSlugSet();
  const coursebookRoot = getBaseDir(
    state.localFileStore?.parentPath ?? state.coursebook.parentPath,
  );

  const issues = [];
  const sections = [
    { path: state.localFileStore?.parentPath ?? state.coursebook.parentPath, idx: 0 },
  ];
  state.coursebook.chapters.forEach((chapter, i) => {
    sections.push({ path: chapter.resolvedPath || chapter.path, idx: i + 1 });
  });

  for (const { path, idx } of sections) {
    const markdown = state.sectionMarkdowns[idx];
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
  await editorController.flushCurrentEditorChanges();

  if (!state.localFileStore?.dirHandle) {
    showToast(
      "This coursebook was opened read-only. " +
        "Use Chrome/Edge with File System Access API enabled and grant write permission to save.",
    );
    return 0;
  }
  if (state.dirtyPaths.size === 0) return 0;

  // Validate what is about to be written so broken-link feedback lands at
  // the moment that matters. v1 is informational — saving proceeds.
  const linkIssues = await validateCoursebookLinks();
  if (linkIssues?.length) logLinkIssues(linkIssues);

  const writes = [];

  // Landing page (section 0) → parent coursebook file
  if (
    state.dirtyPaths.has(state.localFileStore.parentPath) &&
    state.sectionMarkdowns[0] !== undefined
  ) {
    writes.push({
      path: state.localFileStore.parentPath,
      markdown: state.sectionMarkdowns[0],
      sectionIdx: 0,
    });
  }

  // Chapters (section idx+1) → chapter files
  if (state.coursebook) {
    state.coursebook.chapters.forEach((chapter, idx) => {
      const markdown = state.sectionMarkdowns[idx + 1];
      if (state.dirtyPaths.has(chapter.path) && markdown !== undefined) {
        writes.push({ path: chapter.path, markdown, sectionIdx: idx + 1 });
      }
    });
  }

  let saved = 0;
  let failed = 0;
  const renames = [];
  for (const write of writes) {
    const handle = state.localFileStore.handles.get(write.path);
    if (!handle) {
      failed++;
      continue;
    }
    try {
      const writable = await handle.createWritable();
      await writable.write(write.markdown);
      await writable.close();
      state.dirtyPaths.delete(write.path);
      saved++;
      const rename = syncSectionTitleFromMarkdown(write.sectionIdx, write.markdown);
      if (rename) renames.push({ write, rename });
    } catch (e) {
      failed++;
      console.warn(`Failed to save ${write.path}:`, e);
    }
  }

  // A saved h1 rename must reach the chrome: re-render the section so
  // heading ids mint against the reserved slug, then rebuild sidebar, hash
  // links, and top bar exactly like the watcher's external-rename path.
  for (const { write, rename } of renames) {
    if (write.sectionIdx > 0) {
      await chapterRenderer.refreshSectionByIndex(write.sectionIdx - 1, write.markdown);
    }
    applyExternalTitleChange(write.sectionIdx - 1, rename);
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

function safeFilename(title, ext, fallback = "untitled") {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || fallback}.${ext}`;
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportHtml() {
  await editorController.flushCurrentEditorChanges();

  const assetResolver = state.localFileStore ? resolveAsset : undefined;
  let html;
  let filename;
  if (state.coursebook) {
    html = await exportCoursebookHtml(
      state.coursebook,
      assetResolver,
      state.linkPreviews,
    );
    filename = safeFilename(state.coursebook.title, "html", "coursebook");
  } else {
    const markdown = state.markdownEditor?.getValue() ?? state.currentMarkdown;
    html = await exportSingleHtml(
      state.chapterTitleEl.textContent,
      markdown,
      assetResolver,
      state.linkPreviews,
    );
    filename = safeFilename(state.chapterTitleEl.textContent, "html", "chapter");
  }
  downloadTextFile(filename, html, "text/html");
}

async function exportMarkdown() {
  await editorController.flushCurrentEditorChanges();

  let markdown;
  let filename;
  if (state.coursebook) {
    const chapterSlugMap = buildChapterSlugMap(state.coursebook);

    const parts = [];
    const parentMd = rewriteMarkdownChapterLinks(
      state.coursebook.markdown,
      state.coursebook.parentPath,
      chapterSlugMap,
    );
    parts.push(parentMd);

    for (let i = 0; i < state.coursebook.chapters.length; i++) {
      const md = state.sectionMarkdowns[i + 1] ?? state.coursebook.chapters[i].markdown;
      if (md === null || md === undefined) continue;
      const sourcePath = state.coursebook.chapters[i].resolvedPath;
      parts.push(rewriteMarkdownChapterLinks(md, sourcePath, chapterSlugMap));
    }

    markdown = parts.join("\n\n---\n\n");
    filename = safeFilename(state.coursebook.title, "md", "coursebook");
  } else {
    markdown = state.markdownEditor?.getValue() ?? state.currentMarkdown;
    filename = safeFilename(state.chapterTitleEl.textContent, "md", "chapter");
  }

  downloadTextFile(filename, markdown, "text/markdown");
}

function rewriteMarkdownChapterLinks(markdown, sourcePath, chapterSlugMap) {
  const baseDir = getBaseDir(sourcePath);
  const lines = markdown.split("\n");
  let inCodeFence = false;
  const linkRegex = /(?<!!)\[([^\]]*)\]\(([^)\s]*)\)/g;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    lines[i] = lines[i].replace(linkRegex, (match, text, target) => {
      const hashIndex = target.indexOf("#");
      const filePart = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
      if (!filePart.toLowerCase().endsWith(".md")) return match;
      const resolved = resolveLink(filePart, baseDir);
      if (!resolved || !chapterSlugMap.has(resolved)) return match;
      return `[${text}](#${chapterSlugMap.get(resolved)})`;
    });
  }

  return lines.join("\n");
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
  if (loadedCoursebook !== state.coursebook) return;

  const urls = collectCoursebookUrls(loadedCoursebook);
  if (urls.length === 0) return;

  const missing = urls.filter((url) => !state.linkPreviews.hasOwnProperty(url));
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
        if (loadedCoursebook !== state.coursebook) return;
        if (preview) {
          state.linkPreviews[url] = preview;
          LinkPreview.setPreviews(state.linkPreviews);
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

async function loadPreviewsForCoursebook(parentPath) {
  if (!parentPath) return {};
  const baseDir = getBaseDir(parentPath);
  const previewPath = baseDir ? `${baseDir}/previews.json` : "previews.json";

  try {
    if (state.localFileStore?.dirHandle) {
      const { file } = await readFileFromDirectory(
        state.localFileStore.dirHandle,
        previewPath,
      );
      return JSON.parse(await file.text());
    }

    if (state.localFileStore?.fileMap) {
      const f =
        state.localFileStore.fileMap.get(previewPath) ??
        state.localFileStore.fileMapLower?.get(previewPath.toLowerCase());
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

state.menuOpenCoursebookBtn.addEventListener("click", () => {
  openCoursebookFolder();
  menuController.closeMenu();
});

state.menuOpenFileBtn.addEventListener("click", () => {
  openFile();
  menuController.closeMenu();
});

state.menuSaveBtn.addEventListener("click", async () => {
  await saveAll();
  menuController.closeMenu();
});

state.saveBtn.addEventListener("click", async () => {
  await saveAll();
});

state.menuExportHtmlBtn.addEventListener("click", async () => {
  await exportHtml();
  menuController.closeMenu();
});

state.menuExportMarkdownBtn.addEventListener("click", async () => {
  await exportMarkdown();
  menuController.closeMenu();
});

state.menuSettingsBtn.addEventListener("click", () => {
  menuController.closeMenu();
  openSettings();
});

// ---- In-content navigation ----
// Catch any relative .md link that wasn't rewritten (e.g. user-authored links
// inside a chapter) and navigate in-app instead of opening the raw .md file.
state.contentEl.addEventListener("click", (event) => {
  if (!state.coursebook) return;
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

  const idx = state.coursebook.chapters.findIndex(
    (chapter) => chapter.path === href || chapter.resolvedPath === href,
  );
  if (idx >= 0) {
    event.preventDefault();
    chapterRenderer.loadChapterByIdx(idx);
  }
});

// ---- Reading aids ----
// Delegated clicks for the go-up links.
state.contentEl.addEventListener("click", (event) => {
  const goUp = event.target.closest(".go-up-link");
  if (!goUp) return;
  event.preventDefault();
  state.scrollSpy.scrollToSmooth(goUp.closest(".coursebook-section") ?? state.contentEl);
});

// ---- Index links ----
// Index entries link to the first occurrence of a term, which may live in
// a hidden chapter: switch to that chapter first, then scroll to the term.
state.contentEl.addEventListener("click", async (event) => {
  const link = event.target.closest(".idx-link");
  if (!link) return;
  event.preventDefault();

  const target = document.getElementById(link.getAttribute("data-target") || "");
  const section = target?.closest(".coursebook-section");
  if (!target || !section || !state.coursebook) return;
  if (section.classList.contains("index-section")) return;

  const idx =
    section.id === "overview" ? -1 : chapterRenderer.findChapterIdxBySlug(section.id);
  if (idx >= -1) {
    await chapterRenderer.loadChapterByIdx(idx, { skipHash: true });
  }
  state.scrollSpy.scrollToSmooth(target);
  flashIndexedTerm(target, state.previewPane);
  const hash = formatLocationHash(section.id, target.id);
  if (location.hash !== hash) history.replaceState(null, "", hash);
});

// ---- Source jump (edit mode) ----
// Clicking a paragraph/heading/code block in the preview scrolls the editor
// to the corresponding Markdown source line. Anchors and buttons are excluded
// first so reading aids, index links, .md links, and go-up links keep their
// own behavior; line numbers never cross chapters because the search is
// scoped to the clicked section (in coursebook mode only the current
// chapter's markdown is loaded in the editor).
state.contentEl.addEventListener("click", (event) => {
  if (!state.editMode || !state.markdownEditor) return;
  if (event.target.closest("a, button")) return;

  const target = event.target.closest(SOURCE_TARGET_SELECTOR);
  if (!target) return;

  let scope = state.contentEl;
  if (state.coursebook) {
    const section = target.closest(".coursebook-section");
    if (!section) return;
    // The editor holds the current chapter's markdown; line numbers in other
    // sections (including the generated index) belong to other documents.
    const idx =
      section.id === "overview" ? -1 : chapterRenderer.findChapterIdxBySlug(section.id);
    if (idx !== state.currentChapterIdx) return;
    scope = section;
  }

  const line = resolveSourceLine(target, scope);
  if (line !== null) {
    state.markdownEditor.revealLine(line);
  }
});
// ---- Initial load ----
initCoursebook();

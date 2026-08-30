/**
 * app.js — Application entry point.
 * Wires together coursebook loading, theme management, icon hydration,
 * menu dropdowns, the editor, renderer, sectionNavigator, and presentation mode.
 */
import { MarkdownEditor } from "./editor/markdown-editor.js";
import { ContentEnhancer } from "./renderer/content-enhancer.js";
import { LinkPreview } from "./renderer/link-preview.js";
import { createUndoTrail } from "./core/undo-trail.js";
import { ThemeManager, PALETTES } from "./core/theme-manager.js";
import { hydrateIcons } from "./core/icon.js";
import { isMacPlatform } from "./core/utils.js";
import { formatLocationHash } from "./core/navigation.js";
import { flashIndexedTerm } from "./core/indexed-terms.js";
import { resolveSourceLine, SOURCE_TARGET_SELECTOR } from "./core/source-jump.js";
import { createScrollSpy } from "./core/scroll-spy.js";
import {
  loadCoursebook,
  getBaseDir,
  chapterSectionSlug,
} from "./core/coursebook-loader.js";

import { state, DEFAULT_CONTENT } from "./state.js";
import { createMenuController } from "./controllers/menu-controller.js";
import { createChapterRenderer } from "./controllers/chapter-renderer.js";
import { createEditorController } from "./controllers/editor-controller.js";
import { readFileFromDirectory } from "./core/fs.js";
import { createFileWatcher } from "./controllers/file-watcher.js";
import { createCoursebookOpenerController } from "./controllers/coursebook-opener.js";
import { createSaveController } from "./controllers/save-controller.js";
import { createExportController } from "./controllers/export-controller.js";
import { createLivePreviewController } from "./controllers/live-preview.js";
import { createLocalAssetsController } from "./controllers/local-assets-controller.js";
import { createLinkValidationController } from "./controllers/link-validation-controller.js";
import { createPresentationController } from "./controllers/presentation-controller.js";

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

const localAssets = createLocalAssetsController({
  state,
  readFileFromDirectory,
});

const linkValidation = createLinkValidationController({
  state,
  readFileFromDirectory,
  getBaseDir,
  chapterSectionSlug,
  showToast,
});

const chapterRenderer = createChapterRenderer({
  state,
  beforeNavigate: () => wired.editor.flushCurrentEditorChanges(),
  resolveLocalImages: localAssets.resolveLocalImages,
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
wired.livePreview = createLivePreviewController({
  state,
  chapterRenderer,
  menuController,
  createFileWatcher,
  readFileFromDirectory,
  loadCoursebookFromDirectoryHandle: (...args) =>
    wired.opener.loadCoursebookFromDirectoryHandle(...args),
  showToast,
  updateOverlay,
  flushEditor: () => wired.editor.flushCurrentEditorChanges(),
});

// Undo-trail keys map to sections: "0" is the landing page, "1".."N" are the
// chapters in order.
function navigateToSection(key) {
  if (key === "0") return chapterRenderer.showLandingPage();
  return chapterRenderer.loadChapterByIdx(Number(key) - 1);
}

const editorController = createEditorController({
  state,
  MarkdownEditor,
  markCurrentDirty: () => wired.save.markCurrentDirty(),
  refreshCurrentSection: (markdown) => wired.livePreview.refreshFromEditor(markdown),
  renderSingleMarkdown: chapterRenderer.renderSingleMarkdown,
  navigateToSection,
});
wired.editor = editorController;

const save = createSaveController({
  state,
  linkValidation,
  livePreview: wired.livePreview,
  chapterRenderer,
  showToast,
  flushEditor: () => wired.editor.flushCurrentEditorChanges(),
});

const exportController = createExportController({
  state,
  localAssets,
  showToast,
  flushEditor: () => wired.editor.flushCurrentEditorChanges(),
});
wired.save = save;
wired.export = exportController;

wired.presentation = createPresentationController({
  state,
  chapterRenderer,
  editorController,
  updateOverlay,
  onThemeChange,
});

const opener = createCoursebookOpenerController({
  state,
  chapterRenderer,
  menuController,
  readFileFromDirectory,
  linkValidation,
  editor: editorController,
  livePreview: wired.livePreview,
  loadPreviewsForCoursebook: (parentPath) =>
    exportController.loadPreviewsForCoursebook(parentPath),
  preloadMissingLinkPreviews: (coursebook) =>
    exportController.preloadMissingLinkPreviews(coursebook),
  updateSaveState: () => save.updateSaveState(),
  showToast,
});
wired.opener = opener;

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
state.openFolderBackdrop.addEventListener("click", opener.closeOpenFolderModal);
state.openFolderCloseBtn.addEventListener("click", opener.closeOpenFolderModal);
state.openFolderSelectBtn.addEventListener("click", opener.selectCoursebookFolder);

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
// Local file/image asset loading is handled by localAssets below.

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
    state.linkPreviews = await exportController.loadPreviewsForCoursebook(
      state.coursebook.parentPath,
    );
    LinkPreview.setPreviews(state.linkPreviews);
    void exportController.preloadMissingLinkPreviews(state.coursebook);

    // Pre-load all chapter markdowns and heading data so section numbering is
    // continuous across the whole coursebook.
    await opener.preloadSectionHeadings();

    menuController.buildChapterList();
    // Render all chapters as a continuous page
    await chapterRenderer.renderAllChapters();

    wired.save.updateSaveState();
    await linkValidation.reportLinkIssues();

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
// Presentation mode, fullscreen, and keyboard/scroll navigation are
// handled by the presentationController created below.

// Save shortcut — intercept before the editor guard so it works while typing.
document.addEventListener("keydown", (e) => {
  const saveShortcut = (e.metaKey && isMacPlatform) || (e.ctrlKey && !isMacPlatform);
  if (saveShortcut && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    if (state.localFileStore && state.dirtyPaths.size > 0) {
      save.saveAll();
    }
  }
});

menuController.updateShortcutTooltips();

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

state.menuOpenCoursebookBtn.addEventListener("click", () => {
  opener.openCoursebookFolder();
  menuController.closeMenu();
});

state.menuOpenFileBtn.addEventListener("click", () => {
  opener.openFile();
  menuController.closeMenu();
});

state.menuSaveBtn.addEventListener("click", async () => {
  await save.saveAll();
  menuController.closeMenu();
});

state.saveBtn.addEventListener("click", async () => {
  await save.saveAll();
});

state.menuExportHtmlBtn.addEventListener("click", async () => {
  await exportController.exportHtml();
  menuController.closeMenu();
});

state.menuExportMarkdownBtn.addEventListener("click", async () => {
  await exportController.exportMarkdown();
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

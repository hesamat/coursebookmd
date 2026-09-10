/**
 * app.js — Application entry point.
 * Wires together coursebook loading, theme management, icon hydration,
 * menu dropdowns, the editor, renderer, sectionNavigator, and presentation mode.
 */
import { MarkdownEditor } from "./editor/markdown-editor.js";
import { ContentEnhancer } from "./renderer/content-enhancer.js";
import { LinkPreview } from "./renderer/link-preview.js";
import { attachMediaZoom } from "./core/media-zoom.js";
import { createUndoTrail } from "./core/undo-trail.js";
import { ThemeManager, PALETTES } from "./core/theme-manager.js";
import { createPresentMode } from "./core/present-mode.js";
import { hydrateIcons } from "./core/icon.js";
import { isMacPlatform } from "./core/utils.js";
import { formatLocationHash } from "./core/navigation.js";
import { flashIndexedTerm } from "./core/indexed-terms.js";
import { resolveSourceLine, SOURCE_TARGET_SELECTOR } from "./core/source-jump.js";
import { createScrollSpy } from "./core/scroll-spy.js";
import {
  loadCoursebook,
  loadChapter,
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
import { createPresentWindowController } from "./controllers/present-window-controller.js";

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
  updateActiveChapter: (...args) => {
    wired.menu.updateActiveChapter(...args);
    announceCurrentPosition();
  },
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

// Presentation mode itself runs in the popup window (see wired.presentWindow);
// the main window's engine instance (core/present-mode.js) drives only the ?
// shortcuts sheet and the overlay text writes on chapter changes.
const presentMode = createPresentMode({
  getNavigator: () => state.sectionNavigator,
  overlay: {
    root: state.overlay,
    current: state.overlayCurrent,
    next: state.overlayNext,
    progress: state.overlayProgress,
  },
  sheet: {
    root: state.shortcutsSheet,
    backdrop: state.shortcutsSheetBackdrop,
    presentGrid: state.shortcutsSheetPresent,
    normalGrid: state.shortcutsSheetNormal,
  },
});

wired.livePreview = createLivePreviewController({
  state,
  chapterRenderer,
  menuController,
  createFileWatcher,
  readFileFromDirectory,
  loadCoursebookFromDirectoryHandle: (...args) =>
    wired.opener.loadCoursebookFromDirectoryHandle(...args),
  showToast,
  showActionToast,
  enableAutoReload: () => setAutoApplyExternalChanges(true),
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

// Presenting happens in a dedicated popup window (present.html, fed by the
// present-window controller); the main window stays interactive.
wired.presentWindow = createPresentWindowController({
  state,
  showToast,
  // The popup's T key round-trips here: flip the theme and re-run Shiki
  // highlighting; the controller then re-pushes the popup content.
  toggleTheme: async () => {
    ThemeManager.toggleTheme();
    await onThemeChange();
  },
  getViewState: getPresentViewState,
  followView: followPresentView,
});

createPresentationController({
  state,
  editorController,
  presentMode,
  onThemeChange,
  openPresentWindow: () => wired.presentWindow.openPresentWindow(),
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

// Auto-reload setting: when off (default), external disk changes are reported
// with a reload prompt instead of being applied silently. The prompt offers
// the same toggle via its "Always auto-reload" action.
function setAutoApplyExternalChanges(enabled) {
  state.autoApplyExternalChanges = enabled;
  if (state.settingsAutoReload) state.settingsAutoReload.checked = enabled;
  try {
    localStorage.setItem("coursebookmd_auto_reload", enabled ? "1" : "0");
  } catch {
    // ignore storage errors (e.g. disabled localStorage)
  }
}

try {
  state.autoApplyExternalChanges =
    localStorage.getItem("coursebookmd_auto_reload") === "1";
} catch {
  // ignore storage errors (e.g. disabled localStorage)
}
if (state.settingsAutoReload) {
  state.settingsAutoReload.checked = state.autoApplyExternalChanges;
  state.settingsAutoReload.addEventListener("change", () => {
    setAutoApplyExternalChanges(state.settingsAutoReload.checked);
  });
}

// ---- Icon hydration ----
hydrateIcons();

// ---- Rendering pipeline ----
// Local file/image asset loading is handled by localAssets below.

/**
 * Overlay refresh for chapter/section changes. `heading` overrides the
 * navigator's waypoint when the active heading is an h3 (whose waypoint is
 * its parent h2). Chapter switches call this too, so it doubles as the single
 * funnel that tells the presentation popup where the main window is.
 */
function updateOverlay(idx, heading) {
  presentMode.updateOverlay({ heading });
  wired.presentWindow?.pushView();
}

/** The main window's position in the chapter/section taxonomy the popup uses. */
function getPresentViewState() {
  if (!state.coursebook) return null;
  return {
    chapterIdx: state.currentChapterIdx,
    sectionId:
      state.sectionNavigator?.current?.id ?? chapterRenderer.currentChapterSlug(),
  };
}

/**
 * Apply the popup's position in the main window: switch chapter, then move
 * the waypoint. The URL hash is left untouched — view sync mirrors the
 * projector during a lecture, it is not a reading destination.
 */
async function followPresentView({ chapterIdx, sectionId }) {
  if (!state.coursebook) return;
  if (chapterIdx !== state.currentChapterIdx) {
    if (chapterIdx === -1) await chapterRenderer.showLandingPage({ skipHash: true });
    else await chapterRenderer.loadChapterByIdx(chapterIdx, { skipHash: true });
  }
  const navigator = state.sectionNavigator;
  if (!navigator || navigator.headings.length === 0) return;
  const idx = navigator.headings.findIndex((heading) => heading.id === sectionId);
  if (idx >= 0) {
    navigator.navigateTo(idx, { instant: true });
    return;
  }
  const section = sectionId
    ? state.contentEl.querySelector(`#${CSS.escape(sectionId)}`)
    : null;
  const target = section?.querySelector("h1, h2, h3") ?? section;
  if (target) state.scrollSpy.scrollToSmooth(target);
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
  attachMediaZoom(state.contentEl);
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

/**
 * Re-fetch a URL-loaded coursebook (served markdown / ?coursebook=...).
 * No file handles exist in this mode, so "reload from disk" means
 * re-downloading the files. Unsaved in-app edits are carried across: nothing
 * in this mode is ever written back, so in-memory content is the only copy of
 * those edits. An edited landing page wins over the re-fetched one (same as
 * the local rebuild: its chapter list and title define the model). Dirty
 * chapters removed from the resulting list are dropped, with a notice
 * matching the local rebuild's behavior.
 */
async function reloadUrlCoursebook() {
  const prevResolvedPath =
    state.currentChapterIdx >= 0
      ? state.coursebook.chapters[state.currentChapterIdx]?.resolvedPath
      : null;
  const prevScrollTop = state.previewPane.scrollTop;

  const requestedCoursebook =
    new URLSearchParams(location.search).get("coursebook") || guessCoursebookPath();
  // Fetch before touching state so a failed reload keeps the loaded coursebook.
  let coursebook = await loadCoursebookFrom(requestedCoursebook);

  const landingDirty = state.dirtyPaths.has("coursebook.md")
    ? state.sectionMarkdowns[0]
    : null;
  const dirtyChapters = new Map();
  state.coursebook.chapters.forEach((chapter, i) => {
    if (!chapter.path || !state.dirtyPaths.has(chapter.path)) return;
    const markdown = state.sectionMarkdowns[i + 1];
    if (markdown != null) {
      dirtyChapters.set(chapter.path, { markdown, title: chapter.title });
    }
  });

  if (landingDirty != null) {
    // Rebuild the model from the edited landing so its chapter list and # h1
    // title win, exactly like rebuildCoursebookFromMarkdown does locally.
    // Reuse the fetched chapters as the loader so nothing downloads twice.
    const fetched = new Map(
      coursebook.chapters.map((chapter) => [
        chapter.resolvedPath || chapter.path,
        chapter.markdown,
      ]),
    );
    coursebook = await loadCoursebook(
      coursebook.parentPath,
      landingDirty,
      async (resolvedPath) => {
        const markdown = fetched.get(resolvedPath);
        if (markdown !== undefined) return markdown;
        return loadChapter(resolvedPath);
      },
    );
  }

  state.coursebook = coursebook;
  const droppedTitles = [];
  for (const [path, dirty] of dirtyChapters) {
    const idx = coursebook.chapters.findIndex((chapter) => chapter.path === path);
    if (idx === -1) {
      state.dirtyPaths.delete(path);
      droppedTitles.push(dirty.title);
      continue;
    }
    // preloadSectionHeadings uses chapter.markdown when present, so the
    // preserved content flows into the sections with consistent headings.
    coursebook.chapters[idx].markdown = dirty.markdown;
  }
  state.chapterTitleEl.textContent = state.coursebook.title;

  state.linkPreviews = await exportController.loadPreviewsForCoursebook(
    state.coursebook.parentPath,
  );
  LinkPreview.setPreviews(state.linkPreviews);
  void exportController.preloadMissingLinkPreviews(state.coursebook);

  await opener.preloadSectionHeadings();
  menuController.buildChapterList();
  await chapterRenderer.renderAllChapters();

  wired.save.updateSaveState();
  await linkValidation.reportLinkIssues();
  LinkPreview.enhance(state.contentEl);
  attachMediaZoom(state.contentEl);

  // Restore the previously visible section when it still exists.
  let restored = false;
  if (prevResolvedPath !== null) {
    const idx = state.coursebook.chapters.findIndex(
      (chapter) => chapter.resolvedPath === prevResolvedPath,
    );
    if (idx >= 0) {
      await chapterRenderer.loadChapterByIdx(idx, { skipHash: true });
      restored = true;
    }
  }
  if (restored) {
    state.previewPane.scrollTop = prevScrollTop;
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
  wired.livePreview.syncEditorAfterReload();

  const keptCount =
    (landingDirty != null ? 1 : 0) + dirtyChapters.size - droppedTitles.length;
  if (droppedTitles.length > 0) {
    const chapterWord = droppedTitles.length === 1 ? "chapter" : "chapters";
    showToast(
      `Removed ${chapterWord} ` +
        `${droppedTitles.map((title) => `"${title}"`).join(", ")} ` +
        "had unsaved edits — they were discarded." +
        (keptCount > 0
          ? ` Kept edits to ${keptCount} file${keptCount === 1 ? "" : "s"}.`
          : ""),
    );
  } else if (keptCount > 0) {
    showToast(
      `Coursebook reloaded — kept your unsaved edits to ` +
        `${keptCount === 1 ? "1 file" : `${keptCount} files`}.`,
    );
  } else {
    showToast("Coursebook reloaded.");
  }
}

window.addEventListener("hashchange", () => chapterRenderer.navigateFromHash());

state.prevChapterBtn.addEventListener("click", menuController.goPrevChapter);
state.nextChapterBtn.addEventListener("click", menuController.goNextChapter);

// ---- Table of Contents ----

// ---- TOC collapse (same peek-out chevron as the export) ----
// The panel-header chevron slides the panel almost fully off-screen,
// leaving a slim tab that reopens it.
function setSidebarOpen(open) {
  document.body.classList.toggle("sidebar-closed", !open);
  state.sidebarToggleBtn.setAttribute("aria-expanded", String(open));
}
state.sidebarToggleBtn.addEventListener("click", () =>
  setSidebarOpen(document.body.classList.contains("sidebar-closed")),
);

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
// Popup launching (presentationController) and the main window's keyboard
// gates are wired by the controller created above; the popup experience
// itself lives in src/present/popup-main.js.

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
  // One toast surface at a time: a plain notice must not paint under the
  // action toast (they share the same fixed position).
  hideActionToast();
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

const ACTION_TOAST_TIMEOUT_MS = 12000;

/**
 * Show a toast with inline action buttons (e.g. the reload prompt).
 * Reuses one element, so a new prompt replaces the previous message and
 * restarts the auto-hide timer instead of stacking.
 * @param {string} message
 * @param {{label: string, onClick: () => void, ghost?: boolean}[]} actions
 */
function showActionToast(message, actions) {
  const plain = document.getElementById("appToast");
  if (plain) {
    plain.classList.remove("is-visible");
    clearTimeout(plain._hideTimer);
  }
  let toast = document.getElementById("appActionToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "appActionToast";
    toast.className = "app-toast app-toast--action";
    toast.setAttribute("role", "status");
    const text = document.createElement("span");
    text.className = "app-toast__message";
    toast.append(text);
    document.body.appendChild(toast);
  }
  toast.querySelector(".app-toast__message").textContent = message;
  for (const button of toast.querySelectorAll(".app-toast__action")) {
    button.remove();
  }
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "btn btn--sm app-toast__action" + (action.ghost ? " btn--ghost" : "");
    button.textContent = action.label;
    button.onclick = () => {
      hideActionToast();
      action.onClick();
    };
    toast.append(button);
  }
  toast.classList.add("is-visible");
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(hideActionToast, ACTION_TOAST_TIMEOUT_MS);
}

function hideActionToast() {
  const toast = document.getElementById("appActionToast");
  if (!toast) return;
  toast.classList.remove("is-visible");
  clearTimeout(toast._hideTimer);
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

state.menuReloadBtn.addEventListener("click", async () => {
  menuController.closeMenu();
  try {
    await reloadCoursebook();
  } catch (e) {
    console.warn("Reload failed:", e);
    showToast("Reload failed — check the browser console for details.");
  }
});

/**
 * Reload the active coursebook from its source (disk handles or re-fetch),
 * after committing a pending debounced editor buffer so dirty state and
 * section content reflect what the user actually typed (same as save).
 */
async function reloadCoursebook() {
  await wired.editor.flushCurrentEditorChanges();
  if (state.localFileStore) {
    await wired.livePreview.reloadFromDisk();
  } else if (state.coursebook) {
    await reloadUrlCoursebook();
  }
  // A reload may have dropped dirty chapters removed from the list; sync the
  // save buttons with the remaining dirty paths.
  wired.save.updateSaveState();
}

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
// ---- Screen-reader announcements ----
// The overlay text is a visual affordance, so a chapter switch is otherwise
// silent for assistive tech. Called from the same funnel that refreshes the
// sidebar highlight, which only runs on chapter-level changes.
function announceCurrentPosition() {
  if (!state.coursebook) return;
  // Some callers run this before the visible section flips, so read the DOM
  // on the next frame rather than trusting the class at call time.
  requestAnimationFrame(() => {
    const active = state.contentEl?.querySelector(".coursebook-section.active");
    if (!active) return;
    if (active.classList.contains("index-section")) {
      announce("Index.");
      return;
    }
    const total = state.coursebook.chapters.length;
    if (state.currentChapterIdx === -1) {
      announce(`Course overview. ${total} chapter${total === 1 ? "" : "s"}.`);
      return;
    }
    const title = state.coursebook.chapters[state.currentChapterIdx]?.title ?? "Chapter";
    announce(`${title}. Chapter ${state.currentChapterIdx + 1} of ${total}.`);
  });
}

/** Speak a message through the app's live region (#srStatus). */
function announce(message) {
  const status = document.getElementById("srStatus");
  if (!status) return;
  status.textContent = "";
  // Re-setting the same text does not re-announce; clear, then fill next frame.
  requestAnimationFrame(() => {
    status.textContent = message;
  });
}

// ---- Scroll hints ----
// Wide tables and code blocks scroll sideways inside their own box (see the
// .table-scroll rules in content.css); mark the ones that can still scroll so
// the stylesheet can show an edge shadow. The standalone export emits its own
// copy of this, because the viewer runtime is a separate build artifact and
// behavior shipped with the exported markup cannot go stale.
let scrollHintFrame = null;

function syncScrollHints() {
  if (!state.contentEl) return;
  // Read every measurement before touching a class: interleaving them would
  // force a layout per block, on every scroll frame.
  const updates = [];
  for (const el of state.contentEl.querySelectorAll(".table-scroll, pre")) {
    const more = el.scrollWidth > el.clientWidth + 1;
    updates.push([
      el,
      more,
      more && el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
    ]);
  }
  for (const [el, more, atEnd] of updates) {
    el.classList.toggle("is-scrollable", more);
    el.classList.toggle("is-at-end", atEnd);
  }
}

function scheduleScrollHints() {
  if (scrollHintFrame !== null) return;
  scrollHintFrame = requestAnimationFrame(() => {
    scrollHintFrame = null;
    syncScrollHints();
  });
}

document.addEventListener("scroll", scheduleScrollHints, true);
window.addEventListener("resize", scheduleScrollHints);
if (state.contentEl) {
  new ResizeObserver(scheduleScrollHints).observe(state.contentEl);
}

// ---- Initial load ----
initCoursebook();

/**
 * live-preview.js — Live preview on save and in-app TOC synchronization,
 * composed by app.js via injected dependencies. Polls the recorded file
 * handles of a coursebook opened through the File System Access API for
 * external modifications, re-renders the affected sections, and keeps the
 * sidebar, section ids, hash links, and top bar in sync with `# h1` renames
 * and chapter-list edits typed in the app editor. Controllers never import
 * each other; cross-controller calls are injected by app.js.
 */
import {
  loadCoursebook,
  parseCoursebook,
  getChapterTitle,
  assignChapterSlugs,
  chapterSectionSlug,
  parentChaptersChanged,
} from "../core/coursebook-loader.js";
import { slugifyForId } from "../core/utils.js";
import {
  extractHeadingsFromMarkdown,
  computeSectionNumbersForSections,
} from "../core/section-numbering.js";

export function createLivePreviewController(deps) {
  const {
    state,
    chapterRenderer,
    menuController,
    createFileWatcher,
    readFileFromDirectory,
    loadCoursebookFromDirectoryHandle,
    showToast,
    updateOverlay,
    flushEditor,
  } = deps;

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
  function applyTitleChange(chapterIdx, { from, to, fromSlug, toSlug }) {
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
        await flushEditor();
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
      if (renamed) applyTitleChange(sectionIdx - 1, renamed);
    })();

    state.liveEditorInput = thisOp.catch((e) =>
      console.warn("External change re-render failed:", e),
    );
    return state.liveEditorInput;
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
    // The rebuild may be a deferred one that fires after the user navigated;
    // a stale chapter index would leave no visible section.
    if (state.currentChapterIdx >= state.coursebook.chapters.length) {
      state.currentChapterIdx = -1;
    }
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

  // Structural rebuilds re-read and re-render every chapter, so bursts of list
  // edits coalesce on a trailing timer instead of rebuilding per keystroke.
  const STRUCTURAL_REBUILD_DEBOUNCE_MS = 1000;
  let structuralRebuildTimer = null;
  let pendingStructuralMarkdown = null;

  function scheduleStructuralRebuild(markdown) {
    pendingStructuralMarkdown = markdown;
    clearTimeout(structuralRebuildTimer);
    structuralRebuildTimer = setTimeout(async () => {
      const pending = pendingStructuralMarkdown;
      pendingStructuralMarkdown = null;
      structuralRebuildTimer = null;
      if (pending == null) return;
      await rebuildCoursebookFromMarkdown(pending);
    }, STRUCTURAL_REBUILD_DEBOUNCE_MS);
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
      if (chaptersChanged) {
        // Defer the expensive full reconstruction, but keep the landing body
        // preview live in the meantime.
        scheduleStructuralRebuild(markdown);
        const renamedTitle = syncSectionTitleFromMarkdown(0, markdown);
        await chapterRenderer.refreshCurrentSection(markdown);
        if (renamedTitle) applyTitleChange(-1, renamedTitle);
        return;
      }
      const renamedTitle = syncSectionTitleFromMarkdown(0, markdown);
      await chapterRenderer.refreshCurrentSection(markdown);
      if (renamedTitle) applyTitleChange(-1, renamedTitle);
      return;
    }
    const renamed = syncSectionTitleFromMarkdown(state.currentChapterIdx + 1, markdown);
    await chapterRenderer.refreshCurrentSection(markdown);
    if (renamed) applyTitleChange(state.currentChapterIdx, renamed);
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

  /**
   * Seed the watcher's baseline right after a coursebook opens so edits saved
   * before the first poll tick are detected instead of being consumed as
   * "initial state". A no-op while a watcher poll is already in flight.
   */
  function seedPoll() {
    return fileWatcher.poll().catch((e) => console.warn("File watch poll failed:", e));
  }

  return {
    applyExternalSectionChange,
    applyTitleChange,
    refreshFromEditor,
    seedPoll,
    syncSectionTitleFromMarkdown,
  };
}

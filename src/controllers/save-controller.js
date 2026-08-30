/**
 * save-controller.js — Dirty tracking and saving coursebook files back to
 * disk, composed by app.js via injected dependencies. Controllers never
 * import each other; cross-controller calls are routed through deps.
 */

export function createSaveController(deps) {
  const { state, linkValidation, livePreview, chapterRenderer, showToast, flushEditor } =
    deps;

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

  /**
   * Write all dirty .md files back to disk using the recorded file handles.
   * The landing page is section 0; each chapter is section idx+1.
   * When the coursebook wasn't opened with write access, explains how to
   * enable saving instead.
   * @returns {Promise<number>} Number of files saved.
   */
  async function saveAll() {
    await flushEditor();

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
    const linkIssues = await linkValidation.validateCoursebookLinks();
    if (linkIssues?.length) linkValidation.logLinkIssues(linkIssues);

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
        const rename = livePreview.syncSectionTitleFromMarkdown(
          write.sectionIdx,
          write.markdown,
        );
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
      livePreview.applyTitleChange(write.sectionIdx - 1, rename);
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

  return { dirtyPathForCurrentChapter, markCurrentDirty, saveAll, updateSaveState };
}

/**
 * editor-controller.js — Markdown editor lifecycle, per-section state cache,
 * cross-chapter undo/redo, and editor input rendering, composed by app.js via
 * injected dependencies. Controllers never import each other; cross-controller
 * calls are routed through deps.
 */
import { undo, redo } from "@codemirror/commands";
import {
  computeSectionNumbersForSections,
  extractHeadingsFromMarkdown,
} from "../core/section-numbering.js";

export function createEditorController(deps) {
  const {
    state,
    MarkdownEditor,
    markCurrentDirty,
    refreshCurrentSection,
    renderSingleMarkdown,
    navigateToSection,
  } = deps;

  /**
   * Undo in the current chapter; if its history is exhausted, step back to the
   * previously edited chapter and undo there.
   * @param {EditorView} view
   * @returns {boolean} true when the command was fully handled.
   */
  function globalUndo(view) {
    if (undo(view)) {
      state.suppressTrailNote = true;
      return true;
    }
    const key = state.undoTrail.stepBack();
    if (!key || key === state.currentEditorKey) return false;
    // Chapter switches must never run inside a keydown dispatch, so defer.
    setTimeout(() => {
      void performCrossChapterStep(key, "undo");
    }, 0);
    return true;
  }

  /**
   * Redo in the current chapter; if its redo history is exhausted, step
   * forward to the next edited chapter and redo there.
   * @param {EditorView} view
   * @returns {boolean} true when the command was fully handled.
   */
  function globalRedo(view) {
    if (redo(view)) {
      state.suppressTrailNote = true;
      return true;
    }
    const key = state.undoTrail.stepForward();
    if (!key || key === state.currentEditorKey) return false;
    setTimeout(() => {
      void performCrossChapterStep(key, "redo");
    }, 0);
    return true;
  }

  /**
   * Switch to the chapter identified by an undo-trail key and undo/redo there.
   * Keys are editorStates cache keys: "0" = landing page (section -1),
   * "1".."N" = chapters 0..N-1, "standalone" = single-file mode (no chapters).
   * @param {string} key
   * @param {"undo" | "redo"} direction
   */
  async function performCrossChapterStep(key, direction) {
    if (!state.editMode || !state.markdownEditor) return;
    if (!state.coursebook || key === "standalone") return;
    const idx = key === "0" ? -1 : Number(key) - 1;
    if (!Number.isInteger(idx) || idx < -1 || idx >= state.coursebook.chapters.length) {
      return;
    }
    try {
      await navigateToSection(key);
    } catch (e) {
      console.warn("Cross-chapter undo navigation failed:", e);
      return;
    }
    // The switch must have actually loaded the target section before
    // applying the undo/redo there.
    if (state.currentEditorKey !== key) return;
    state.suppressTrailNote = true;
    if (direction === "undo") {
      state.markdownEditor.undo();
    } else {
      state.markdownEditor.redo();
    }
  }

  /**
   * Key of the section currently loaded in the editor, matching the
   * editorStates cache keys. Falls back to the section derived from
   * currentChapterIdx when the editor has not been synced yet.
   * @returns {string}
   */
  function editorKeyForCurrent() {
    if (state.currentEditorKey) return state.currentEditorKey;
    return state.coursebook ? String(state.currentChapterIdx + 1) : "standalone";
  }

  function stashEditorState() {
    if (!state.markdownEditor || !state.currentEditorKey) return;
    const editorState = state.markdownEditor.getState();
    if (!editorState) return;
    state.editorStates.set(state.currentEditorKey, editorState);
    if (state.editorStates.size > state.EDITOR_STATE_CACHE_LIMIT) {
      const oldest = state.editorStates.keys().next().value;
      if (oldest !== undefined) state.editorStates.delete(oldest);
    }
  }

  function clearEditorStates() {
    state.editorStates.clear();
    state.currentEditorKey = null;
    state.undoTrail.reset();
  }

  function syncEditorWithCurrent() {
    if (!state.editMode || !state.markdownEditor) return;
    const sectionIdx = state.currentChapterIdx + 1;
    const markdown =
      state.coursebook && state.sectionMarkdowns[sectionIdx] !== undefined
        ? state.sectionMarkdowns[sectionIdx]
        : state.currentMarkdown;
    const key = state.coursebook ? String(sectionIdx) : "standalone";
    if (key === state.currentEditorKey) return;

    stashEditorState();

    // Only reuse a cached state whose document matches the expected markdown;
    // otherwise the source has changed outside the editor and history must go.
    const cached = state.editorStates.get(key);
    state.editorStates.delete(key);
    if (cached && cached.doc.toString() === markdown) {
      state.markdownEditor.setState(cached);
    } else {
      state.markdownEditor.setValue(markdown, { suppressOnChange: true });
    }
    state.currentEditorKey = key;
  }

  function flushCurrentEditorChanges() {
    if (!state.markdownEditor) return Promise.resolve();
    state.markdownEditor.cancelOnChange();
    return onEditorInput(state.markdownEditor.getValue());
  }

  async function setEditMode(on) {
    if (!on && state.editMode) {
      await flushCurrentEditorChanges();
    }

    state.editMode = on;
    state.editorPane.classList.toggle("hidden", !on);
    state.toggleEditLabel.textContent = on ? "Preview" : "Edit";
    if (on) {
      if (!state.markdownEditor) {
        state.markdownEditor = new MarkdownEditor(state.editorEl, {
          onChange: (value) => onEditorInput(value),
          debounceDelay: 300,
          onUndoCommand: (view) => globalUndo(view),
          onRedoCommand: (view) => globalRedo(view),
        });
        state.currentEditorKey = null;
      }
      syncEditorWithCurrent();
      state.markdownEditor.focus();
    }
  }

  async function onEditorInput(markdown) {
    // Consume the one-shot undo/redo suppression regardless of whether this
    // commit changes anything, so it can never leak into a later edit.
    const fromUndoRedo = state.suppressTrailNote;
    state.suppressTrailNote = false;
    const thisOp = (async () => {
      await state.liveEditorInput;

      const sectionIdx = state.currentChapterIdx + 1;
      if (state.coursebook && state.sectionMarkdowns[sectionIdx] !== undefined) {
        if (state.sectionMarkdowns[sectionIdx] === markdown) return;
        state.sectionMarkdowns[sectionIdx] = markdown;
        // Unchanged flushes and navigation-triggered syncs never get here, so
        // only genuine edits enter the cross-chapter undo trail.
        if (!fromUndoRedo) state.undoTrail.noteEdit(editorKeyForCurrent());
        markCurrentDirty();
        // Keep the coursebook object's markdown in sync so exports and saves
        // use the latest edits.
        if (state.currentChapterIdx === -1) {
          state.coursebook.markdown = markdown;
        } else {
          const chapter = state.coursebook.chapters[state.currentChapterIdx];
          if (chapter) chapter.markdown = markdown;
        }
        state.sectionHeadings[sectionIdx] = extractHeadingsFromMarkdown(markdown);
        state.sectionNumbers = computeSectionNumbersForSections(state.sectionHeadings, {
          skipFirst: true,
        });

        await refreshCurrentSection(markdown);
      } else {
        // Standalone mode
        if (state.currentMarkdown === markdown) return;
        state.currentMarkdown = markdown;
        if (!fromUndoRedo) state.undoTrail.noteEdit(editorKeyForCurrent());
        const scrollTop = state.previewPane.scrollTop;
        await renderSingleMarkdown(markdown);
        state.previewPane.scrollTop = scrollTop;
      }
    })();

    state.liveEditorInput = thisOp.catch((e) =>
      console.warn("Editor re-render failed:", e),
    );
    return state.liveEditorInput;
  }

  function setupEditorResizer() {
    if (!state.editorResizer || !state.editorPane) return;

    state.editorResizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      state.editorResizer.classList.add("is-resizing");

      const startX = e.clientX;
      const startWidth = state.editorPane.getBoundingClientRect().width;
      const maxWidth = window.innerWidth * 0.6;

      function onMove(moveEvent) {
        let newWidth = startWidth + (moveEvent.clientX - startX);
        newWidth = Math.max(280, Math.min(maxWidth, newWidth));
        state.editorPane.style.width = `${newWidth}px`;
      }

      function onUp() {
        state.editorResizer.classList.remove("is-resizing");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        localStorage.setItem("editorPaneWidth", state.editorPane.style.width);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  const savedEditorWidth = localStorage.getItem("editorPaneWidth");
  if (savedEditorWidth) {
    state.editorPane.style.width = savedEditorWidth;
  }

  return {
    stashEditorState,
    clearEditorStates,
    syncEditorWithCurrent,
    flushCurrentEditorChanges,
    globalUndo,
    globalRedo,
    performCrossChapterStep,
    editorKeyForCurrent,
    setEditMode,
    onEditorInput,
    setupEditorResizer,
  };
}

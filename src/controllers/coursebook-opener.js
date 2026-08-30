/**
 * coursebook-opener.js — Coursebook/file opening flows, composed by app.js
 * via injected dependencies. Covers "Open Coursebook Folder" (File System
 * Access API with a webkitdirectory fallback), standalone file opening, the
 * folder-pick modal for coursebook files, activation of a loaded coursebook,
 * and preloading of section headings. Controllers never import each other;
 * cross-controller calls are routed through deps.
 */
import {
  loadCoursebook,
  loadChapter,
  parseCoursebook,
} from "../core/coursebook-loader.js";
import { LinkPreview } from "../renderer/link-preview.js";
import {
  extractHeadingsFromMarkdown,
  computeSectionNumbersForSections,
} from "../core/section-numbering.js";

export function createCoursebookOpenerController(deps) {
  const {
    state,
    chapterRenderer,
    menuController,
    readFileFromDirectory,
    linkValidation,
    editor,
    livePreview,
    loadPreviewsForCoursebook,
    preloadMissingLinkPreviews,
    updateSaveState,
    showToast,
  } = deps;

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
        const coursebook = await loadCoursebook(
          "coursebook.md",
          parentMarkdown,
          loadFile,
        );
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
      editor.clearEditorStates();
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
        await loadCoursebookFromDirectoryHandle(
          parentMarkdown,
          dirHandle,
          parentFileName,
        );
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
    livePreview.seedPoll();
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
   * @param {import("../core/coursebook-loader.js").Coursebook} parsed
   * @param {string} parentMarkdown
   */
  async function activateCoursebook(parsed, parentMarkdown) {
    if (state.editMode) await editor.setEditMode(false);

    // New coursebook = new editing session; drop any cached editor states.
    editor.clearEditorStates();

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
    await linkValidation.reportLinkIssues();

    state.currentChapterIdx = -1;
    menuController.updateActiveChapter();
    menuController.updateChapterNav();
    chapterRenderer.updateVisibleSection();
    state.previewPane.scrollTop = 0;
  }

  return {
    activateCoursebook,
    closeOpenFolderModal,
    loadCoursebookFromDirectoryHandle,
    openCoursebookFolder,
    openFile,
    preloadSectionHeadings,
    selectCoursebookFolder,
  };
}

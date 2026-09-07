/**
 * Tests for the manual "File → Reload Coursebook" action in the live-preview
 * controller: fresh disk reads via the File System Access store, unsaved-edit
 * preservation (chapters and an edited coursebook.md), routing to the full
 * reload when nothing is dirty, refusals, and the webkitdirectory limitation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLivePreviewController } from "../controllers/live-preview.js";
import { parseCoursebook } from "../core/coursebook-loader.js";

const PARENT_V1 = `# Test Coursebook

Intro text.

- [Alpha](chapters/alpha.md)
- [Beta](chapters/beta.md)
`;

const PARENT_V2 = `# Test Coursebook

Intro text.

- [Alpha](chapters/alpha.md)
- [Beta](chapters/beta.md)
- [Gamma](chapters/gamma.md)
`;

const PARENT_NO_ALPHA = `# Test Coursebook

Intro text.

- [Beta](chapters/beta.md)
`;

const ALPHA_V1 = "# Alpha\n\nAlpha v1.";
const BETA_V1 = "# Beta\n\nBeta v1.";

function baseFiles(parent = PARENT_V1) {
  return new Map([
    ["coursebook.md", { text: parent, mtimeMs: 100 }],
    ["chapters/alpha.md", { text: ALPHA_V1, mtimeMs: 100 }],
    ["chapters/beta.md", { text: BETA_V1, mtimeMs: 100 }],
  ]);
}

function makeState(overrides = {}) {
  return {
    coursebook: parseCoursebook(PARENT_V1, "coursebook.md"),
    sectionMarkdowns: [PARENT_V1, ALPHA_V1, BETA_V1],
    sectionHeadings: [[], [], []],
    sectionNumbers: [],
    dirtyPaths: new Set(),
    localFileStore: { dirHandle: {}, handles: new Map(), parentPath: "coursebook.md" },
    currentChapterIdx: -1,
    previewPane: { scrollTop: 42 },
    contentEl: document.createElement("div"),
    editMode: false,
    markdownEditor: null,
    currentEditorKey: null,
    liveEditorInput: Promise.resolve(),
    sectionNavigator: null,
    ...overrides,
  };
}

/**
 * Controller wired to an in-memory disk map plus spy deps. Mutate `files`
 * to simulate external edits before calling reloadFromDisk.
 */
function makeController(state, { files, loadCoursebookFromDirectoryHandle } = {}) {
  const readFileFromDirectory = vi.fn(async (_dirHandle, path) => {
    const f = files?.get(path);
    if (!f) throw new Error(`ENOENT: ${path}`);
    return {
      file: { text: async () => f.text, lastModified: f.mtimeMs, size: f.text.length },
      fileHandle: { name: path },
    };
  });
  const showToast = vi.fn();
  const watcher = { poll: vi.fn(async () => {}) };
  const chapterRenderer = {
    refreshSectionByIndex: vi.fn(async () => {}),
    refreshCurrentSection: vi.fn(async () => {}),
    renderAllChapters: vi.fn(async () => {}),
    loadChapterByIdx: vi.fn(async () => {}),
    updateVisibleSection: vi.fn(),
    setupScrollSpyForCurrentChapter: vi.fn(),
    rewriteChapterLinks: vi.fn(),
  };
  const menuController = {
    buildChapterList: vi.fn(),
    syncIndexNavItem: vi.fn(),
    updateActiveChapter: vi.fn(),
    updateChapterNav: vi.fn(),
  };
  const loadFromHandle = loadCoursebookFromDirectoryHandle ?? vi.fn(async () => {});
  const controller = createLivePreviewController({
    state,
    chapterRenderer,
    menuController,
    createFileWatcher: () => watcher,
    readFileFromDirectory,
    loadCoursebookFromDirectoryHandle: loadFromHandle,
    showToast,
    updateOverlay: vi.fn(),
    flushEditor: vi.fn(async () => {}),
  });
  return {
    controller,
    showToast,
    watcher,
    chapterRenderer,
    menuController,
    loadCoursebookFromDirectoryHandle: loadFromHandle,
    readFileFromDirectory,
  };
}

describe("live-preview reloadFromDisk", () => {
  beforeEach(() => {
    // The controller starts its poll loop on creation.
    vi.stubGlobal(
      "setInterval",
      vi.fn(() => 0),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes to the full reload when nothing is dirty", async () => {
    const files = baseFiles(PARENT_V2);
    files.set("chapters/gamma.md", { text: "# Gamma\n\nGamma v1.", mtimeMs: 100 });
    const state = makeState();
    const { controller, showToast, loadCoursebookFromDirectoryHandle } = makeController(
      state,
      { files },
    );

    await controller.reloadFromDisk();

    expect(loadCoursebookFromDirectoryHandle).toHaveBeenCalledWith(
      PARENT_V2,
      state.localFileStore.dirHandle,
      "coursebook.md",
    );
    expect(showToast).not.toHaveBeenCalled();
  });

  it("keeps unsaved chapter edits and picks up disk changes for clean files", async () => {
    const files = baseFiles();
    files.get("chapters/alpha.md").text = "# Alpha\n\nAlpha v2 on disk.";
    files.get("chapters/alpha.md").mtimeMs = 200;
    files.get("chapters/beta.md").text = "# Beta\n\nBeta v2 on disk.";
    files.get("chapters/beta.md").mtimeMs = 200;
    const state = makeState();
    state.dirtyPaths = new Set(["chapters/alpha.md"]);
    state.sectionMarkdowns[1] = "# Alpha\n\nAlpha edited in-app.";
    const { controller, showToast, watcher } = makeController(state, { files });

    await controller.reloadFromDisk();

    expect(state.sectionMarkdowns[1]).toBe("# Alpha\n\nAlpha edited in-app.");
    expect(state.sectionMarkdowns[2]).toBe("# Beta\n\nBeta v2 on disk.");
    expect(state.coursebook.chapters[1].markdown).toBe("# Beta\n\nBeta v2 on disk.");
    expect(state.dirtyPaths.has("chapters/alpha.md")).toBe(true);
    expect(watcher.poll).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      "Reloaded from disk — kept your unsaved edits to 1 file.",
    );
  });

  it("keeps an edited coursebook.md instead of the disk version", async () => {
    const files = baseFiles(PARENT_V2);
    files.set("chapters/gamma.md", { text: "# Gamma\n\nGamma v1.", mtimeMs: 100 });
    const state = makeState();
    state.dirtyPaths = new Set(["coursebook.md"]);
    const inMemoryParent = `${PARENT_V1}\nAn extra paragraph typed in-app.\n`;
    state.coursebook.markdown = inMemoryParent;
    state.sectionMarkdowns[0] = inMemoryParent;
    const { controller, showToast } = makeController(state, { files });

    await controller.reloadFromDisk();

    expect(state.sectionMarkdowns[0]).toBe(inMemoryParent);
    expect(state.coursebook.markdown).toBe(inMemoryParent);
    expect(state.coursebook.chapters).toHaveLength(2);
    expect(showToast).toHaveBeenCalledWith(
      "Reloaded from disk — kept your unsaved edits to 1 file.",
    );
  });

  it("drops a dirty chapter removed from the coursebook list and reports it", async () => {
    const files = baseFiles(PARENT_NO_ALPHA);
    files.get("chapters/beta.md").text = "# Beta\n\nBeta v2 on disk.";
    files.get("chapters/beta.md").mtimeMs = 200;
    const state = makeState();
    state.dirtyPaths = new Set(["chapters/alpha.md"]);
    state.sectionMarkdowns[1] = "# Alpha\n\nAlpha edited in-app.";
    const { controller, showToast } = makeController(state, { files });

    await controller.reloadFromDisk();

    expect(state.dirtyPaths.has("chapters/alpha.md")).toBe(false);
    expect(state.coursebook.chapters.map((chapter) => chapter.path)).toEqual([
      "chapters/beta.md",
    ]);
    expect(state.sectionMarkdowns).toEqual([
      PARENT_NO_ALPHA,
      "# Beta\n\nBeta v2 on disk.",
    ]);
    expect(showToast).toHaveBeenCalledWith(
      'Removed chapter "Alpha" had unsaved edits — they were discarded.',
    );
    expect(showToast).not.toHaveBeenCalledWith(
      expect.stringContaining("Reloaded from disk"),
    );
  });

  it("keeps the loaded coursebook when coursebook.md is unreadable", async () => {
    const files = baseFiles();
    files.delete("coursebook.md");
    const state = makeState();
    const { controller, showToast, loadCoursebookFromDirectoryHandle } = makeController(
      state,
      { files },
    );

    await controller.reloadFromDisk();

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("Could not read coursebook.md"),
    );
    expect(loadCoursebookFromDirectoryHandle).not.toHaveBeenCalled();
    expect(state.coursebook.chapters).toHaveLength(2);
  });

  it("keeps the loaded coursebook when the disk coursebook.md has no chapters", async () => {
    const files = baseFiles("# Just a document\n\nNo chapter links here.\n");
    const state = makeState();
    const { controller, showToast, loadCoursebookFromDirectoryHandle } = makeController(
      state,
      { files },
    );

    await controller.reloadFromDisk();

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("no chapters"));
    expect(loadCoursebookFromDirectoryHandle).not.toHaveBeenCalled();
    expect(state.coursebook.chapters).toHaveLength(2);
  });

  it("explains the webkitdirectory limitation without reloading", async () => {
    const state = makeState({
      localFileStore: {
        fileMap: new Map(),
        fileMapLower: new Map(),
        parentPath: "coursebook.md",
      },
    });
    const { controller, showToast, loadCoursebookFromDirectoryHandle } = makeController(
      state,
      { files: baseFiles() },
    );

    await controller.reloadFromDisk();

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("can't detect changes"),
    );
    expect(loadCoursebookFromDirectoryHandle).not.toHaveBeenCalled();
  });

  it("does nothing without a loaded coursebook", async () => {
    const state = makeState({ coursebook: null });
    const { controller, showToast, readFileFromDirectory } = makeController(state, {
      files: baseFiles(),
    });

    await controller.reloadFromDisk();

    expect(showToast).not.toHaveBeenCalled();
    expect(readFileFromDirectory).not.toHaveBeenCalled();
  });
});

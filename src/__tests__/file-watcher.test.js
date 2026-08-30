/**
 * Tests for the file watcher: change detection against recorded file
 * metadata, dirty-path conflict handling, coursebook.md structural vs
 * content-only routing, and poll serialization.
 */
import { describe, it, expect, vi } from "vitest";
import { createFileWatcher } from "../controllers/file-watcher.js";
import { parseCoursebook } from "../core/coursebook-loader.js";

const COURSEBOOK_V1 = `# Test Coursebook

Intro text.

- [First Chapter](chapters/01-first.md)
- [Second Chapter](chapters/02-second.md)
`;

function baseFiles() {
  return new Map([
    ["coursebook.md", { text: COURSEBOOK_V1, mtimeMs: 100 }],
    ["chapters/01-first.md", { text: "# First\n\nFirst chapter.", mtimeMs: 100 }],
    ["chapters/02-second.md", { text: "# Second\n\nSecond chapter.", mtimeMs: 100 }],
  ]);
}

function sectionMarkdowns() {
  return [COURSEBOOK_V1, "# First\n\nFirst chapter.", "# Second\n\nSecond chapter."];
}

/**
 * Watcher wired to an in-memory file map plus spy deps. Mutate `files`
 * between polls to simulate external edits.
 */
function makeWatcher({
  state,
  files,
  settleMs = 0,
  notifyThrottleMs = 0,
  isHidden = () => false,
}) {
  const calls = { applied: [], coursebooks: [], skipped: [], unreadable: [] };
  const readSectionFile = vi.fn(async (readPath) => {
    const f = files.get(readPath);
    if (!f) return null;
    return { text: f.text, mtimeMs: f.mtimeMs, size: f.text.length };
  });
  const watcher = createFileWatcher({
    state,
    settleMs,
    notifyThrottleMs,
    isHidden,
    readSectionFile,
    applySection: async (sectionIdx, text) => {
      calls.applied.push({ sectionIdx, text });
      state.sectionMarkdowns[sectionIdx] = text;
    },
    applyCoursebook: async (text) => {
      calls.coursebooks.push(text);
    },
    notifySkipped: (dirtyPath) => calls.skipped.push(dirtyPath),
    notifyUnreadable: (readPath) => calls.unreadable.push(readPath),
  });
  return { watcher, calls, readSectionFile };
}

describe("file-watcher", () => {
  it("records a baseline on the first poll without applying anything", async () => {
    const state = {
      coursebook: parseCoursebook(COURSEBOOK_V1, "coursebook.md"),
      sectionMarkdowns: sectionMarkdowns(),
      dirtyPaths: new Set(),
      localFileStore: { dirHandle: {}, parentPath: "coursebook.md" },
    };
    const { watcher, calls } = makeWatcher({ state, files: baseFiles() });

    await watcher.poll();

    expect(calls.applied).toEqual([]);
    expect(calls.coursebooks).toEqual([]);
  });

  it("applies a changed chapter file to the right section", async () => {
    const state = {
      coursebook: parseCoursebook(COURSEBOOK_V1, "coursebook.md"),
      sectionMarkdowns: sectionMarkdowns(),
      dirtyPaths: new Set(),
      localFileStore: { dirHandle: {}, parentPath: "coursebook.md" },
    };
    const files = baseFiles();
    const { watcher, calls } = makeWatcher({ state, files });

    await watcher.poll();

    files.get("chapters/01-first.md").mtimeMs = 200;
    files.get("chapters/01-first.md").text = "# First\n\nFirst chapter, edited on disk.";
    await watcher.poll();

    expect(calls.applied).toEqual([
      { sectionIdx: 1, text: "# First\n\nFirst chapter, edited on disk." },
    ]);

    await watcher.poll();
    expect(calls.applied).toHaveLength(1);
  });

  it("ignores an mtime bump when content matches app state (own save)", async () => {
    const state = {
      coursebook: parseCoursebook(COURSEBOOK_V1, "coursebook.md"),
      sectionMarkdowns: sectionMarkdowns(),
      dirtyPaths: new Set(),
      localFileStore: { dirHandle: {}, parentPath: "coursebook.md" },
    };
    const files = baseFiles();
    const { watcher, calls } = makeWatcher({ state, files });

    await watcher.poll();

    // App saved chapter 1 from within the app: file mtime changes, but
    // content equals what the app already has.
    files.get("chapters/01-first.md").mtimeMs = 999;
    await watcher.poll();

    expect(calls.applied).toEqual([]);
  });

  it("skips dirty files with a throttled notice, then applies after the dirty state clears", async () => {
    const state = {
      coursebook: parseCoursebook(COURSEBOOK_V1, "coursebook.md"),
      sectionMarkdowns: sectionMarkdowns(),
      dirtyPaths: new Set(["chapters/01-first.md"]),
      localFileStore: { dirHandle: {}, parentPath: "coursebook.md" },
    };
    const files = baseFiles();
    const { watcher, calls } = makeWatcher({ state, files });

    await watcher.poll();

    files.get("chapters/01-first.md").mtimeMs = 300;
    files.get("chapters/01-first.md").text = "# First\n\nRewritten on disk.";
    await watcher.poll();

    expect(calls.skipped).toEqual(["chapters/01-first.md"]);
    expect(calls.applied).toEqual([]);
    // The baseline must still hold the pre-change snapshot so the change is
    // re-detected after the dirty state clears.
    await watcher.poll();
    expect(calls.skipped).toHaveLength(2);
    expect(calls.applied).toEqual([]);

    state.dirtyPaths.clear();
    await watcher.poll();
    expect(calls.applied).toEqual([
      { sectionIdx: 1, text: "# First\n\nRewritten on disk." },
    ]);
  });

  it("routes a content-only coursebook.md change to the landing section", async () => {
    const state = {
      coursebook: parseCoursebook(COURSEBOOK_V1, "coursebook.md"),
      sectionMarkdowns: sectionMarkdowns(),
      dirtyPaths: new Set(),
      localFileStore: { dirHandle: {}, parentPath: "coursebook.md" },
    };
    const files = baseFiles();
    const { watcher, calls } = makeWatcher({ state, files });

    await watcher.poll();

    const contentOnly = `${COURSEBOOK_V1}\nExtra landing paragraph.\n`;
    files.get("coursebook.md").text = contentOnly;
    files.get("coursebook.md").mtimeMs = 300;
    await watcher.poll();

    expect(calls.applied).toEqual([{ sectionIdx: 0, text: contentOnly }]);
    expect(calls.coursebooks).toEqual([]);
  });

  it("routes a structural coursebook.md change to a full coursebook reload", async () => {
    const state = {
      coursebook: parseCoursebook(COURSEBOOK_V1, "coursebook.md"),
      sectionMarkdowns: sectionMarkdowns(),
      dirtyPaths: new Set(),
      localFileStore: { dirHandle: {}, parentPath: "coursebook.md" },
    };
    const files = baseFiles();
    const { watcher, calls } = makeWatcher({ state, files });

    await watcher.poll();

    files.get("coursebook.md").text = COURSEBOOK_V1.replace(
      "- [Second Chapter](chapters/02-second.md)",
      "- [Second Chapter](chapters/02-second.md)\n- [Third Chapter](chapters/03-third.md)",
    );
    files.get("coursebook.md").mtimeMs = 300;
    await watcher.poll();

    expect(calls.coursebooks).toHaveLength(1);
    expect(calls.applied).toEqual([]);
  });

  it("treats a renamed nav group as structural", async () => {
    const grouped = `# Test Coursebook

Intro text.

## Week 1

- [First Chapter](chapters/01-first.md)
- [Second Chapter](chapters/02-second.md)
`;
    const renamed = grouped.replace("## Week 1", "## Week 2");
    const state = {
      coursebook: parseCoursebook(grouped, "coursebook.md"),
      sectionMarkdowns: [
        grouped,
        "# First\n\nFirst chapter.",
        "# Second\n\nSecond chapter.",
      ],
      dirtyPaths: new Set(),
      localFileStore: { dirHandle: {}, parentPath: "coursebook.md" },
    };
    const files = baseFiles();
    files.get("coursebook.md").text = grouped;
    const { watcher, calls } = makeWatcher({ state, files });

    await watcher.poll();

    files.get("coursebook.md").text = renamed;
    files.get("coursebook.md").mtimeMs = 300;
    await watcher.poll();

    expect(calls.coursebooks).toHaveLength(1);
    expect(calls.applied).toEqual([]);
  });

  it("skips polling while the document is hidden", async () => {
    const state = {
      coursebook: parseCoursebook(COURSEBOOK_V1, "coursebook.md"),
      sectionMarkdowns: sectionMarkdowns(),
      dirtyPaths: new Set(),
      localFileStore: { dirHandle: {}, parentPath: "coursebook.md" },
    };
    const files = baseFiles();
    const { watcher, readSectionFile } = makeWatcher({
      state,
      files,
      isHidden: () => true,
    });

    await watcher.poll();

    expect(readSectionFile).not.toHaveBeenCalled();
  });

  it("does nothing without a coursebook or write access", async () => {
    const state = {
      coursebook: parseCoursebook(COURSEBOOK_V1, "coursebook.md"),
      sectionMarkdowns: sectionMarkdowns(),
      dirtyPaths: new Set(),
      localFileStore: { dirHandle: null, parentPath: "coursebook.md" },
    };
    const { watcher, readSectionFile } = makeWatcher({ state, files: baseFiles() });

    await watcher.poll();
    expect(readSectionFile).not.toHaveBeenCalled();

    state.localFileStore = { dirHandle: {}, parentPath: "coursebook.md" };
    state.coursebook = null;
    await watcher.poll();
    expect(readSectionFile).not.toHaveBeenCalled();
  });

  it("resets baselines when the coursebook object is replaced", async () => {
    const state = {
      coursebook: parseCoursebook(COURSEBOOK_V1, "coursebook.md"),
      sectionMarkdowns: sectionMarkdowns(),
      dirtyPaths: new Set(),
      localFileStore: { dirHandle: {}, parentPath: "coursebook.md" },
    };
    const files = baseFiles();
    const { watcher, calls } = makeWatcher({ state, files });

    await watcher.poll();

    // Reopening (new object) must not produce phantom applies, and must
    // still detect genuine changes afterwards.
    state.coursebook = { ...parseCoursebook(COURSEBOOK_V1, "coursebook.md") };
    await watcher.poll();
    expect(calls.applied).toEqual([]);

    files.get("chapters/01-first.md").mtimeMs = 400;
    files.get("chapters/01-first.md").text = "# First\n\nPost-reopen edit.";
    await watcher.poll();
    expect(calls.applied).toEqual([
      { sectionIdx: 1, text: "# First\n\nPost-reopen edit." },
    ]);
  });

  it("notifies once when a watched file disappears and recovers when it returns", async () => {
    const state = {
      coursebook: parseCoursebook(COURSEBOOK_V1, "coursebook.md"),
      sectionMarkdowns: sectionMarkdowns(),
      dirtyPaths: new Set(),
      localFileStore: { dirHandle: {}, parentPath: "coursebook.md" },
    };
    const files = baseFiles();
    const { watcher, calls } = makeWatcher({ state, files });

    await watcher.poll();

    files.delete("chapters/02-second.md");
    await watcher.poll();
    expect(calls.unreadable).toEqual(["chapters/02-second.md"]);

    // Still missing: no repeat notification.
    await watcher.poll();
    expect(calls.unreadable).toHaveLength(1);

    // File returns: watched again, change picked up.
    files.set("chapters/02-second.md", { text: "# Second\n\nRestored.", mtimeMs: 400 });
    await watcher.poll();
    expect(calls.applied).toEqual([{ sectionIdx: 2, text: "# Second\n\nRestored." }]);
  });

  it("does not watch unreadable files it never saw", async () => {
    const state = {
      coursebook: parseCoursebook(COURSEBOOK_V1, "coursebook.md"),
      sectionMarkdowns: sectionMarkdowns(),
      dirtyPaths: new Set(),
      localFileStore: { dirHandle: {}, parentPath: "coursebook.md" },
    };
    const files = baseFiles();
    files.delete("chapters/02-second.md");
    const { watcher, calls } = makeWatcher({ state, files });

    await watcher.poll();

    expect(calls.unreadable).toEqual([]);
  });

  it("drops re-entrant polls while one is in flight", async () => {
    const state = {
      coursebook: parseCoursebook(COURSEBOOK_V1, "coursebook.md"),
      sectionMarkdowns: sectionMarkdowns(),
      dirtyPaths: new Set(),
      localFileStore: { dirHandle: {}, parentPath: "coursebook.md" },
    };
    let reads = 0;
    let releaseFirst;
    const gate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const readSectionFile = vi.fn(async () => {
      reads += 1;
      if (reads === 1) await gate;
      return { text: COURSEBOOK_V1, mtimeMs: 100, size: COURSEBOOK_V1.length };
    });
    const watcher = createFileWatcher({
      state,
      settleMs: 0,
      notifyThrottleMs: 0,
      isHidden: () => false,
      readSectionFile,
      applySection: async () => {},
      applyCoursebook: async () => {},
      notifySkipped: () => {},
      notifyUnreadable: () => {},
    });

    const first = watcher.poll();
    await watcher.poll(); // re-entrant: dropped while the first is in flight
    releaseFirst();
    await first;

    expect(reads).toBe(3);
  });

  it("defers changes whose file keeps changing during the settle window", async () => {
    const state = {
      coursebook: parseCoursebook(COURSEBOOK_V1, "coursebook.md"),
      sectionMarkdowns: sectionMarkdowns(),
      dirtyPaths: new Set(),
      localFileStore: { dirHandle: {}, parentPath: "coursebook.md" },
    };
    const files = baseFiles();
    const { watcher, calls } = makeWatcher({ state, files, settleMs: 20 });

    await watcher.poll();

    files.get("chapters/01-first.md").mtimeMs = 500;
    files.get("chapters/01-first.md").text = "# First\n\nv1";
    const pollPromise = watcher.poll();
    // Rewrite the file while the poll is inside its settle window.
    setTimeout(() => {
      files.get("chapters/01-first.md").mtimeMs = 600;
      files.get("chapters/01-first.md").text = "# First\n\nv2";
    }, 5);
    await pollPromise;

    // The re-read saw a different mtime than the detected snapshot, so the
    // change is deferred and the baseline kept for re-detection.
    expect(calls.applied).toEqual([]);

    await watcher.poll();
    expect(calls.applied).toEqual([{ sectionIdx: 1, text: "# First\n\nv2" }]);
  });
});

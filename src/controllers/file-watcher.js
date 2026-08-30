/**
 * file-watcher.js — Live preview on save for coursebooks opened through the
 * File System Access API. Polls the recorded file handles for external
 * modifications (e.g. saves from a desktop editor) and reports each changed
 * file so app.js can re-render the affected section. Pure scheduling and
 * change detection: reading files and applying changes are injected by app.js.
 */
import { parseCoursebook } from "../core/coursebook-loader.js";

const DEFAULT_NOTIFY_THROTTLE_MS = 10000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decide whether a changed coursebook.md alters the coursebook structure
 * (title, chapter list, or nav groups) — those need a full reload — or only
 * the landing page content, which can be re-rendered like a chapter.
 * @param {string} markdown - Fresh coursebook.md content.
 * @param {string} parentPath - The coursebook.md path as opened.
 * @param {import("../core/coursebook-loader.js").Coursebook} current - The loaded coursebook.
 * @returns {boolean}
 */
function parentChangeIsStructural(markdown, parentPath, current) {
  const parsed = parseCoursebook(markdown, parentPath);
  if (parsed.title !== current.title) return true;
  if (parsed.chapters.length !== current.chapters.length) return true;
  for (let i = 0; i < parsed.chapters.length; i++) {
    if (
      parsed.chapters[i].path !== current.chapters[i].path ||
      parsed.chapters[i].title !== current.chapters[i].title
    ) {
      return true;
    }
  }
  return JSON.stringify(parsed.nav) !== JSON.stringify(current.nav);
}

export function createFileWatcher(deps) {
  const {
    state,
    isHidden = () => document.hidden,
    settleMs = 450,
    notifyThrottleMs = DEFAULT_NOTIFY_THROTTLE_MS,
    readSectionFile,
    applySection,
    applyCoursebook,
    notifySkipped,
    notifyUnreadable,
  } = deps;

  // Last-seen file metadata, keyed by read path. Reset when the watched
  // directory changes (opening another folder) so a reopened coursebook
  // never inherits stale baselines. A structural reload of the SAME folder
  // deliberately keeps baselines: edits that land between the reload and
  // the next poll must stay detectable instead of being absorbed as
  // "initial state". A baseline is only replaced when a change is actually
  // consumed (applied, or confirmed as the app's own save) — skipped,
  // dirty-raced, or still-changing files keep their old baseline so the
  // change is re-detected on a later poll.
  const recorded = new Map();
  // Paths whose read failed at least once since they were last watched; the
  // first successful read after a failure is compared against app state
  // instead of being treated as a fresh baseline.
  const wasUnreadable = new Set();
  let lastStoreDir = null;
  let busy = false;
  const lastNotified = new Map();

  function notify(key, fn) {
    const now = Date.now();
    const last = lastNotified.get(key) ?? 0;
    lastNotified.set(key, now);
    if (now - last >= notifyThrottleMs) fn();
  }

  function watchList() {
    if (!state.coursebook || !state.localFileStore?.dirHandle) return [];
    const entries = [
      {
        readPath: state.localFileStore.parentPath,
        dirtyPath: state.localFileStore.parentPath,
        sectionIdx: 0,
      },
    ];
    state.coursebook.chapters.forEach((chapter, i) => {
      entries.push({
        readPath: chapter.resolvedPath || chapter.path,
        dirtyPath: chapter.path,
        sectionIdx: i + 1,
      });
    });
    return entries;
  }

  /**
   * Run one poll cycle. Safe to call repeatedly; re-entrant calls while a
   * poll is in flight are dropped.
   */
  async function poll() {
    if (busy || isHidden()) return;
    const entries = watchList();
    if (entries.length === 0) {
      recorded.clear();
      wasUnreadable.clear();
      lastStoreDir = null;
      return;
    }
    const storeDir = state.localFileStore.dirHandle;
    if (storeDir !== lastStoreDir) {
      lastStoreDir = storeDir;
      recorded.clear();
      wasUnreadable.clear();
    }

    busy = true;
    try {
      const changed = [];
      for (const entry of entries) {
        const snap = await readSectionFile(entry.readPath);
        if (!snap) {
          if (recorded.delete(entry.readPath)) {
            wasUnreadable.add(entry.readPath);
            notify(entry.readPath, () => notifyUnreadable(entry.readPath));
          }
          continue;
        }
        const prev = recorded.get(entry.readPath);
        const returned = wasUnreadable.delete(entry.readPath);
        if (!prev && !returned) {
          recorded.set(entry.readPath, { mtimeMs: snap.mtimeMs, size: snap.size });
          continue;
        }
        if (prev && snap.mtimeMs === prev.mtimeMs && snap.size === prev.size) {
          continue;
        }
        if (state.dirtyPaths.has(entry.dirtyPath)) {
          notify(entry.dirtyPath, () => notifySkipped(entry.dirtyPath));
          continue;
        }
        const current =
          entry.sectionIdx === 0
            ? state.coursebook.markdown
            : state.sectionMarkdowns[entry.sectionIdx];
        if (snap.text === current) {
          recorded.set(entry.readPath, { mtimeMs: snap.mtimeMs, size: snap.size });
          continue;
        }
        changed.push({ entry, snap });
      }

      if (changed.length === 0) return;

      // Editors often rewrite files in two steps (temp file + rename); wait
      // briefly and re-read so we apply settled content once.
      await sleep(settleMs);

      for (const { entry, snap } of changed) {
        const settled = await readSectionFile(entry.readPath);
        if (!settled) continue;
        // The file changed again during the settle window (or raced dirty):
        // leave the old baseline in place so the next poll re-detects it.
        if (settled.mtimeMs !== snap.mtimeMs) continue;
        if (state.dirtyPaths.has(entry.dirtyPath)) continue;
        recorded.set(entry.readPath, {
          mtimeMs: settled.mtimeMs,
          size: settled.size,
        });
        try {
          if (entry.sectionIdx === 0) {
            if (
              parentChangeIsStructural(settled.text, entry.readPath, state.coursebook)
            ) {
              await applyCoursebook(settled.text);
            } else {
              await applySection(0, settled.text);
            }
          } else {
            await applySection(entry.sectionIdx, settled.text);
          }
        } catch (e) {
          console.warn(`Failed to apply external change to ${entry.readPath}:`, e);
        }
      }
    } finally {
      busy = false;
    }
  }

  return { poll };
}

/**
 * Undo trail — tracks the order of chapters edited across the session so
 * undo/redo can walk backwards through chapters once the current chapter's
 * own history is exhausted.
 *
 * Pure logic: no DOM, no CodeMirror. Keys are opaque strings (the same keys
 * used by the per-chapter EditorState cache in app.js).
 *
 * @param {object} [options]
 * @param {number} [options.limit=50] - Maximum number of tracked edits.
 * @returns {{
 *   noteEdit: (key: string) => void,
 *   stepBack: () => string | null,
 *   stepForward: () => string | null,
 *   reset: () => void,
 *   entries: () => string[],
 *   position: () => number,
 * }}
 */
export function createUndoTrail({ limit = 50 } = {}) {
  const max = Math.max(1, limit);
  /** @type {string[]} */
  let items = [];
  let pos = -1;

  return {
    /**
     * Record an edit in the chapter `key`. Repeated edits in the same
     * chapter collapse into the current entry; an edit in another chapter
     * discards any forward (redo) entries, mirroring undo-stack semantics.
     * @param {string} key
     */
    noteEdit(key) {
      if (items[pos] === key) return;
      items = items.slice(0, pos + 1);
      items.push(key);
      pos = items.length - 1;
      if (items.length > max) {
        items.shift();
        pos = items.length - 1;
      }
    },

    /**
     * Move back one entry and return its key, or null at the start.
     * @returns {string | null}
     */
    stepBack() {
      if (pos <= 0) return null;
      pos -= 1;
      return items[pos];
    },

    /**
     * Move forward one entry and return its key, or null at the end.
     * @returns {string | null}
     */
    stepForward() {
      if (pos >= items.length - 1) return null;
      pos += 1;
      return items[pos];
    },

    /** Forget the whole trail (new session). */
    reset() {
      items = [];
      pos = -1;
    },

    /** Snapshot of tracked keys (for tests). */
    entries() {
      return [...items];
    },

    /** Current index into entries, -1 when empty (for tests). */
    position() {
      return pos;
    },
  };
}

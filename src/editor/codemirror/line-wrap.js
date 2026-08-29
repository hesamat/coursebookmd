import { Prec, RangeSetBuilder } from "@codemirror/state";
import { indentLess, indentMore } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, keymap } from "@codemirror/view";

const FENCED_CODE_NODE = "FencedCode";
const NO_WRAP_LINE_CLASS = "cm-no-wrap";

/**
 * Whether a document position sits inside a fenced code block.
 *
 * Uses the Markdown syntax tree: @lezer/markdown parses fences into a
 * `FencedCode` node (with CodeMark / CodeInfo / CodeText children), so
 * walking up from the innermost node at `pos` decides this without any
 * regexp guessing.
 *
 * Both resolve sides are checked because a single side misclassifies the
 * fence boundaries: at the opening fence's start only side 1 resolves into
 * the node starting there, and at the closing fence's end only side -1
 * resolves into the node ending there.
 *
 * @param {import("@codemirror/state").EditorState} state
 * @param {number} pos
 * @returns {boolean}
 */
export function isInCodeBlock(state, pos) {
  const safePos = Math.max(0, Math.min(pos, state.doc.length));
  for (const side of [1, -1]) {
    for (
      let node = syntaxTree(state).resolveInner(safePos, side);
      node;
      node = node.parent
    ) {
      if (node.name === FENCED_CODE_NODE) return true;
    }
  }
  return false;
}

/**
 * True only when every selection range lies fully inside fenced code, so a
 * mixed prose/code selection falls back to the no-op prose behavior.
 * @param {import("@codemirror/state").EditorState} state
 * @returns {boolean}
 */
function selectionInCodeBlock(state) {
  return state.selection.ranges.every(
    (range) => isInCodeBlock(state, range.anchor) && isInCodeBlock(state, range.head),
  );
}

/**
 * Keymap command: indent when the selection is inside fenced code.
 * Returns false otherwise so the key event falls through (Tab keeps its
 * browser focus-navigation role in prose).
 * @param {EditorView} view
 * @returns {boolean}
 */
export const indentInCodeBlock = (view) =>
  selectionInCodeBlock(view.state) && indentMore(view);

/**
 * Keymap command: dedent when the selection is inside fenced code.
 * @param {EditorView} view
 * @returns {boolean}
 */
export const dedentInCodeBlock = (view) =>
  selectionInCodeBlock(view.state) && indentLess(view);

/**
 * Tab / Shift+Tab scoped to fenced code blocks. Prec.highest so it wins
 * over any other Tab binding; outside code it returns false and no other
 * keymap in this editor binds Tab, so the browser default (focus move)
 * applies.
 */
export const codeBlockTabKeymap = Prec.highest(
  keymap.of([{ key: "Tab", run: indentInCodeBlock, shift: dedentInCodeBlock }]),
);

const noWrapLine = Decoration.line({ class: NO_WRAP_LINE_CLASS });

/**
 * Line decorations for the lines spanned by fenced code blocks. Scoped to
 * the viewport (the documented pattern for syntax-dependent line classes);
 * recomputed on doc or viewport changes so scrolling re-decorates.
 *
 * @param {EditorView} view
 * @returns {import("@codemirror/view").DecorationSet}
 */
function buildNoWrapDecorations(view) {
  const builder = new RangeSetBuilder();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      if (isInCodeBlock(view.state, line.from)) {
        builder.add(line.from, line.from, noWrapLine);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const noWrapLineHighlighter = ViewPlugin.fromClass(
  class {
    /**
     * @param {EditorView} view
     */
    constructor(view) {
      this.decorations = buildNoWrapDecorations(view);
    }

    /**
     * @param {import("@codemirror/view").ViewUpdate} update
     */
    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildNoWrapDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// lineWrapping puts white-space: break-spaces on .cm-content; that value is
// inherited per line, so a direct rule on the line element overrides it.
const noWrapTheme = EditorView.theme({
  ".cm-line.cm-no-wrap": {
    whiteSpace: "pre",
    wordBreak: "normal",
    overflowWrap: "normal",
  },
});

/**
 * Always-on: lines inside fenced code blocks render with white-space: pre
 * (horizontal scroll) regardless of the global wrap toggle.
 */
export const codeBlockNoWrap = [noWrapLineHighlighter, noWrapTheme];

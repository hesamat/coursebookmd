/**
 * Python built-in function documentation for hover previews.
 *
 * The dataset itself is generated at build time by
 * tools/generate-python-docs.mjs from the official functions page and is not
 * committed. This module owns only the mention matching: the markdown renderer
 * turns matching inline code spans (`len`, `len(x)`) into links to the docs
 * page, and LinkPreview's PythonDocsProvider serves the generated card
 * content.
 */
import { PYTHON_BUILTINS, PYTHON_DOCS_URL } from "../../generated/python-builtins.js";

export { PYTHON_BUILTINS, PYTHON_DOCS_URL };

// Sphinx anchors do not always equal the name: range is #func-range, and
// __import__ is #import__. Keep a reverse map, and accept the bare name as a
// legacy anchor so previews built before anchors were tracked still resolve.
const ANCHOR_TO_NAME = new Map(
  Object.entries(PYTHON_BUILTINS).map(([name, entry]) => [entry.anchor, name]),
);

/** The generated entry for a docs anchor (or a legacy name anchor). */
export function builtinForAnchor(anchor) {
  if (typeof anchor !== "string") return null;
  const name = ANCHOR_TO_NAME.get(anchor);
  if (name) return PYTHON_BUILTINS[name];
  return Object.hasOwn(PYTHON_BUILTINS, anchor) ? PYTHON_BUILTINS[anchor] : null;
}

// Longest-first so a prefix pair like `format`/`format_map` anchors to the
// right name; the full-match anchors below do the rest of the work.
const MENTION_PATTERN = new RegExp(
  `^\\s*(${Object.keys(PYTHON_BUILTINS)
    .sort((a, b) => b.length - a.length)
    .join("|")})\\b(?:\\s*\\([\\s\\S]*\\))?\\s*$`,
);

/**
 * The docs URL an inline code span should link to, or null when its text is
 * not a builtin mention. A mention is the bare name (`len`) or a call
 * (`len(x)`); anything else (`len(x) > 0`, `for`, `my_len`) stays plain code.
 */
export function builtinDocHref(codeText) {
  if (typeof codeText !== "string") return null;
  const match = codeText.match(MENTION_PATTERN);
  if (!match) return null;
  return `${PYTHON_DOCS_URL}#${PYTHON_BUILTINS[match[1]].anchor}`;
}

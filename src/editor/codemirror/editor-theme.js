import { EditorView } from "@codemirror/view";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * Syntax highlighting style for Markdown tokens.
 *
 * Uses CSS custom properties so the editor adapts to the app's
 * light / dark theme without any JS-level switching.
 */
const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "var(--cm-token-heading)", fontWeight: "700" },
  { tag: tags.strong, color: "var(--cm-token-strong)", fontWeight: "700" },
  { tag: tags.emphasis, color: "var(--cm-token-emphasis)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--cm-token-keyword)" },
  { tag: tags.atom, color: "var(--cm-token-atom)" },
  { tag: tags.string, color: "var(--cm-token-string)" },
  { tag: tags.comment, color: "var(--cm-token-comment)", fontStyle: "italic" },
  { tag: tags.link, color: "var(--cm-token-link)" },
  { tag: tags.url, color: "var(--cm-token-url)", textDecoration: "underline" },
  { tag: tags.monospace, color: "var(--cm-token-code)", fontFamily: "var(--font-mono)" },
  { tag: tags.list, color: "var(--cm-token-list)" },
  { tag: tags.quote, color: "var(--cm-token-quote)" },
  { tag: tags.meta, color: "var(--cm-token-meta)" },
]);

/**
 * Base editor theme (colours, spacing, typography).
 */
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--surface-bg)",
    color: "var(--text-high)",
    fontFamily: "var(--font-mono)",
    fontSize: "14px",
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.6",
  },
  ".cm-content": {
    padding: "14px",
    caretColor: "var(--text-high)",
  },
  ".cm-line": {
    lineHeight: "1.6",
    padding: "0",
  },
  ".cm-gutters": {
    backgroundColor: "var(--surface-bg)",
    color: "var(--text-low)",
    borderRight: "1px solid var(--border-medium)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--surface-elevated)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--surface-elevated)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--text-high)",
  },
  ".cm-selectionBackground": {
    backgroundColor: "var(--accent-bg)",
  },
});

/**
 * Ready-to-use CodeMirror extensions for syntax highlighting and theme.
 */
export const editorThemeExtensions = [
  syntaxHighlighting(markdownHighlightStyle, { fallback: true }),
  editorTheme,
];

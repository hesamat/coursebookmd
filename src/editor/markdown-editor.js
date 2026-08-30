import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  placeholder,
} from "@codemirror/view";
import {
  history,
  historyKeymap,
  indentWithTab,
  defaultKeymap,
  undo,
  redo,
} from "@codemirror/commands";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { foldGutter, foldKeymap, bracketMatching } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { editorThemeExtensions } from "./codemirror/editor-theme.js";

/**
 * MarkdownEditor
 * CodeMirror 6 wrapper for the coursebook Markdown editor.
 */
export class MarkdownEditor {
  /**
   * @param {HTMLElement} container - The container to render the editor in.
   * @param {object} [options={}] - Editor options.
   * @param {string} [options.placeholder] - Placeholder text for an empty editor.
   * @param {Function} [options.onChange] - Debounced change callback.
   * @param {number} [options.debounceDelay=150] - Debounce delay in ms.
   */
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      placeholder: options.placeholder || "Write your chapter in Markdown...",
      onChange: options.onChange || (() => {}),
      debounceDelay: options.debounceDelay || 150,
    };

    this.debounceTimer = null;
    this.value = "";
    this.view = null;
    this.suppressChange = false;
    this.wrapCompartment = new Compartment();

    this.initializeCodeMirror();
  }

  /**
   * Build the CodeMirror extensions and create the editor view.
   */
  initializeCodeMirror() {
    // Suppress a known Lezer crash where the highlighter touches an
    // incompletely-initialised syntax tree. Harmless, but noisy.
    const suppressLezerCrash = EditorView.exceptionSink.of((ex) => {
      if (
        ex instanceof TypeError &&
        (ex.message.includes("Cannot read properties of undefined") ||
          ex.message.includes("tree.children is undefined") ||
          ex.message.includes("can't access property")) &&
        /hasChild|nextChild|highlightRange/.test(ex.stack || "")
      )
        return;
      throw ex;
    });

    const extensions = [
      suppressLezerCrash,
      this.wrapCompartment.of(EditorView.lineWrapping),
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      search(),
      keymap.of([
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...closeBracketsKeymap,
        ...foldKeymap,
      ]),
      highlightSelectionMatches(),
      foldGutter(),
      bracketMatching(),
      closeBrackets(),
      ...editorThemeExtensions,
      markdown(),
      placeholder(this.options.placeholder),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        this.value = update.state.doc.toString();
        if (this.suppressChange) return;
        this.scheduleOnChange();
      }),
    ];

    this.extensions = extensions;

    this.view = new EditorView({
      state: EditorState.create({
        doc: this.value,
        extensions,
      }),
      parent: this.container,
    });
  }

  /**
   * Set the editor value.
   *
   * Note: this performs a full state reset — undo/redo history, selection,
   * scroll position and folds are all discarded. Use setState() with a
   * stashed EditorState to preserve history across content swaps.
   *
   * @param {string} value
   * @param {object} [options={}]
   * @param {boolean} [options.suppressOnChange=false] - Skip the onChange callback.
   */
  setValue(value, options = {}) {
    this.value = value || "";
    if (!this.view) return;

    const { suppressOnChange = false } = options;
    if (suppressOnChange) this.suppressChange = true;
    this.cancelOnChange();

    try {
      this.view.setState(this.createState(this.value));
    } finally {
      if (suppressOnChange) this.suppressChange = false;
    }
  }

  /**
   * Get the current EditorState, or null if the view is not initialized.
   * @returns {EditorState | null}
   */
  getState() {
    return this.view ? this.view.state : null;
  }

  /**
   * Swap in a previously prepared EditorState (e.g. from getState()).
   * History, selection and folds travel inside the state object, so undo
   * history survives the swap. Any pending debounced onChange is cancelled
   * and no onChange fires for the swapped-in document.
   * @param {EditorState | null} state
   */
  setState(state) {
    if (!this.view || !state) return;
    this.suppressChange = true;
    this.cancelOnChange();
    try {
      this.view.setState(state);
      this.value = state.doc.toString();
    } finally {
      this.suppressChange = false;
    }
  }

  /**
   * Create a fresh EditorState for the given document (no history).
   * @param {string} doc
   * @returns {EditorState}
   */
  createState(doc) {
    return EditorState.create({
      doc: doc || "",
      extensions: this.extensions,
    });
  }

  /**
   * Toggle soft line wrapping at runtime via the wrap Compartment.
   * @param {boolean} enabled
   */
  setWrap(enabled) {
    if (!this.view) return;
    this.view.dispatch({
      effects: this.wrapCompartment.reconfigure(enabled ? EditorView.lineWrapping : []),
    });
  }

  /**
   * Get the current editor value.
   * @returns {string}
   */
  getValue() {
    if (this.view) return this.view.state.doc.toString();
    return this.value;
  }

  /**
   * Insert text at the current cursor position.
   * @param {string} text
   */
  insertText(text) {
    if (!this.view) return;
    const { from, to } = this.view.state.selection.main;
    const newPosition = from + text.length;
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: newPosition, head: newPosition },
    });
  }

  /**
   * Replace a range of text.
   * @param {number} from
   * @param {number} to
   * @param {string} text
   */
  replaceRange(from, to, text) {
    if (!this.view) return;
    const start = Math.max(0, Math.min(from, this.view.state.doc.length));
    const end = Math.max(start, Math.min(to, this.view.state.doc.length));
    const insert = String(text || "");
    this.view.dispatch({
      changes: { from: start, to: end, insert },
      selection: { anchor: start + insert.length, head: start + insert.length },
    });
  }

  /**
   * Focus the editor.
   */
  focus() {
    this.view?.focus();
  }

  /**
   * Move the selection to a specific position.
   * @param {number} anchor
   * @param {number} [head]
   */
  setSelection(anchor, head = anchor) {
    if (!this.view) return;
    const docLength = this.view.state.doc.length;
    const safeAnchor = Math.max(0, Math.min(anchor, docLength));
    const safeHead = Math.max(0, Math.min(head, docLength));
    this.view.dispatch({ selection: { anchor: safeAnchor, head: safeHead } });
  }

  /**
   * Undo the last edit.
   */
  undo() {
    if (this.view) undo(this.view);
  }

  /**
   * Redo the last undone edit.
   */
  redo() {
    if (this.view) redo(this.view);
  }

  /**
   * Cancel the pending debounced onChange callback, if any.
   */
  cancelOnChange() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  scheduleOnChange() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.options.onChange(this.value);
    }, this.options.debounceDelay);
  }

  /**
   * Tear down the CodeMirror view and listeners.
   */
  teardown() {
    this.cancelOnChange();
    this.view?.destroy();
    this.view = null;
  }
}

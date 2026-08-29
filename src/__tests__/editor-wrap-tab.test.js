import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { MarkdownEditor } from "../editor/markdown-editor.js";
import {
  dedentInCodeBlock,
  indentInCodeBlock,
  isInCodeBlock,
} from "../editor/codemirror/line-wrap.js";

const DOC = ["Prose line one.", "", "```js", "let x = 1;", "```", "Prose line two."].join(
  "\n",
);

// 1-based line numbers into DOC.
const PROSE_1 = 1;
const FENCE_OPEN = 3;
const CODE_LINE = 4;
const FENCE_CLOSE = 5;
const PROSE_2 = 6;

describe("isInCodeBlock", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  const editor = () => {
    const ed = new MarkdownEditor(container);
    ed.setValue(DOC, { suppressOnChange: true });
    return ed;
  };

  it("is false for prose positions", () => {
    const ed = editor();
    const state = ed.getState();
    expect(isInCodeBlock(state, state.doc.line(PROSE_1).from)).toBe(false);
    expect(isInCodeBlock(state, state.doc.line(PROSE_2).from + 3)).toBe(false);
    ed.teardown();
  });

  it("is true inside fences, including the fence lines", () => {
    const ed = editor();
    const state = ed.getState();
    expect(isInCodeBlock(state, state.doc.line(FENCE_OPEN).from)).toBe(true);
    expect(isInCodeBlock(state, state.doc.line(CODE_LINE).from + 2)).toBe(true);
    expect(isInCodeBlock(state, state.doc.line(FENCE_CLOSE).from)).toBe(true);
    ed.teardown();
  });

  it("clamps out-of-range positions", () => {
    const ed = editor();
    const state = ed.getState();
    expect(isInCodeBlock(state, -10)).toBe(false);
    expect(isInCodeBlock(state, state.doc.length + 100)).toBe(false);
    ed.teardown();
  });
});

describe("code block Tab commands", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  const editor = () => {
    const ed = new MarkdownEditor(container);
    ed.setValue(DOC, { suppressOnChange: true });
    return ed;
  };

  it("indents when the cursor is inside a fence", () => {
    const ed = editor();
    const codePos = ed.getState().doc.line(CODE_LINE).from + 2;
    ed.setSelection(codePos);
    expect(indentInCodeBlock(ed.view)).toBe(true);
    expect(ed.getValue()).toContain("\n  let x = 1;");
    ed.teardown();
  });

  it("dedents when the cursor is inside a fence", () => {
    const ed = editor();
    const codePos = ed.getState().doc.line(CODE_LINE).from + 2;
    ed.setSelection(codePos);
    expect(indentInCodeBlock(ed.view)).toBe(true);
    expect(dedentInCodeBlock(ed.view)).toBe(true);
    expect(ed.getValue()).toBe(DOC);
    ed.teardown();
  });

  it("is a no-op in prose", () => {
    const ed = editor();
    const prosePos = ed.getState().doc.line(PROSE_1).from + 2;
    ed.setSelection(prosePos);
    expect(indentInCodeBlock(ed.view)).toBe(false);
    expect(ed.getValue()).toBe(DOC);
    ed.teardown();
  });

  it("is a no-op for a selection spanning prose and code", () => {
    const ed = editor();
    const state = ed.getState();
    const prosePos = state.doc.line(PROSE_1).from + 2;
    const codePos = state.doc.line(CODE_LINE).from + 2;
    ed.setSelection(codePos, prosePos);
    expect(indentInCodeBlock(ed.view)).toBe(false);
    expect(ed.getValue()).toBe(DOC);
    ed.teardown();
  });

  it("does not let a Tab keydown insert text in prose (keymap precedence)", () => {
    const ed = editor();
    const prosePos = ed.getState().doc.line(PROSE_1).from + 2;
    ed.setSelection(prosePos);
    const content = ed.view.contentDOM;
    content.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    content.dispatchEvent(event);
    expect(ed.getValue()).toBe(DOC);
    // Not intercepted: the browser keeps its focus-navigation default.
    expect(event.defaultPrevented).toBe(false);
    ed.teardown();
  });

  it("handles a Tab keydown inside a fence via the keymap", () => {
    const ed = editor();
    const codePos = ed.getState().doc.line(CODE_LINE).from + 2;
    ed.setSelection(codePos);
    const content = ed.view.contentDOM;
    content.focus();
    content.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(ed.getValue()).toContain("\n  let x = 1;");
    ed.teardown();
  });
});

describe("wrap preference survives state swaps", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("wrap is on by default and code lines keep their no-wrap class", () => {
    const ed = new MarkdownEditor(container);
    ed.setValue(DOC, { suppressOnChange: true });

    expect(ed.getState().facet(EditorView.lineWrapping)).toBeTruthy();

    const lines = Array.from(ed.view.contentDOM.querySelectorAll(".cm-line"));
    const codeLine = lines.find((l) => l.textContent.includes("let x = 1;"));
    const proseLine = lines.find((l) => l.textContent === "Prose line one.");
    expect(codeLine.classList.contains("cm-no-wrap")).toBe(true);
    expect(proseLine.classList.contains("cm-no-wrap")).toBe(false);

    ed.teardown();
  });

  it("setValue after setWrap(false) keeps wrap off", () => {
    const ed = new MarkdownEditor(container);
    ed.setWrap(false);
    ed.setValue("New chapter", { suppressOnChange: true });
    expect(ed.getState().facet(EditorView.lineWrapping)).toBeFalsy();
    ed.teardown();
  });

  it("setState re-applies the current wrap preference over a stale stashed state", () => {
    const ed = new MarkdownEditor(container, { debounceDelay: 0 });
    ed.setValue("Alpha", { suppressOnChange: true });

    // Stash chapter A while wrap is still on.
    const stashedA = ed.getState();

    // Toggle wrap off, then swap to a fresh chapter B state.
    ed.setWrap(false);
    ed.setState(ed.createState("Beta"));
    expect(ed.getState().facet(EditorView.lineWrapping)).toBeFalsy();

    // Restoring chapter A must not resurrect its stale wrap-on compartment.
    ed.setState(stashedA);
    expect(ed.getState().facet(EditorView.lineWrapping)).toBeFalsy();
    expect(ed.getValue()).toBe("Alpha");

    ed.setWrap(true);
    expect(ed.getState().facet(EditorView.lineWrapping)).toBeTruthy();

    ed.teardown();
  });

  it("typing still works with wrap off", () => {
    const ed = new MarkdownEditor(container);
    ed.setWrap(false);
    ed.setSelection(0);
    ed.insertText("X");
    expect(ed.getValue()).toBe("X");
    ed.teardown();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isInCodeBlock,
  indentInCodeBlock,
  dedentInCodeBlock,
} from "../editor/codemirror/code-tab.js";
import { MarkdownEditor } from "../editor/markdown-editor.js";

const DOC = "prose line\n\n```js\nconst a = 1;\n```\n\nmore prose";

describe("isInCodeBlock", () => {
  let container;
  let editor;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    editor = new MarkdownEditor(container);
    editor.setValue(DOC, { suppressOnChange: true });
  });

  afterEach(() => {
    editor.teardown();
    container.remove();
  });

  const state = () => editor.view.state;

  it("classifies prose positions as outside", () => {
    const firstLine = state().doc.line(1);
    expect(isInCodeBlock(state(), firstLine.from + 2)).toBe(false);
  });

  it("classifies fence content as inside", () => {
    const codeLine = state().doc.line(4);
    expect(isInCodeBlock(state(), codeLine.from + 2)).toBe(true);
  });

  it("classifies both fence marker lines as inside", () => {
    const openFence = state().doc.line(3);
    expect(isInCodeBlock(state(), openFence.from)).toBe(true);
    const closeFence = state().doc.line(5);
    expect(isInCodeBlock(state(), closeFence.to)).toBe(true);
  });

  it("clamps out-of-range positions without throwing", () => {
    expect(() => isInCodeBlock(state(), 99999)).not.toThrow();
    expect(isInCodeBlock(state(), 99999)).toBe(false);
  });
});

describe("code-block Tab commands", () => {
  let container;
  let editor;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    editor = new MarkdownEditor(container);
    editor.setValue(DOC, { suppressOnChange: true });
  });

  afterEach(() => {
    editor.teardown();
    container.remove();
  });

  it("indents when the selection is inside a fence", () => {
    const line = editor.view.state.doc.line(4);
    editor.setSelection(line.from + 2);
    expect(indentInCodeBlock(editor.view)).toBe(true);
    expect(editor.view.state.doc.line(4).text).toBe("  const a = 1;");
  });

  it("dedents when the selection is inside a fence", () => {
    const line = editor.view.state.doc.line(4);
    editor.setSelection(line.from + 2);
    indentInCodeBlock(editor.view);
    expect(dedentInCodeBlock(editor.view)).toBe(true);
    expect(editor.view.state.doc.line(4).text).toBe("const a = 1;");
  });

  it("is a no-op in prose", () => {
    const line = editor.view.state.doc.line(1);
    editor.setSelection(line.from + 1);
    expect(indentInCodeBlock(editor.view)).toBe(false);
    expect(editor.view.state.doc.line(1).text).toBe("prose line");
  });

  it("falls back to the prose no-op for mixed selections", () => {
    const proseLine = editor.view.state.doc.line(1);
    const codeLine = editor.view.state.doc.line(4);
    editor.setSelection(proseLine.from, codeLine.from + 2);
    expect(indentInCodeBlock(editor.view)).toBe(false);
  });

  it("a real Tab keydown in prose inserts nothing and is not prevented", () => {
    const line = editor.view.state.doc.line(1);
    editor.setSelection(line.from + 1);
    editor.view.focus();

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    editor.view.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(editor.getValue()).toBe(DOC);
  });

  it("a real Tab keydown inside a fence indents", () => {
    const line = editor.view.state.doc.line(4);
    editor.setSelection(line.from + 2);
    editor.view.focus();

    editor.view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );

    expect(editor.view.state.doc.line(4).text).toBe("  const a = 1;");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MarkdownEditor } from "../editor/markdown-editor.js";

describe("MarkdownEditor", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it("creates a CodeMirror editor and exposes getValue", () => {
    const editor = new MarkdownEditor(container, {
      placeholder: "Type here...",
    });

    expect(editor.getValue()).toBe("");
    editor.teardown();
  });

  it("updates value through setValue", () => {
    const editor = new MarkdownEditor(container);
    editor.setValue("# Hello", { suppressOnChange: true });

    expect(editor.getValue()).toBe("# Hello");
    editor.teardown();
  });

  it("debounces onChange", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const editor = new MarkdownEditor(container, {
      onChange,
      debounceDelay: 150,
    });

    editor.insertText("Hello");
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    expect(onChange).toHaveBeenCalledWith("Hello");

    editor.teardown();
    vi.useRealTimers();
  });

  it("suppresses onChange when requested", () => {
    const onChange = vi.fn();
    const editor = new MarkdownEditor(container, { onChange });

    editor.setValue("# Hello", { suppressOnChange: true });
    expect(onChange).not.toHaveBeenCalled();
    editor.teardown();
  });

  it("inserts text at the cursor", () => {
    const editor = new MarkdownEditor(container);
    editor.setValue("Hello", { suppressOnChange: true });
    editor.setSelection(5);
    editor.insertText(" world");

    expect(editor.getValue()).toBe("Hello world");
    editor.teardown();
  });

  it("revealLine moves the selection to the start of the given line", () => {
    const editor = new MarkdownEditor(container);
    editor.setValue("one\ntwo\nthree", { suppressOnChange: true });

    editor.revealLine(2);

    expect(editor.view.state.selection.main.head).toBe(4); // after "one\n"
    editor.teardown();
  });

  it("revealLine clamps out-of-range lines into the document", () => {
    const editor = new MarkdownEditor(container);
    editor.setValue("one\ntwo", { suppressOnChange: true });

    editor.revealLine(99);
    expect(editor.view.state.selection.main.head).toBe(4); // start of last line

    editor.revealLine(0);
    expect(editor.view.state.selection.main.head).toBe(0);
    editor.teardown();
  });

  it("revealLine ignores non-finite lines", () => {
    const editor = new MarkdownEditor(container);
    editor.setValue("one", { suppressOnChange: true });
    editor.setSelection(0);

    editor.revealLine(Number.NaN);

    expect(editor.view.state.selection.main.head).toBe(0);
    editor.teardown();
  });

  it("supports undo and redo", () => {
    const editor = new MarkdownEditor(container, { debounceDelay: 0 });
    editor.setValue("Hello", { suppressOnChange: true });
    editor.setSelection(5);
    editor.insertText(" world");

    expect(editor.getValue()).toBe("Hello world");
    editor.undo();
    expect(editor.getValue()).toBe("Hello");
    editor.redo();
    expect(editor.getValue()).toBe("Hello world");

    editor.teardown();
  });

  it("cancels pending onChange when cancelOnChange is called", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const editor = new MarkdownEditor(container, {
      onChange,
      debounceDelay: 150,
    });

    editor.insertText("X");
    editor.cancelOnChange();
    vi.advanceTimersByTime(150);

    expect(onChange).not.toHaveBeenCalled();
    editor.teardown();
    vi.useRealTimers();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createEditButton,
  isRunnableCodeBlock,
  ensureOutputPanel,
  appendRunOutput,
  handleRunAction,
  handleEditAction,
  discardRunPanel,
  schedulePythonWarm,
  setEditHighlighter,
  _overrideRunnerForTests,
  __test,
} from "../renderer/code-run-ui.js";

const { panelStatus, appendRunMeta } = __test;

function makePre(lang, source, info = "") {
  const container = document.createElement("div");
  container.innerHTML = `<pre data-lang="${lang}"${
    info ? ` data-info="${info.replace(/"/g, "&quot;")}"` : ""
  }><code class="language-${lang}">${source}</code></pre>`;
  return container.firstElementChild;
}

// Fake runner module: captures runCode options so tests can drive onDone
// and inspect what the UI submitted, without touching the real worker.
function makeFakeRunner() {
  const calls = [];
  const runCode = vi.fn((opts) => {
    const handle = {
      stop: vi.fn(() => opts.onDone({ ok: false, stopped: true })),
    };
    calls.push({ opts, handle });
    return handle;
  });
  return { runCode, calls };
}

describe("isRunnableCodeBlock", () => {
  it("accepts python and javascript fences marked with run, including aliases", () => {
    expect(isRunnableCodeBlock(makePre("python", "x = 1", "run"))).toBe(true);
    expect(isRunnableCodeBlock(makePre("py", "x = 1", "run"))).toBe(true);
    expect(isRunnableCodeBlock(makePre("javascript", "let x;", "run"))).toBe(true);
    expect(isRunnableCodeBlock(makePre("js", "let x;", "run"))).toBe(true);
  });

  it("rejects blocks without the run opt-in", () => {
    expect(isRunnableCodeBlock(makePre("python", "x = 1"))).toBe(false);
    expect(isRunnableCodeBlock(makePre("javascript", "let x;", ""))).toBe(false);
    expect(isRunnableCodeBlock(makePre("python", "x = 1", 'caption="demo"'))).toBe(false);
  });

  it("rejects other languages", () => {
    expect(isRunnableCodeBlock(makePre("bash", "ls", "run"))).toBe(false);
    expect(isRunnableCodeBlock(makePre("text", "hello", "run"))).toBe(false);
    expect(isRunnableCodeBlock(makePre("markdown", "# hi", "run"))).toBe(false);
  });

  it("does not match run as a substring of another flag", () => {
    expect(isRunnableCodeBlock(makePre("python", "x = 1", "norun"))).toBe(false);
  });

  it("rejects empty and diagram blocks", () => {
    expect(isRunnableCodeBlock(makePre("python", "   ", "run"))).toBe(false);
    const wrap = document.createElement("div");
    wrap.className = "d2-diagram";
    wrap.innerHTML =
      '<pre data-lang="python" data-info="run"><code class="language-python">x = 1</code></pre>';
    expect(isRunnableCodeBlock(wrap.firstElementChild)).toBe(false);
  });
});

describe("ensureOutputPanel", () => {
  it("creates a panel after the pre and pairs it via data attributes", () => {
    const pre = makePre("python", "x = 1");
    document.body.appendChild(pre);
    const panel = ensureOutputPanel(pre);
    expect(panel.className).toBe("code-run-output");
    expect(panel.previousElementSibling).toBe(pre);
    const runId = pre.getAttribute("data-run-id");
    expect(runId).toBeTruthy();
    expect(panel.getAttribute("data-run-for")).toBe(runId);
  });

  it("reuses the existing panel for the same pre", () => {
    const pre = makePre("python", "x = 1");
    document.body.appendChild(pre);
    const first = ensureOutputPanel(pre);
    expect(ensureOutputPanel(pre)).toBe(first);
  });
});

describe("output helpers", () => {
  it("appendRunOutput tags streams and clears a pending status", () => {
    const panel = document.createElement("div");
    panelStatus(panel, "Loading…");
    appendRunOutput(panel, "stdout", "hi\n");
    appendRunOutput(panel, "stderr", "boom\n");
    expect(panel.querySelector(".run-status")).toBeNull();
    expect(panel.querySelector(".run-stdout").textContent).toBe("hi\n");
    expect(panel.querySelector(".run-stderr").textContent).toBe("boom\n");
  });

  it("panelStatus creates, updates, and removes the status line", () => {
    const panel = document.createElement("div");
    panelStatus(panel, "one");
    expect(panel.querySelector(".run-status").textContent).toBe("one");
    panelStatus(panel, "two");
    expect(panel.querySelector(".run-status").textContent).toBe("two");
    panelStatus(panel, null);
    expect(panel.querySelector(".run-status")).toBeNull();
  });

  it("appendRunMeta summarizes the outcome in the header row", () => {
    const panel = document.createElement("div");
    appendRunMeta(panel, { ok: true, durationMs: 400 });
    expect(panel.querySelector(".run-meta").textContent).toBe("Done in 0.4s");
    appendRunMeta(panel, { ok: true });
    expect(panel.querySelector(".run-meta").textContent).toBe("Done");
    appendRunMeta(panel, { ok: false, stopped: true });
    expect(panel.querySelector(".run-meta").textContent).toBe("Stopped");
    appendRunMeta(panel, { ok: false });
    expect(panel.querySelector(".run-meta").textContent).toBe("Failed");
    expect(panel.querySelector(".run-meta").className).toContain("run-meta-failed");
  });

  it("ensureOutputPanel builds a header and a body", () => {
    const pre = makePre("python", "x = 1");
    document.body.appendChild(pre);
    const panel = ensureOutputPanel(pre);
    expect(panel.querySelector(".run-head .run-label").textContent).toBe("Output");
    expect(panel.querySelector(".run-body")).not.toBeNull();
  });
});

describe("handleRunAction", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("runs a block, flips the button into stop state, and finishes cleanly", async () => {
    const fake = makeFakeRunner();
    _overrideRunnerForTests(fake);

    const pre = makePre("python", "print('hi')", "run");
    const button = document.createElement("button");
    button.className = "code-run-button";
    pre.appendChild(button);
    document.body.appendChild(pre);

    await handleRunAction(pre);

    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0].opts.lang).toBe("python");
    expect(fake.calls[0].opts.code).toBe("print('hi')");
    expect(button.classList.contains("is-running")).toBe(true);

    const panel = document.querySelector(".code-run-output");
    expect(panel).not.toBeNull();
    expect(panel.querySelector(".run-status").textContent).toBe("Running…");

    fake.calls[0].opts.onOutput("stdout", "hi\n");
    fake.calls[0].opts.onDone({ ok: true, durationMs: 250 });
    expect(button.classList.contains("is-running")).toBe(false);
    expect(panel.querySelector(".run-status")).toBeNull();
    expect(panel.querySelector(".run-stdout").textContent).toBe("hi\n");
    expect(panel.querySelector(".run-meta").textContent).toBe("Done in 0.3s");

    // The completed session is gone: a fresh click starts a new run.
    await handleRunAction(pre);
    expect(fake.calls.length).toBe(2);
  });

  it("clears the status line for a run that produced no output", async () => {
    const fake = makeFakeRunner();
    _overrideRunnerForTests(fake);

    const pre = makePre("python", "x = 1", "run");
    document.body.appendChild(pre);

    await handleRunAction(pre);
    expect(document.querySelector(".code-run-output .run-status").textContent).toBe(
      "Running…",
    );

    fake.calls[0].opts.onDone({ ok: true, durationMs: 40 });
    expect(document.querySelector(".code-run-output .run-status")).toBeNull();
    expect(document.querySelector(".code-run-output .run-meta").textContent).toBe(
      "Done in <0.1s",
    );
  });

  it("acts as a stop button while a session is active", async () => {
    const fake = makeFakeRunner();
    _overrideRunnerForTests(fake);

    const pre = makePre("javascript", "console.log(1)", "run");
    document.body.appendChild(pre);
    await handleRunAction(pre);
    await handleRunAction(pre);

    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0].handle.stop).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".code-run-output .run-meta").textContent).toBe(
      "Stopped",
    );
  });

  it("does nothing for blocks without the run opt-in", async () => {
    const fake = makeFakeRunner();
    _overrideRunnerForTests(fake);
    const pre = makePre("python", "x = 1");
    document.body.appendChild(pre);
    await handleRunAction(pre);
    expect(fake.runCode).not.toHaveBeenCalled();
    expect(document.querySelector(".code-run-output")).toBeNull();
  });

  it("discardRunPanel stops the session and removes the panel", async () => {
    const fake = makeFakeRunner();
    _overrideRunnerForTests(fake);
    const pre = makePre("python", "x = 1", "run");
    document.body.appendChild(pre);
    await handleRunAction(pre);
    const panel = document.querySelector(".code-run-output");

    discardRunPanel(pre.getAttribute("data-run-id"));

    expect(fake.calls[0].handle.stop).toHaveBeenCalledTimes(1);
    expect(panel.isConnected).toBe(false);
  });
});

describe("handleEditAction", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function makeEditablePre() {
    const pre = makePre("python", "x = 1", "run");
    const button = document.createElement("button");
    button.className = "code-edit-button";
    pre.appendChild(button);
    document.body.appendChild(pre);
    return { pre, button };
  }

  it("enters edit mode with a draft carrying the fence source", () => {
    const { pre, button } = makeEditablePre();

    handleEditAction(pre);

    expect(pre.classList.contains("is-editing")).toBe(true);
    const textarea = pre.querySelector(".code-edit-area");
    expect(textarea?.value).toBe("x = 1");
    expect(button.getAttribute("aria-label")).toBe("Reset code");
    expect(button.getAttribute("title")).toBe("Reset");
  });

  it("reset restores the original code and the edit button", () => {
    const { pre, button } = makeEditablePre();
    handleEditAction(pre);
    pre.querySelector(".code-edit-area").value = "y = 2";

    handleEditAction(pre);

    expect(pre.classList.contains("is-editing")).toBe(false);
    expect(pre.querySelector(".code-edit-area")).toBeNull();
    expect(pre.querySelector("code").textContent).toBe("x = 1");
    expect(button.getAttribute("aria-label")).toBe("Edit code");
    expect(button.getAttribute("title")).toBe("Edit");
  });

  it("ignores blocks without the run opt-in", () => {
    const pre = makePre("python", "x = 1");
    document.body.appendChild(pre);

    handleEditAction(pre);

    expect(pre.classList.contains("is-editing")).toBe(false);
    expect(pre.querySelector(".code-edit-area")).toBeNull();
  });

  it("a button created for an editing pre reflects the reset state", () => {
    const pre = makePre("python", "x = 1", "run");
    document.body.appendChild(pre);
    handleEditAction(pre);

    const button = createEditButton(pre);
    pre.appendChild(button);

    expect(button.getAttribute("aria-label")).toBe("Reset code");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("runs the live draft, not the fence source", async () => {
    const fake = makeFakeRunner();
    _overrideRunnerForTests(fake);
    const { pre } = makeEditablePre();
    handleEditAction(pre);
    pre.querySelector(".code-edit-area").value = "print('edited')";

    await handleRunAction(pre);

    expect(fake.calls[0].opts.code).toBe("print('edited')");
  });

  it("runs the pristine source again after reset", async () => {
    const fake = makeFakeRunner();
    _overrideRunnerForTests(fake);
    const { pre } = makeEditablePre();
    handleEditAction(pre);
    pre.querySelector(".code-edit-area").value = "y = 2";
    handleEditAction(pre);

    await handleRunAction(pre);

    expect(fake.calls[0].opts.code).toBe("x = 1");
  });
});

describe("edit mode highlighting", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    setEditHighlighter(null);
    vi.useRealTimers();
  });

  function makeRunnable() {
    const pre = makePre("python", "x = 1", "run");
    document.body.appendChild(pre);
    return pre;
  }

  it("overlays a token layer that tracks the draft", async () => {
    vi.useFakeTimers();
    setEditHighlighter((source) => `<pre class="shiki"><code>tok:${source}</code></pre>`);
    const pre = makeRunnable();

    handleEditAction(pre);

    const stack = pre.querySelector(".code-edit-stack");
    expect(stack).not.toBeNull();
    expect(stack.querySelector(".code-edit-highlight")).not.toBeNull();
    expect(pre.querySelector(".code-edit-area").value).toBe("x = 1");

    await vi.advanceTimersByTimeAsync(130);
    expect(stack.querySelector(".code-edit-highlight pre")?.textContent).toBe(
      "tok:x = 1",
    );

    const textarea = pre.querySelector(".code-edit-area");
    textarea.value = "y = 2";
    textarea.dispatchEvent(new window.Event("input"));
    await vi.advanceTimersByTimeAsync(130);
    expect(stack.querySelector(".code-edit-highlight pre")?.textContent).toBe(
      "tok:y = 2",
    );
    expect(stack.classList.contains("is-plain")).toBe(false);
  });

  it("falls back to visible draft text when highlighting fails", async () => {
    vi.useFakeTimers();
    setEditHighlighter(async () => null);
    const pre = makeRunnable();

    handleEditAction(pre);
    await vi.advanceTimersByTimeAsync(130);

    expect(pre.querySelector(".code-edit-stack").classList.contains("is-plain")).toBe(
      true,
    );
  });

  it("stays plain-text without a registered highlighter", () => {
    const pre = makeRunnable();

    handleEditAction(pre);

    expect(pre.querySelector(".code-edit-stack")).toBeNull();
    expect(pre.querySelector(".code-edit-area")).not.toBeNull();
  });
});

describe("schedulePythonWarm", () => {
  it("warms when the content has a runnable python block", async () => {
    document.body.innerHTML = "";
    const warmPython = vi.fn();
    _overrideRunnerForTests({ runCode: vi.fn(), warmPython });
    document.body.appendChild(makePre("python", "x = 1", "run"));

    let scheduled = 0;
    schedulePythonWarm(document.body, {
      schedule: (fn) => {
        scheduled += 1;
        fn();
      },
    });

    expect(scheduled).toBe(1);
    await Promise.resolve();
    expect(warmPython).toHaveBeenCalledTimes(1);
  });

  it("does not warm without a runnable python block", () => {
    document.body.innerHTML = "";
    const warmPython = vi.fn();
    _overrideRunnerForTests({ runCode: vi.fn(), warmPython });
    document.body.appendChild(makePre("javascript", "let x;", "run"));

    let scheduled = 0;
    schedulePythonWarm(document.body, {
      schedule: (fn) => {
        scheduled += 1;
        fn();
      },
    });

    expect(scheduled).toBe(0);
    expect(warmPython).not.toHaveBeenCalled();
  });
});

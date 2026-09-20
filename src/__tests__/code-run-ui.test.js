import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isRunnableCodeBlock,
  ensureOutputPanel,
  appendRunOutput,
  handleRunAction,
  discardRunPanel,
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
    expect(panel.querySelector(".run-status").textContent).toContain(
      "Loading Python runtime",
    );

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

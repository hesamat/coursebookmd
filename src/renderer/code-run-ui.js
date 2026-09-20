/**
 * Shared run-button behavior for fenced python/javascript code blocks.
 *
 * ContentEnhancer creates these buttons in the main app (per-button
 * listeners, like the copy button), and export-runtime.js wires the
 * serialized buttons through delegated clicks. Both surfaces call
 * handleRunAction, so the behavior lives here exactly once.
 *
 * The execution engine (core/code-runner.js, which pulls in the inline
 * worker and its ~10 MB Pyodide download) is imported lazily on the first
 * Run click; nothing loads until a student asks for it.
 */

import { icon } from "../core/icon.js";
import { normalizeCodeLanguage } from "../core/utils.js";

const RUNNABLE_LANGUAGES = new Set(["python", "javascript"]);

const activeSessions = new Map(); // run id → { stop() }
let runCounter = 0;

let runnerPromise = null;
function loadRunner() {
  if (!runnerPromise) {
    runnerPromise = import("../core/code-runner.js");
  }
  return runnerPromise;
}

/** Swap in a fake runner module (must expose runCode) for unit tests. */
export function _overrideRunnerForTests(mod) {
  runnerPromise = Promise.resolve(mod);
}

function languageOf(pre) {
  const codeEl = pre.querySelector(":scope > code");
  return (
    pre.getAttribute("data-lang") ||
    codeEl?.className.match(/(?:lang|language)-(\S+)/)?.[1] ||
    "text"
  );
}

/**
 * A fenced block is runnable when its language is python or javascript and
 * the author opted in with `run` in the fence info string. Opt-in, not
 * opt-out: course code routinely needs things the browser sandbox cannot
 * provide (input(), files, packages), so a block only gets a Run button
 * when the author knows it works standalone.
 * @param {HTMLElement} pre
 * @returns {boolean}
 */
export function isRunnableCodeBlock(pre) {
  if (!pre || pre.closest(".d2-diagram, .svg-diagram")) return false;
  const info = pre.getAttribute("data-info") || "";
  if (!/\brun\b/.test(info)) return false;
  const source =
    pre.getAttribute("data-source") ??
    pre.querySelector(":scope > code")?.textContent ??
    "";
  if (source.trim() === "") return false;
  return RUNNABLE_LANGUAGES.has(normalizeCodeLanguage(languageOf(pre)));
}

function setRunButtonRunning(button, running) {
  if (!button) return;
  button.classList.toggle("is-running", running);
  const svg = button.querySelector("svg");
  if (svg) svg.remove();
  const next = icon(running ? "stop" : "play", { size: "sm" });
  if (next) button.appendChild(next);
  button.setAttribute("aria-label", running ? "Stop code" : "Run code");
  button.setAttribute("title", running ? "Stop" : "Run");
}

function ensureRunId(pre) {
  let runId = pre.getAttribute("data-run-id");
  if (!runId) {
    runId = `run-block-${++runCounter}`;
    pre.setAttribute("data-run-id", runId);
  }
  return runId;
}

function runHeadOf(panel) {
  let head = panel.querySelector(".run-head");
  if (!head) {
    head = document.createElement("div");
    head.className = "run-head";
    const label = document.createElement("span");
    label.className = "run-label";
    label.textContent = "Output";
    head.appendChild(label);
    panel.prepend(head);
  }
  return head;
}

function runBodyOf(panel) {
  let body = panel.querySelector(".run-body");
  if (!body) {
    body = document.createElement("div");
    body.className = "run-body";
    panel.appendChild(body);
  }
  return body;
}

/** Build (or rebuild) the panel's header row and output body. */
function buildRunChrome(panel) {
  runHeadOf(panel);
  runBodyOf(panel);
}

/**
 * Find or create the output panel that belongs to this pre, inserted as
 * its next sibling. The lookup is document-wide so a block that was run
 * inside the media-zoom stage reuses (and moves) the same panel instead
 * of spawning a second one.
 * @param {HTMLElement} pre
 * @returns {HTMLElement}
 */
export function ensureOutputPanel(pre) {
  const runId = ensureRunId(pre);
  let panel = document.querySelector(`.code-run-output[data-run-for="${runId}"]`);
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "code-run-output";
    panel.setAttribute("data-run-for", runId);
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "Code output");
  }
  buildRunChrome(panel);
  if (panel.previousElementSibling !== pre) {
    pre.after(panel);
  }
  return panel;
}

function panelStatus(panel, message) {
  const head = runHeadOf(panel);
  let status = head.querySelector(".run-status");
  if (!message) {
    status?.remove();
    return;
  }
  if (!status) {
    status = document.createElement("span");
    status.className = "run-status";
    status.setAttribute("aria-live", "polite");
    head.appendChild(status);
  }
  status.textContent = message;
}

/**
 * Append one streamed chunk to the panel. Each chunk becomes its own span
 * so stdout and stderr can carry different styling.
 * @param {HTMLElement} panel
 * @param {"stdout"|"stderr"} stream
 * @param {string} text
 */
export function appendRunOutput(panel, stream, text) {
  panelStatus(panel, null);
  const span = document.createElement("span");
  span.className = stream === "stderr" ? "run-stderr" : "run-stdout";
  span.textContent = text;
  runBodyOf(panel).appendChild(span);
}

function appendRunMeta(panel, outcome) {
  const head = runHeadOf(panel);
  head.querySelector(".run-meta")?.remove();
  const meta = document.createElement("span");
  meta.className = `run-meta${outcome.ok ? "" : " run-meta-failed"}`;
  if (outcome.stopped) {
    meta.textContent = "Stopped";
  } else if (outcome.ok) {
    meta.textContent =
      outcome.durationMs != null && outcome.durationMs < 100
        ? "Done in <0.1s"
        : outcome.durationMs != null
          ? `Done in ${(outcome.durationMs / 1000).toFixed(1)}s`
          : "Done";
  } else {
    meta.textContent = "Failed";
  }
  head.appendChild(meta);
}

/**
 * Run or stop the code in this block. While a session is active the run
 * button acts as a stop button (terminating the worker — the only way to
 * interrupt an infinite loop).
 * @param {HTMLElement} pre
 */
export async function handleRunAction(pre) {
  if (!isRunnableCodeBlock(pre)) return;
  const runId = ensureRunId(pre);

  const active = activeSessions.get(runId);
  if (active) {
    active.stop();
    return;
  }

  const lang = normalizeCodeLanguage(languageOf(pre));
  const code =
    pre.getAttribute("data-source") ??
    pre.querySelector(":scope > code")?.textContent ??
    "";
  const button = pre.querySelector(".code-run-button");
  const panel = ensureOutputPanel(pre);
  panel.replaceChildren();
  buildRunChrome(panel);

  panelStatus(
    panel,
    lang === "python"
      ? "Loading Python runtime — the first run downloads ~10 MB…"
      : "Running…",
  );
  setRunButtonRunning(button, true);

  let runner;
  try {
    runner = await loadRunner();
  } catch {
    setRunButtonRunning(button, false);
    panelStatus(panel, null);
    appendRunOutput(panel, "stderr", "Could not load the code runner.\n");
    return;
  }

  const handle = runner.runCode({
    lang,
    code,
    onStatus: (message) => panelStatus(panel, message),
    onOutput: (stream, text) => appendRunOutput(panel, stream, text),
    onDone: (outcome) => {
      activeSessions.delete(runId);
      setRunButtonRunning(button, false);
      appendRunMeta(panel, outcome);
    },
  });
  activeSessions.set(runId, handle);
}

/**
 * Stop a block's session and drop its output panel. Used when an edit
 * replaced the pre the panel belonged to, or a section is torn down.
 * @param {string} runId
 */
export function discardRunPanel(runId) {
  activeSessions.get(runId)?.stop();
  activeSessions.delete(runId);
  document
    .querySelectorAll(`.code-run-output[data-run-for="${runId}"]`)
    .forEach((panel) => panel.remove());
}

/** Stop every active session (full re-renders leave nothing to write to). */
export function discardAllRunSessions() {
  for (const handle of activeSessions.values()) handle.stop();
  activeSessions.clear();
}

export function createRunButton(pre) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-run-button";
  button.setAttribute("aria-label", "Run code");
  button.setAttribute("title", "Run");

  const playIcon = icon("play", { size: "sm" });
  if (playIcon) button.appendChild(playIcon);

  button.addEventListener("click", (e) => {
    e.preventDefault();
    handleRunAction(pre);
  });
  return button;
}

// Pure DOM transforms exported for unit testing.
export const __test = {
  isRunnableCodeBlock,
  ensureOutputPanel,
  appendRunOutput,
  panelStatus,
  appendRunMeta,
};

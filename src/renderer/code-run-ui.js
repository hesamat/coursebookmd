/**
 * Shared run- and edit-button behavior for fenced python/javascript code
 * blocks.
 *
 * ContentEnhancer creates these buttons in the main app (per-button
 * listeners, like the copy button), and export-runtime.js wires the
 * serialized buttons through delegated clicks. Both surfaces call
 * handleRunAction / handleEditAction, so the behavior lives here exactly once.
 *
 * The execution engine (core/code-runner.js, which pulls in the inline
 * worker and its ~10 MB Pyodide download) is imported lazily. On pages with
 * a runnable Python block the runtime is preloaded in the background
 * (schedulePythonWarm), so the first click has no download stall.
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

function defaultSchedule(fn) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(fn);
  } else {
    setTimeout(fn, 2500);
  }
}

/**
 * Kick off the background Python preload once, when the content contains a
 * runnable Python block. Idle-scheduled so it never competes with render;
 * the runner itself ignores repeat calls and production builds only.
 * @param {ParentNode} rootEl
 * @param {{ schedule?: (fn: () => void) => void }} [opts] injected scheduler for unit tests
 */
export function schedulePythonWarm(rootEl, opts = {}) {
  if (!rootEl) return;
  const hasPython = Array.from(rootEl.querySelectorAll("pre")).some(
    (pre) =>
      normalizeCodeLanguage(languageOf(pre)) === "python" && isRunnableCodeBlock(pre),
  );
  if (!hasPython) return;
  (opts.schedule ?? defaultSchedule)(() => {
    loadRunner()
      .then((runner) => runner.warmPython?.())
      .catch(() => {
        // No warm runtime is fine — the first run cold-starts instead.
      });
  });
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

/**
 * A completed run with no stdout/stderr gets an explicit muted note in the
 * body — an empty panel would read as "nothing happened" rather than
 * "this program legitimately printed nothing".
 */
function appendRunEmptyNote(panel) {
  const body = runBodyOf(panel);
  if (body.querySelector(".run-empty")) return;
  const note = document.createElement("span");
  note.className = "run-empty";
  note.textContent = "No output";
  body.appendChild(note);
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
  const code = currentCodeSource(pre);
  const button = pre.querySelector(".code-run-button");
  const panel = ensureOutputPanel(pre);
  panel.replaceChildren();
  buildRunChrome(panel);

  // The worker reports the real "Loading Python runtime…" status on a cold
  // start; a prewarmed runtime goes straight to output, so stay neutral.
  panelStatus(panel, "Running…");
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

  let sawOutput = false;
  const handle = runner.runCode({
    lang,
    code,
    onStatus: (message) => panelStatus(panel, message),
    onOutput: (stream, text) => {
      sawOutput = true;
      appendRunOutput(panel, stream, text);
    },
    onDone: (outcome) => {
      activeSessions.delete(runId);
      setRunButtonRunning(button, false);
      // A run that produced no output never cleared the status line
      // (only output chunks do), so drop it before the outcome meta.
      panelStatus(panel, null);
      if (outcome.ok && !outcome.stopped && !sawOutput) {
        appendRunEmptyNote(panel);
      }
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

// ---- Edit / reset mode ----

const editSessions = new WeakMap(); // pre → session

/**
 * When a highlighter is registered (main app; the export runtime ships no
 * Shiki), edit mode overlays Shiki tokens under the textarea's transparent
 * text. Without one, editing falls back to plain text.
 */
let editHighlighter = null;
export function setEditHighlighter(highlight) {
  editHighlighter = highlight;
}

export function isEditing(pre) {
  return editSessions.has(pre);
}

/**
 * The code Run and Copy should act on: the reader's live draft while the
 * block is in edit mode, the pristine fence source otherwise.
 * @param {HTMLElement} pre
 * @returns {string}
 */
export function currentCodeSource(pre) {
  const session = editSessions.get(pre);
  if (session) return session.textarea.value;
  return (
    pre?.getAttribute("data-source") ??
    pre?.querySelector(":scope > code")?.textContent ??
    ""
  );
}

function setEditButtonReset(button, editing) {
  if (!button) return;
  const svg = button.querySelector("svg");
  if (svg) svg.remove();
  const next = icon(editing ? "reload" : "edit", { size: "sm" });
  if (next) button.appendChild(next);
  button.setAttribute("aria-label", editing ? "Reset code" : "Edit code");
  button.setAttribute("title", editing ? "Reset" : "Edit");
}

/**
 * Textareas don't grow with their content, so track it on every input. The
 * second pass compensates for the horizontal scrollbar: where it takes real
 * layout space (non-overlay scrollbars), a height of scrollHeight would
 * otherwise clip the last line behind it. With allowShrink, the collapse-
 * and-measure pass runs (three forced layouts on a full page); insertion
 * input types skip it because they can only grow or keep the height.
 */
function autosizeEditArea(textarea, { allowShrink = true } = {}) {
  if (allowShrink) textarea.style.height = "auto";
  const target = textarea.scrollHeight;
  if (!allowShrink && target <= textarea.clientHeight) return;
  textarea.style.height = `${target}px`;
  const overflow = textarea.scrollHeight - textarea.clientHeight;
  if (overflow > 0) textarea.style.height = `${target + overflow}px`;
}

const EDIT_HIGHLIGHT_THROTTLE_MS = 100;

/**
 * Re-render the token layer from the draft. The render itself runs on the
 * main thread, so sustained typing is throttled — but a keystroke after an
 * idle period renders immediately (the draft text is transparent, so every
 * millisecond of delay is a millisecond the reader's newest characters are
 * invisible), and anything typed mid-render queues one trailing pass.
 */
function scheduleEditHighlight(pre) {
  const session = editSessions.get(pre);
  if (!session?.highlight) return;
  if (session.highlightBusy) {
    session.highlightQueued = true;
    return;
  }
  const elapsed = Date.now() - session.lastHighlightAt;
  if (elapsed >= EDIT_HIGHLIGHT_THROTTLE_MS) {
    runEditHighlight(pre, session);
    return;
  }
  clearTimeout(session.highlightTimer);
  session.highlightTimer = setTimeout(
    () => runEditHighlight(pre, session),
    EDIT_HIGHLIGHT_THROTTLE_MS - elapsed,
  );
}

async function runEditHighlight(pre, session) {
  session.highlightBusy = true;
  session.lastHighlightAt = Date.now();
  clearTimeout(session.highlightTimer);
  const draft = session.textarea.value;
  let html = null;
  try {
    html = await editHighlighter(draft, languageOf(pre));
  } catch {
    html = null;
  }
  session.highlightBusy = false;
  if (editSessions.get(pre) !== session) return;
  if (html) {
    const temp = document.createElement("template");
    temp.innerHTML = html;
    const shikiPre = temp.content.querySelector("pre");
    if (shikiPre) {
      session.stack.classList.remove("is-plain");
      session.highlight.replaceChildren(shikiPre);
      syncEditScroll(session);
    } else {
      session.stack.classList.add("is-plain");
    }
  } else {
    // No tokens for this draft (or the language): keep the draft readable.
    session.stack.classList.add("is-plain");
  }
  if (session.highlightQueued) {
    session.highlightQueued = false;
    runEditHighlight(pre, session);
  }
}

function syncEditScroll(session) {
  session.highlight.scrollLeft = session.textarea.scrollLeft;
  session.highlight.scrollTop = session.textarea.scrollTop;
}

// Insertions can only grow the draft (or keep it), so the expensive
// collapse-and-measure autosize pass is reserved for deletions and other
// inputs that can shrink it.
const GROW_ONLY_INPUT_TYPES = new Set([
  "insertText",
  "insertCompositionText",
  "insertFromPaste",
  "insertFromDrop",
  "insertLineBreak",
  "insertParagraph",
]);

function wireEditArea(pre, session) {
  const { textarea } = session;
  textarea.addEventListener("input", (e) => {
    autosizeEditArea(textarea, {
      allowShrink: !GROW_ONLY_INPUT_TYPES.has(e.inputType),
    });
    scheduleEditHighlight(pre);
  });
  textarea.addEventListener("scroll", () => syncEditScroll(session));
  textarea.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.shiftKey) return;
    e.preventDefault();
    const { selectionStart, selectionEnd, value } = textarea;
    textarea.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
    autosizeEditArea(textarea);
    scheduleEditHighlight(pre);
  });
}

export function enterEditMode(pre, { initialValue } = {}) {
  if (!isRunnableCodeBlock(pre) || editSessions.has(pre)) return;
  const codeEl = pre.querySelector(":scope > code");
  if (!codeEl) return;

  const textarea = document.createElement("textarea");
  textarea.className = "code-edit-area";
  textarea.value = initialValue ?? currentCodeSource(pre);
  textarea.setAttribute("spellcheck", "false");
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.setAttribute("wrap", "off");
  textarea.setAttribute("aria-label", "Edit code");

  const session = {
    textarea,
    stack: null,
    highlight: null,
    highlightTimer: 0,
    highlightBusy: false,
    highlightQueued: false,
    lastHighlightAt: 0,
  };

  if (editHighlighter) {
    // Overlay editor: a Shiki token layer sits under the textarea's
    // transparent text; typing re-highlights the draft (see scheduleEditHighlight).
    const stack = document.createElement("div");
    stack.className = "code-edit-stack";
    const highlight = document.createElement("div");
    highlight.className = "code-edit-highlight";
    highlight.setAttribute("aria-hidden", "true");
    stack.appendChild(highlight);
    stack.appendChild(textarea);
    pre.appendChild(stack);
    session.stack = stack;
    session.highlight = highlight;
  } else {
    pre.appendChild(textarea);
  }

  wireEditArea(pre, session);
  pre.classList.add("is-editing");
  editSessions.set(pre, session);
  setEditButtonReset(pre.querySelector(".code-edit-button"), true);
  autosizeEditArea(textarea);
  if (session.highlight) scheduleEditHighlight(pre);
  textarea.focus();
}

export function exitEditMode(pre) {
  const session = editSessions.get(pre);
  if (!session) return;
  editSessions.delete(pre);
  clearTimeout(session.highlightTimer);
  session.stack?.remove();
  session.textarea.remove();
  pre.classList.remove("is-editing");
  setEditButtonReset(pre.querySelector(".code-edit-button"), false);
}

/**
 * Toggle the block's edit mode. The highlighted <code> stays in the DOM but
 * is hidden while editing (CSS), so the original markup survives and Reset
 * is a plain restore — no re-highlight needed.
 * @param {HTMLElement} pre
 */
export function handleEditAction(pre) {
  if (!isRunnableCodeBlock(pre)) return;
  if (editSessions.has(pre)) exitEditMode(pre);
  else enterEditMode(pre);
}

export function createEditButton(pre) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-edit-button";

  // A button created for a pre that is already editing (the re-highlight
  // swap re-opens the editor before buttons are re-added) must reflect it.
  // setEditButtonReset also installs the icon.
  setEditButtonReset(button, isEditing(pre));

  button.addEventListener("click", (e) => {
    e.preventDefault();
    handleEditAction(pre);
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

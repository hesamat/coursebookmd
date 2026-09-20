/**
 * Main-thread manager for the code runner worker.
 *
 * Runs are isolated: every run posts to a worker that gives it a clean
 * interpreter state, and "Stop" is a plain terminate (the only way to kill
 * an infinite loop). The worker source is inlined by Vite
 * (`?worker&inline`), so the worker works from a Blob URL on file://
 * exports as well.
 *
 * warmPython() starts a resident worker that preloads the Python runtime in
 * the background; runs prefer it over a cold start. Fresh state per run is
 * preserved by the worker (fresh namespace per run), not by killing the
 * worker, so stopping a run on the resident worker just retires it and the
 * next run cold-spawns transparently.
 */

import CodeRunWorker from "./code-run-worker.js?worker&inline";

export const PYODIDE_VERSION = "0.28.3";
export const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;

function nextRunId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

let warm = null; // { worker, sessions, busy, ready }
let warmFailedAt = 0;

function retireWarm() {
  if (!warm) return;
  try {
    warm.worker.terminate();
  } catch {
    // Worker already gone — nothing to clean up.
  }
  warm = null;
}

function finishSession(entry, session, outcome) {
  if (!entry.sessions.has(session.id)) return;
  entry.sessions.delete(session.id);
  if (entry !== warm) {
    try {
      entry.worker.terminate();
    } catch {
      // Worker already gone.
    }
  } else if (outcome.stopped) {
    // A stop must hard-kill a runaway run, so the warm worker dies with it;
    // the next run cold-spawns and warmPython() can warm a new one.
    retireWarm();
  } else {
    entry.busy = false;
  }
  session.onDone?.(outcome);
}

function attachRouter(entry) {
  entry.worker.onmessage = (event) => {
    const msg = event.data;
    if (!msg || msg.id === undefined) return;
    if (msg.type === "warm-ok") {
      entry.ready = true;
      return;
    }
    if (msg.type === "warm-failed") {
      retireWarm();
      return;
    }
    const session = entry.sessions.get(msg.id);
    if (!session) return;
    if (msg.type === "status") {
      session.onStatus?.(msg.message);
    } else if (msg.type === "output") {
      session.onOutput?.(msg.stream, msg.text);
    } else if (msg.type === "done") {
      finishSession(entry, session, { ok: msg.ok, durationMs: msg.durationMs });
    }
  };

  entry.worker.onerror = () => {
    for (const session of entry.sessions.values()) {
      session.onOutput?.("stderr", "The code runner failed unexpectedly.\n");
      finishSession(entry, session, { ok: false });
    }
    if (warm === entry) retireWarm();
  };
}

/**
 * Start (or keep) a resident worker that preloads the Python runtime in the
 * background. Callers gate when to call this (the main app prewarms in
 * production builds only, so dev and e2e runs never touch the CDN
 * unprompted); the export runtime always prewarms — it only exists in
 * production builds.
 */
export function warmPython() {
  if (warm || Date.now() - warmFailedAt < 60_000) return;
  try {
    const worker = new CodeRunWorker();
    warm = { worker, sessions: new Map(), busy: false, ready: false };
    attachRouter(warm);
    worker.postMessage({ type: "warm", id: nextRunId(), pyodideUrl: PYODIDE_URL });
  } catch {
    warm = null;
    warmFailedAt = Date.now();
  }
}

/**
 * Run code on the warm worker when it is free, otherwise on a fresh worker.
 * @param {object} opts
 * @param {"python"|"javascript"} opts.lang
 * @param {string} opts.code
 * @param {(message: string) => void} [opts.onStatus]
 * @param {(stream: "stdout"|"stderr", text: string) => void} [opts.onOutput]
 * @param {(outcome: {ok: boolean, stopped?: boolean, durationMs?: number}) => void} [opts.onDone]
 * @returns {{ stop: () => void }}
 */
export function runCode({ lang, code, onStatus, onOutput, onDone }) {
  const id = nextRunId();
  let entry;

  if (warm && warm.ready && !warm.busy) {
    entry = warm;
    entry.busy = true;
  } else {
    entry = { worker: null, sessions: new Map(), busy: true, ready: true };
    try {
      entry.worker = new CodeRunWorker();
    } catch {
      onOutput?.("stderr", "Could not start the code runner in this browser.\n");
      onDone?.({ ok: false });
      return { stop() {} };
    }
    attachRouter(entry);
  }

  const worker = entry.worker;
  const session = {
    id,
    onStatus,
    onOutput,
    onDone: (outcome) => {
      finishSession(entry, session, outcome);
      onDone?.(outcome);
    },
  };
  entry.sessions.set(id, session);

  worker.postMessage({ type: "run", id, lang, code, pyodideUrl: PYODIDE_URL });

  return {
    stop() {
      finishSession(entry, session, { ok: false, stopped: true });
    },
  };
}

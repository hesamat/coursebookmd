/**
 * Main-thread manager for the code runner worker.
 *
 * One short-lived worker per run keeps sessions isolated: "Stop" is a plain
 * terminate (which is also the only way to kill an infinite loop), and every
 * run starts from a clean interpreter state. The worker source is inlined by
 * Vite (`?worker&inline`), so the worker works from a Blob URL on file://
 * exports as well.
 */

import CodeRunWorker from "./code-run-worker.js?worker&inline";

export const PYODIDE_VERSION = "0.28.3";
export const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;

function nextRunId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Run code in a fresh worker.
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
  let worker = null;
  let finished = false;

  const finish = (outcome) => {
    if (finished) return;
    finished = true;
    try {
      if (worker) worker.terminate();
    } catch {
      // Worker already gone — nothing to clean up.
    }
    onDone?.(outcome);
  };

  try {
    worker = new CodeRunWorker();
  } catch {
    finish({ ok: false });
    onOutput?.("stderr", "Could not start the code runner in this browser.\n");
    return { stop() {} };
  }

  worker.onmessage = (event) => {
    const msg = event.data;
    if (!msg || msg.id !== id) return;
    if (msg.type === "status") {
      onStatus?.(msg.message);
    } else if (msg.type === "output") {
      onOutput?.(msg.stream, msg.text);
    } else if (msg.type === "done") {
      finish({ ok: msg.ok, durationMs: msg.durationMs });
    }
  };

  worker.onerror = () => {
    finish({ ok: false });
    onOutput?.("stderr", "The code runner failed unexpectedly.\n");
  };

  worker.postMessage({ type: "run", id, lang, code, pyodideUrl: PYODIDE_URL });

  return {
    stop() {
      finish({ ok: false, stopped: true });
    },
  };
}

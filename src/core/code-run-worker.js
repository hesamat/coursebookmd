/**
 * Worker source for the code runner.
 *
 * Bundled by Vite as a classic inline worker (`?worker&inline`): it compiles
 * to an IIFE that is instantiated from a Blob URL, which also works on
 * file:// exported books. Local imports are fine (Vite bundles them), but
 * worker-only globals are reached through `self` — also so ESLint's
 * no-undef stays quiet about the dynamically loaded `loadPyodide`.
 *
 * Main → worker: { type: "run", id, lang, code, pyodideUrl }
 * Worker → main: { type: "status", id, message }
 *                { type: "output", id, stream: "stdout"|"stderr", text }
 *                { type: "done", id, ok, durationMs }
 */

import { stripReplPrompts } from "./utils.js";

const MAX_OUTPUT_CHARS = 200_000;

let outputBudget = MAX_OUTPUT_CHARS;

function post(message) {
  self.postMessage(message);
}

function emitOutput(id, stream, text) {
  if (!text || outputBudget <= 0) return;
  if (text.length > outputBudget) {
    post({ type: "output", id, stream, text: text.slice(0, outputBudget) });
    post({ type: "output", id, stream: "stderr", text: "\n[output truncated]" });
    outputBudget = 0;
    return;
  }
  outputBudget -= text.length;
  post({ type: "output", id, stream, text });
}

// ---- JavaScript ----

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

function formatJsValue(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "function") return String(value);
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

async function runJavaScript(id, code) {
  const original = {};
  for (const method of ["log", "info", "debug", "warn", "error"]) {
    original[method] = console[method];
    const stream = method === "warn" || method === "error" ? "stderr" : "stdout";
    console[method] = (...args) => {
      emitOutput(id, stream, `${args.map(formatJsValue).join(" ")}\n`);
    };
  }
  try {
    // Body of an async function: top-level await and return work naturally.
    await new AsyncFunction(code)();
  } finally {
    for (const method of Object.keys(original)) {
      console[method] = original[method];
    }
  }
}

// ---- Python (Pyodide) ----

let pyodide = null;
let pyodideReady = null;

// Classic workers load Pyodide's global script via importScripts; module
// workers (as served by the dev server) define importScripts but throw on
// the call, so the failure falls back to the CDN's ES module build.
async function loadPyodideScript(pyodideUrl) {
  if (typeof self.importScripts === "function") {
    try {
      self.importScripts(pyodideUrl);
      return self.loadPyodide;
    } catch {
      // Module worker — use the dynamic-import path below.
    }
  }
  const moduleUrl = pyodideUrl.replace(/\.js$/, ".mjs");
  const mod = await import(/* @vite-ignore */ moduleUrl);
  return mod.loadPyodide ?? mod.default?.loadPyodide;
}

async function ensurePyodide(id, pyodideUrl) {
  if (pyodide) return pyodide;
  if (!pyodideReady) {
    pyodideReady = (async () => {
      post({ type: "status", id, message: "Loading Python runtime…" });
      const loadPyodide = await loadPyodideScript(pyodideUrl);
      const indexURL = pyodideUrl.replace(/[^/]*$/, "");
      return await loadPyodide({ indexURL });
    })();
  }
  try {
    pyodide = await pyodideReady;
  } catch (err) {
    pyodideReady = null;
    const reason = err && err.message ? err.message : String(err);
    throw new Error(`Could not load the Python runtime: ${reason}`);
  }
  return pyodide;
}

async function runPython(id, code, pyodideUrl) {
  const py = await ensurePyodide(id, pyodideUrl);
  py.setStdout({ batched: (text) => emitOutput(id, "stdout", `${text}\n`) });
  py.setStderr({ batched: (text) => emitOutput(id, "stderr", `${text}\n`) });
  py.setStdin({
    stdin: () => {
      throw new Error("input() is not supported in the browser code runner");
    },
  });

  const result = await py.runPythonAsync(stripReplPrompts(code));

  if (result !== undefined && result !== null) {
    try {
      py.globals.set("__coursebook_last", result);
      const repr = py.runPython("repr(__coursebook_last)");
      emitOutput(id, "stdout", `${repr}\n`);
    } catch {
      // A repr failure shouldn't mask a run that otherwise finished.
    } finally {
      if (result && typeof result.destroy === "function") result.destroy();
    }
  }
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "run") return;
  const { id, lang, code, pyodideUrl } = msg;

  outputBudget = MAX_OUTPUT_CHARS;
  const startedAt = performance.now();
  let ok = true;
  try {
    if (lang === "python") {
      await runPython(id, code, pyodideUrl);
    } else {
      await runJavaScript(id, code);
    }
  } catch (err) {
    ok = false;
    const text = err && err.message ? err.message : String(err);
    emitOutput(id, "stderr", `${text}\n`);
  } finally {
    // Fresh state per run: the next run boots a clean interpreter.
    pyodide = null;
    pyodideReady = null;
    post({
      type: "done",
      id,
      ok,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
};

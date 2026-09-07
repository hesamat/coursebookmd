/**
 * present-window-controller.js — Opens and feeds the separate presentation
 * window (present.html), composed by app.js via injected dependencies.
 *
 * The opener keeps the editor/TOC; the popup receives the already-rendered
 * coursebook via same-origin DOM adoption (never innerHTML) plus a small
 * metadata payload. See src/present/popup-main.js for the receiver side.
 */
import {
  PRESENT_DATA_MESSAGE,
  PRESENT_READY_MESSAGE,
  buildPopupMetadata,
} from "../present/popup-helpers.js";
import {
  BOUNDS_STORAGE_KEY,
  featuresFromBounds,
  parseStoredBounds,
  pickTargetScreen,
} from "../present/window-placement.js";
import { chapterSectionSlug } from "../core/coursebook-loader.js";

const PRESENT_WINDOW_NAME = "coursebookmd-present";

export function createPresentWindowController(deps) {
  const { state, showToast } = deps;

  let presentWin = null;

  function isAlive() {
    return Boolean(presentWin && !presentWin.closed);
  }

  async function openPresentWindow() {
    if (isAlive()) {
      presentWin.focus();
      transferContent();
      return;
    }

    let bounds = null;
    try {
      bounds = parseStoredBounds(localStorage.getItem(BOUNDS_STORAGE_KEY));
    } catch {
      bounds = null;
    }

    // Open synchronously inside the click gesture so popup blockers allow
    // it; placement and navigation follow once the screen API resolves.
    const win = window.open(
      "about:blank",
      PRESENT_WINDOW_NAME,
      featuresFromBounds(bounds),
    );
    if (!win) {
      showToast("Allow pop-ups for this site to open the presentation window.");
      return;
    }
    presentWin = win;

    try {
      if (typeof window.getScreenDetails === "function") {
        const details = await window.getScreenDetails();
        const target = pickTargetScreen(details);
        if (target) {
          win.moveTo(target.availLeft, target.availTop);
          win.resizeTo(target.availWidth, target.availHeight);
        }
      } else if (bounds) {
        win.moveTo(bounds.left, bounds.top);
        win.resizeTo(bounds.width, bounds.height);
      }
    } catch {
      // Multi-screen API unavailable or permission denied — keep the
      // feature-string placement; the user can still drag the window.
    }

    if (win.closed) {
      presentWin = null;
      return;
    }
    win.location.href = new URL("/present.html", window.location.origin).href;
  }

  /**
   * Push the currently rendered coursebook into the popup. DOM adoption
   * only — the rendered tree (Shiki/KaTeX/D2 already enhanced, local images
   * as same-origin blob: URLs) moves intact, so the popup needs no
   * renderer, enhancer, or coursebook of its own.
   */
  function transferContent() {
    const win = presentWin;
    if (!isAlive()) return;
    const doc = win.document;
    const target = doc.getElementById("content");
    if (!target) return;

    target.textContent = "";
    const clone = state.contentEl.cloneNode(true);
    // Copy buttons bind their listeners per-element; clones would be dead
    // buttons, and code copying is editor-facing chrome a projection
    // doesn't need.
    for (const btn of clone.querySelectorAll(".code-copy-button")) {
      btn.remove();
    }
    for (const node of Array.from(clone.childNodes)) {
      target.appendChild(doc.adoptNode(node));
    }

    win.postMessage(
      { type: PRESENT_DATA_MESSAGE, ...buildPopupMetadata(state, chapterSectionSlug) },
      window.location.origin,
    );
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (!isAlive() || event.source !== presentWin) return;
    if (event.data?.type === PRESENT_READY_MESSAGE) transferContent();
  });

  return { openPresentWindow };
}

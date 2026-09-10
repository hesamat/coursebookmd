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
  PRESENT_THEME_MESSAGE,
  PRESENT_VIEW_MESSAGE,
  SCROLL_MESSAGE,
  VIEW_MESSAGE,
  buildPopupMetadata,
  shouldApplyView,
} from "../present/popup-helpers.js";
import {
  BOUNDS_STORAGE_KEY,
  boundsFromScreen,
  featuresFromBounds,
  parseStoredBounds,
  pickTargetScreen,
} from "../present/window-placement.js";
import { createScrollSync } from "../present/scroll-sync.js";
import { chapterSectionSlug } from "../core/coursebook-loader.js";

const PRESENT_WINDOW_NAME_PREFIX = "coursebookmd-present";

/**
 * Named windows are shared per origin, so a fixed name would let a second
 * app tab navigate the first tab's live popup away (window.open resolves an
 * existing window by name across tabs). A per-tab suffix from sessionStorage
 * keeps each tab's popup its own while surviving reloads of the same tab.
 */
function presentWindowName() {
  const KEY = "cbmd-present-window-name";
  try {
    let name = sessionStorage.getItem(KEY);
    if (!name) {
      name = `${PRESENT_WINDOW_NAME_PREFIX}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(KEY, name);
    }
    return name;
  } catch {
    // Storage unavailable — a unique name still avoids cross-tab reuse.
    return `${PRESENT_WINDOW_NAME_PREFIX}-${Math.random().toString(36).slice(2)}`;
  }
}

export function createPresentWindowController(deps) {
  const { state, showToast, toggleTheme, getViewState, followView } = deps;

  let presentWin = null;
  // View sync: `applyingRemoteView` blocks the re-broadcast that a followed
  // remote move would otherwise trigger. `lastView` is the last position the
  // two windows agreed on (sent or followed), so duplicate pushes are dropped
  // while a position the popup moved away from can still be pushed again.
  let applyingRemoteView = false;
  let lastView = null;

  function isAlive() {
    return Boolean(presentWin && !presentWin.closed);
  }

  // Bidirectional scroll mirroring with the popup. Anchors are shared block ids
  // assigned by the navigator, so the two differently-sized panes agree.
  const scrollSync = state.previewPane
    ? createScrollSync({
        pane: state.previewPane,
        getContent: () => state.contentEl,
        getChapterIdx: () => state.currentChapterIdx,
        getSuppressed: () => state.scrollSpy?.isSuppressed?.() ?? false,
        onSend: (payload) => {
          if (!isAlive()) return;
          presentWin.postMessage(
            { type: SCROLL_MESSAGE, ...payload },
            window.location.origin,
          );
        },
      })
    : null;
  scrollSync?.attach();

  let cachedDetails = null;
  let detailsRequest = null;
  let placementNoticeShown = false;

  function screenApiAvailable() {
    return typeof window.getScreenDetails === "function";
  }

  /**
   * Resolve and cache getScreenDetails(). Concurrent calls share one request,
   * and the cache is dropped when the display arrangement changes so the next
   * open re-reads the screens. Resolves to null when the API is unavailable or
   * the request is refused.
   */
  function loadScreenDetails() {
    if (!screenApiAvailable()) return Promise.resolve(null);
    if (cachedDetails) return Promise.resolve(cachedDetails);
    if (!detailsRequest) {
      detailsRequest = Promise.resolve()
        .then(() => window.getScreenDetails())
        .then((details) => {
          cachedDetails = details;
          details?.addEventListener?.("screenschange", () => {
            cachedDetails = null;
          });
          return details;
        })
        .catch(() => null)
        .finally(() => {
          detailsRequest = null;
        });
    }
    return detailsRequest;
  }

  function placeWindow(win, bounds) {
    try {
      win.moveTo(bounds.left, bounds.top);
      win.resizeTo(bounds.width, bounds.height);
    } catch {
      // The window is gone or refused the move; the open-time placement stands.
    }
  }

  function notifyPlacementUnavailable() {
    if (placementNoticeShown) return;
    // A single-screen device has nowhere else to place the window; don't nag.
    if (window.screen?.isExtended === false) return;
    placementNoticeShown = true;
    showToast(
      "Couldn't place the presentation on another display. Allow window management for this site to enable it.",
    );
  }

  // Warm the screen details on the first interaction so a later Present can
  // open straight onto the target display while window.open() stays synchronous
  // (a synchronous open is what keeps the popup from being blocked).
  if (screenApiAvailable()) {
    const prime = () => void loadScreenDetails();
    window.addEventListener("pointerdown", prime, {
      once: true,
      capture: true,
      passive: true,
    });
    window.addEventListener("keydown", prime, { once: true, capture: true });
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

    // Place at open time when the screen details are known: passing the target
    // screen's bounds to window.open() is the documented, reliable placement
    // path. Only fall back to moving the window when they are not cached yet.
    const targetBounds = boundsFromScreen(pickTargetScreen(cachedDetails));
    const win = window.open(
      "about:blank",
      presentWindowName(),
      featuresFromBounds(targetBounds ?? bounds),
    );
    if (!win) {
      showToast("Allow pop-ups for this site to open the presentation window.");
      return;
    }
    presentWin = win;

    if (!targetBounds) {
      const details = await loadScreenDetails();
      const lateBounds = boundsFromScreen(pickTargetScreen(details));
      if (lateBounds) {
        placeWindow(win, lateBounds);
      } else if (screenApiAvailable()) {
        // Supported but refused (permission denied or blocked policy): the
        // window stays where it opened, so say why instead of failing silently.
        notifyPlacementUnavailable();
      } else if (bounds) {
        // No multi-screen API — enforce remembered bounds, since window.open()
        // feature placement alone is unreliable across browsers.
        placeWindow(win, bounds);
      }
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

  /**
   * The popup's T key lands here (it cannot re-run Shiki itself): flip the
   * theme in the main window, then re-push so the popup gets freshly
   * highlighted content under the new theme.
   */
  async function togglePresentationTheme() {
    await toggleTheme?.();
    transferContent();
  }

  /**
   * Push the main window's current chapter/section to the popup so the
   * projector follows the laptop. A view push never transfers content, and
   * it is suppressed while a remote view is being applied, so the two
   * windows cannot echo each other.
   */
  function pushView() {
    if (
      !isAlive() ||
      applyingRemoteView ||
      (scrollSync?.isActive() ?? false) ||
      typeof getViewState !== "function"
    ) {
      return;
    }
    const view = getViewState();
    if (!view || !shouldApplyView(view, lastView)) return;
    lastView = view;
    presentWin.postMessage({ type: VIEW_MESSAGE, ...view }, window.location.origin);
  }

  /**
   * Follow the projector: the popup is authoritative while presenting, so
   * its position becomes the main window's. Payloads equal to the main
   * window's current position are ignored (the echo case).
   */
  async function applyRemoteView(view) {
    if (applyingRemoteView || typeof followView !== "function") return;
    if (!shouldApplyView(view, null)) return;
    const current = typeof getViewState === "function" ? getViewState() : null;
    const incoming = { chapterIdx: view.chapterIdx, sectionId: view.sectionId };
    if (!shouldApplyView(view, current)) {
      // Already there — record the agreement so a later move away and back is
      // still pushed.
      lastView = incoming;
      return;
    }
    applyingRemoteView = true;
    try {
      await followView(incoming);
    } catch {
      // A failed follow must not wedge the echo guard or the popup.
    } finally {
      applyingRemoteView = false;
    }
    lastView = incoming;
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (!isAlive() || event.source !== presentWin) return;
    if (event.data?.type === PRESENT_READY_MESSAGE) transferContent();
    if (event.data?.type === PRESENT_THEME_MESSAGE) void togglePresentationTheme();
    if (event.data?.type === PRESENT_VIEW_MESSAGE) void applyRemoteView(event.data);
    if (event.data?.type === SCROLL_MESSAGE) applyRemoteScroll(event.data);
  });

  /** Apply the popup's fine scroll position, dropping anchors from other chapters. */
  function applyRemoteScroll(payload) {
    if (!payload || payload.chapterIdx !== state.currentChapterIdx) return;
    scrollSync?.apply(payload);
  }

  return { openPresentWindow, pushView, primeScreenDetails: loadScreenDetails };
}

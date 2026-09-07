/**
 * present-mode.js — Shared presentation-mode engine for the live app, the
 * presentation popup window, and the standalone HTML export.
 *
 * Owns the behavior that must never drift between the hosts: the
 * presenting/blacked-out/spotlight class state, the keyboard shortcuts
 * sheet (mode-aware blocks + platform modifier labels), the overlay text,
 * and the rule that leaving native fullscreen leaves presentation mode.
 *
 * Hosts inject their DOM and navigator access and keep only their own
 * keyboard-routing gates (editor/modals in the app, preview focus in the
 * export). Entering presentation takes the window fullscreen; the
 * fullscreenchange listener ties leaving fullscreen to leaving the mode.
 */

import { isMacPlatform } from "./utils.js";

/**
 * @param {object} deps
 * @param {() => object | null} deps.getNavigator - SectionNavigator-like
 *   object ({ setup, clearHighlight, toggleSpotlight, currentIdx, current,
 *   count, currentText, nextText }) or null.
 * @param {object} [deps.overlay] - { root, current, next, progress } elements.
 * @param {object} [deps.sheet] - { root, backdrop, presentGrid, normalGrid }
 *   keyboard-shortcuts-sheet elements. `presentGrid`/`normalGrid` are the
 *   mode-aware row blocks toggled by present state.
 * @param {() => string | null} [deps.getNextChapterTitle] - Title of the
 *   chapter after the current one, or null at the end.
 * @param {() => void} [deps.onPresented] - Called after the presenting
 *   visuals have applied (double rAF); hosts scroll to top and re-seed
 *   their scroll-spy here.
 * @param {() => void} [deps.onExit] - Replaces the Escape-exit action for
 *   hosts where leaving presentation means leaving the page (the popup
 *   closes its window); the internal cleanup is skipped.
 * @param {boolean} [deps.exitOnFullscreenExit=true] - Whether leaving
 *   native fullscreen leaves presentation mode. The popup opts out:
 *   un-fullscreening the projector window should not end the presentation.
 * @param {() => void} [deps.onToggleTheme] - Host theme switch, invoked for
 *   the plain T key while presenting. Hosts supply their own so the app can
 *   also re-run Shiki highlighting while the export only flips the theme.
 */
export function createPresentMode(deps) {
  const { getNavigator, overlay = null, sheet = null } = deps;
  const getNextChapterTitle = deps.getNextChapterTitle ?? (() => null);
  const onPresented = deps.onPresented ?? (() => {});
  const onExit = deps.onExit ?? (() => exit());
  const exitOnFullscreenExit = deps.exitOnFullscreenExit ?? true;
  const onToggleTheme = deps.onToggleTheme ?? null;

  let presenting = false;

  function isPresenting() {
    return presenting;
  }

  function enter() {
    if (presenting) return;
    presenting = true;
    document.body.classList.add("presenting");
    document.body.classList.remove("blacked-out");
    if (getNavigator()?.spotlight) document.body.classList.add("spotlight");
    syncSheetMode();

    // Presentation takes the window fullscreen, like every presentation tool.
    // Sandboxed previews (opaque-origin frames) refuse fullscreen; presenting
    // still works in-window. Leaving fullscreen exits presentation mode (see
    // the fullscreenchange listener below).
    try {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } catch {
      // Fullscreen unavailable — stay in-window.
    }

    // The double requestAnimationFrame waits for the visual mode change to
    // apply (CSS display:none on the chrome) before the host scrolls, so
    // positions are computed against the final layout.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        onPresented();
        updateOverlay();
      });
    });
  }

  function exit() {
    if (!presenting) return;
    presenting = false;
    document.body.classList.remove("presenting", "spotlight", "blacked-out");
    sheet?.root?.classList.add("hidden");
    getNavigator()?.clearHighlight();
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  function toggle() {
    if (presenting) exit();
    else enter();
  }

  /**
   * Overlay text for the current waypoint. `heading` optionally overrides
   * the navigator's current heading (the app passes the active h3, whose
   * navigator waypoint is its parent h2).
   */
  function updateOverlay({ heading } = {}) {
    if (!overlay?.root || !getNavigator()) return;
    const navigator = getNavigator();
    overlay.current.textContent = heading?.textContent?.trim() || navigator.currentText;
    const next = navigator.nextText;
    const nextChapterTitle = getNextChapterTitle();
    if (next) {
      overlay.next.textContent = "Next: " + next;
    } else if (nextChapterTitle) {
      overlay.next.textContent = "Next chapter: " + nextChapterTitle;
    } else {
      overlay.next.textContent = "End of coursebook";
    }
    const count = navigator.count;
    overlay.progress.textContent =
      count > 0 ? `Section ${navigator.currentIdx + 1} of ${count}` : "";
  }

  function toggleBlackout() {
    if (!presenting) return;
    document.body.classList.toggle("blacked-out");
  }

  function toggleSpotlight() {
    if (!presenting) return;
    getNavigator()?.toggleSpotlight();
  }

  function syncSheetMode() {
    const presentingNow = presenting;
    sheet?.presentGrid?.classList.toggle("hidden", !presentingNow);
    sheet?.normalGrid?.classList.toggle("hidden", presentingNow);
  }

  function toggleSheet() {
    sheet?.root?.classList.toggle("hidden");
    syncSheetMode();
  }

  function closeSheet() {
    sheet?.root?.classList.add("hidden");
  }

  /**
   * Present-mode key handling shared by both hosts. Call from the plain-key
   * path (`isShortcutCombo: false`) and from the modifier-combo branch
   * (`isShortcutCombo: true`, which handles only S/B — matching the apps'
   * behavior where combos toggle spotlight/black-out directly, even over a
   * blacked-out screen).
   *
   * @param {KeyboardEvent} e
   * @param {object} [opts]
   * @param {boolean} [opts.isShortcutCombo]
   * @returns {boolean} true when the event was consumed.
   */
  function handlePresentKeys(e, { isShortcutCombo = false } = {}) {
    if (isShortcutCombo) {
      if (!presenting) return false;
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        toggleSpotlight();
        return true;
      }
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        toggleBlackout();
        return true;
      }
      return false;
    }

    // Black-out screen: while blanked, any key wakes the screen without
    // navigating (PowerPoint behavior). B toggles the black-out; Escape also
    // falls through to exit presentation mode below.
    if (document.body.classList.contains("blacked-out")) {
      if (e.key !== "b" && e.key !== "B" && e.key !== "Escape") {
        e.preventDefault();
        document.body.classList.remove("blacked-out");
        return true;
      }
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        document.body.classList.remove("blacked-out");
        return true;
      }
      document.body.classList.remove("blacked-out");
    }

    // Keyboard shortcuts sheet: ? toggles it (in normal mode too); Escape
    // closes the open sheet before other Escape handling (so closing the
    // sheet never exits presentation mode).
    if (handleSheetKeys(e)) return true;

    if (!presenting) return false;

    if (e.key === "Escape") {
      e.preventDefault();
      onExit();
      return true;
    }

    if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      toggleSpotlight();
      return true;
    }

    if (e.key === "b" || e.key === "B") {
      e.preventDefault();
      toggleBlackout();
      return true;
    }

    if (e.key === "t" || e.key === "T") {
      e.preventDefault();
      onToggleTheme?.();
      return true;
    }

    return false;
  }

  /**
   * Shortcuts-sheet toggling for the plain-key path. Available outside
   * presentation mode too (the app offers ? while reading); Escape closes
   * the open sheet before other Escape handling so closing it never exits
   * presentation mode.
   */
  function handleSheetKeys(e) {
    if (
      e.key === "?" ||
      (e.key === "Escape" && !sheet?.root?.classList.contains("hidden"))
    ) {
      e.preventDefault();
      toggleSheet();
      return true;
    }
    return false;
  }

  // Any click wakes a blacked-out screen (like PowerPoint) without doing
  // anything else; when not blacked-out this listener is a no-op.
  document.addEventListener("click", () => {
    if (document.body.classList.contains("blacked-out")) {
      document.body.classList.remove("blacked-out");
    }
  });

  // Backdrop click closes the shortcuts sheet.
  sheet?.backdrop?.addEventListener("click", () => {
    closeSheet();
  });

  // Leaving native fullscreen always leaves presentation mode, so the two
  // states can never disagree. Hosts that live on their own window (the
  // popup) opt out: un-fullscreening must not end the presentation there.
  if (exitOnFullscreenExit) {
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && presenting) {
        exit();
      }
    });
  }

  // The shortcuts sheet spells the modifier combo in the platform's flavor:
  // Ctrl+Alt on Windows/Linux, ⌘+⌃ on macOS (same combo isShortcut accepts).
  if (isMacPlatform) {
    document
      .querySelectorAll("[data-mod-main]")
      .forEach((el) => (el.textContent = "⌘ Cmd"));
    document
      .querySelectorAll("[data-mod-alt]")
      .forEach((el) => (el.textContent = "⌃ Ctrl"));
  }

  return {
    enter,
    exit,
    toggle,
    isPresenting,
    updateOverlay,
    toggleBlackout,
    toggleSpotlight,
    toggleSheet,
    closeSheet,
    handleSheetKeys,
    handlePresentKeys,
  };
}

/**
 * presentation-controller.js — Presentation mode (immersive in-window),
 * waypoint-only navigation, spotlight, black-out screen, the keyboard
 * shortcuts sheet, and keyboard/scroll navigation, composed by app.js via
 * injected dependencies. Native fullscreen is never touched here; the
 * maximize button owns it. Controllers never import each other;
 * cross-controller calls are routed through deps.
 */
import { isMacPlatform, isShortcut } from "../core/utils.js";
import { ThemeManager } from "../core/theme-manager.js";

export function createPresentationController(deps) {
  const { state, chapterRenderer, editorController, updateOverlay, onThemeChange } = deps;

  function enterPresent() {
    document.body.classList.add("presenting");
    document.body.classList.remove("blacked-out");
    if (state.sectionNavigator?.spotlight) document.body.classList.add("spotlight");
    syncShortcutsSheetMode();

    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }

    // The double requestAnimationFrame waits for the visual mode change to
    // apply (CSS display:none on the app chrome) before scrolling, so the
    // scroll position is computed against the final layout.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        state.previewPane.scrollTo({ top: 0, behavior: "auto" });
        state.sectionNavigator?.setup();
        chapterRenderer.setupScrollSpyForCurrentChapter();
        updateOverlay(
          state.sectionNavigator?.currentIdx,
          state.sectionNavigator?.current,
        );
      });
    });
  }

  function exitPresent() {
    document.body.classList.remove("presenting", "spotlight", "blacked-out");
    state.shortcutsSheet?.classList.add("hidden");
    state.sectionNavigator?.clearHighlight();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  // Any click wakes a blacked-out screen (like PowerPoint) without doing
  // anything else; when not blacked-out this listener is a no-op.
  document.addEventListener("click", () => {
    if (document.body.classList.contains("blacked-out")) {
      document.body.classList.remove("blacked-out");
    }
  });

  // Show the shortcut list that matches the current mode: presenting keys
  // (spotlight, black-out, exit) vs normal-mode keys (edit, theme toggles).
  function syncShortcutsSheetMode() {
    const presenting = document.body.classList.contains("presenting");
    state.shortcutsSheetPresent?.classList.toggle("hidden", !presenting);
    state.shortcutsSheetNormal?.classList.toggle("hidden", presenting);
  }

  // The shortcuts sheet spells the app's modifier combo in the platform's
  // flavor: Ctrl+Alt on Windows/Linux, ⌘+⌃ on macOS (same combo isShortcut
  // accepts).
  if (isMacPlatform) {
    document
      .querySelectorAll("[data-mod-main]")
      .forEach((el) => (el.textContent = "⌘ Cmd"));
    document
      .querySelectorAll("[data-mod-alt]")
      .forEach((el) => (el.textContent = "⌃ Ctrl"));
  }

  state.shortcutsSheetBackdrop?.addEventListener("click", () => {
    state.shortcutsSheet.classList.add("hidden");
  });

  state.presentBtn.addEventListener("click", enterPresent);
  state.toggleFullscreenBtn.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });

  document.addEventListener("keydown", async (e) => {
    // Don't intercept when typing in the editor, unless the user is using the
    // edit-mode shortcut to close the editor while it has focus.
    const inEditor = state.editorEl.contains(e.target);
    const closingEditor =
      inEditor && state.editMode && (e.key === "e" || e.key === "E") && isShortcut(e);
    if (inEditor && !closingEditor) return;

    if (isShortcut(e)) {
      const presenting = document.body.classList.contains("presenting");
      switch (e.key) {
        case "p":
        case "P":
          e.preventDefault();
          if (presenting) exitPresent();
          else enterPresent();
          break;
        case "e":
        case "E":
          if (presenting) break;
          e.preventDefault();
          await editorController.setEditMode(!state.editMode);
          break;
        case "i":
        case "I":
          if (presenting) break;
          e.preventDefault();
          ThemeManager.toggleTheme();
          await onThemeChange();
          break;
        case "s":
        case "S":
          if (!presenting) break;
          e.preventDefault();
          state.sectionNavigator?.toggleSpotlight();
          break;
        case "b":
        case "B":
          if (!presenting) break;
          e.preventDefault();
          document.body.classList.toggle("blacked-out");
          break;
      }
      return;
    }

    const presenting = document.body.classList.contains("presenting");

    // In normal mode, only use arrow/page/home/space keys when focus is inside
    // the preview pane, the navigation sidebar, or on the body. Never while a
    // modal/menu is open or focus is in a text input.
    const isTextInput =
      e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/i.test(e.target.tagName);
    const modalOpen =
      !state.settingsModal.classList.contains("hidden") ||
      !state.openFolderModal.classList.contains("hidden") ||
      !state.menuDropdown.classList.contains("hidden");
    const inPreview =
      presenting ||
      state.previewPane.contains(e.target) ||
      state.tocPane.contains(e.target) ||
      e.target === document.body;
    if (isTextInput || modalOpen || !inPreview) return;

    // Black-out screen: while blanked, any key wakes the screen without
    // navigating (PowerPoint behavior). B toggles the black-out; Escape also
    // falls through to exit presentation mode below.
    if (presenting && document.body.classList.contains("blacked-out")) {
      if (e.key !== "b" && e.key !== "B" && e.key !== "Escape") {
        e.preventDefault();
        document.body.classList.remove("blacked-out");
        return;
      }
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        document.body.classList.remove("blacked-out");
        return;
      }
      document.body.classList.remove("blacked-out");
    }

    // Keyboard shortcuts sheet: ? toggles it; Escape closes it before other
    // Escape handling (so closing the sheet never exits presentation mode).
    // The listed shortcuts follow the current mode.
    if (
      e.key === "?" ||
      (e.key === "Escape" && !state.shortcutsSheet.classList.contains("hidden"))
    ) {
      e.preventDefault();
      state.shortcutsSheet.classList.toggle("hidden");
      syncShortcutsSheetMode();
      return;
    }

    // macOS: Command+Up/Down scrolls to top/bottom of the current chapter.
    if (isMacPlatform && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        state.previewPane.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        state.previewPane.scrollTo({
          top: state.previewPane.scrollHeight,
          behavior: "smooth",
        });
        return;
      }
    }

    const SCROLL_STEP = Math.max(120, Math.round(state.previewPane.clientHeight * 0.5));

    // Let Space/Page on a button activate the button (e.g. a TOC/chapter item
    // or the prev/next chapter controls) instead of treating it as section nav.
    if (
      e.target.closest("button") &&
      (e.key === " " || e.key === "PageUp" || e.key === "PageDown")
    ) {
      return;
    }

    // Section and scroll navigation. Works in both present and normal mode:
    //   Left/Right/Space/Page move between sections, Up/Down scroll, Home/End
    //   jump to the first/last section.
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        state.scrollSpy.withNavigatorScroll(() => state.sectionNavigator?.next(), true);
        break;
      case " ":
      case "PageDown":
        e.preventDefault();
        state.scrollSpy.withNavigatorScroll(
          () => state.sectionNavigator?.next({ syncVisual: false }),
          false,
        );
        break;
      case "ArrowLeft":
        e.preventDefault();
        state.scrollSpy.withNavigatorScroll(() => state.sectionNavigator?.prev(), true);
        break;
      case "PageUp":
        e.preventDefault();
        state.scrollSpy.withNavigatorScroll(
          () => state.sectionNavigator?.prev({ syncVisual: false }),
          false,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        state.previewPane.scrollBy({ top: -SCROLL_STEP, behavior: "smooth" });
        break;
      case "ArrowDown":
        e.preventDefault();
        state.previewPane.scrollBy({ top: SCROLL_STEP, behavior: "smooth" });
        break;
      case "Home":
        e.preventDefault();
        state.scrollSpy.withNavigatorScroll(
          () => state.sectionNavigator?.first({ syncVisual: false }),
          false,
        );
        break;
      case "End":
        e.preventDefault();
        state.scrollSpy.withNavigatorScroll(
          () => state.sectionNavigator?.last({ syncVisual: false }),
          false,
        );
        break;
      case "s":
      case "S":
        if (!presenting) break;
        e.preventDefault();
        state.sectionNavigator?.toggleSpotlight();
        break;
      case "b":
      case "B":
        if (!presenting) break;
        e.preventDefault();
        document.body.classList.toggle("blacked-out");
        break;
      case "Escape":
        if (!presenting) break;
        e.preventDefault();
        exitPresent();
        break;
    }
  });

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && document.body.classList.contains("presenting")) {
      exitPresent();
    }
  });

  return { enterPresent, exitPresent };
}

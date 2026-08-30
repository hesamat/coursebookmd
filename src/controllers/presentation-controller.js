/**
 * presentation-controller.js — Presentation mode, fullscreen, and
 * keyboard/scroll navigation, composed by app.js via injected dependencies.
 * Controllers never import each other; cross-controller calls are routed
 * through deps.
 */
import { isMacPlatform, isShortcut } from "../core/utils.js";
import { ThemeManager } from "../core/theme-manager.js";

export function createPresentationController(deps) {
  const { state, chapterRenderer, editorController, updateOverlay, onThemeChange } = deps;

  function enterPresent() {
    document.body.classList.add("presenting");
    if (state.sectionNavigator?.spotlight) document.body.classList.add("spotlight");

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
    document.body.classList.remove("presenting", "spotlight");
    state.sectionNavigator?.clearHighlight();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

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

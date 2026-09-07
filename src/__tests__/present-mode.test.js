import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPresentMode } from "../core/present-mode.js";

/**
 * Stub a SectionNavigator-like object; the core only touches the surface
 * the real SectionNavigator exposes.
 */
function stubNavigator() {
  return {
    spotlight: false,
    currentIdx: 0,
    count: 2,
    currentText: "Intro",
    nextText: "Details",
    clearHighlight: vi.fn(),
    toggleSpotlight: vi.fn(function () {
      this.spotlight = !this.spotlight;
    }),
    setup: vi.fn(),
  };
}

function stubOverlay() {
  const root = document.createElement("div");
  root.id = "overlay";
  const current = document.createElement("div");
  const next = document.createElement("div");
  const progress = document.createElement("div");
  return { root, current, next, progress };
}

function stubSheet() {
  const root = document.createElement("div");
  // The real sheet ships closed (index.html gives it the hidden utility).
  root.className = "hidden";
  const backdrop = document.createElement("div");
  const presentGrid = document.createElement("div");
  const normalGrid = document.createElement("div");
  return { root, backdrop, presentGrid, normalGrid };
}

function key(key, { combo = false } = {}) {
  return {
    key,
    preventDefault: vi.fn(),
    metaKey: combo,
    ctrlKey: combo,
    altKey: !combo ? false : !/Mac/i.test(navigator.platform),
    shiftKey: false,
  };
}

describe("present-mode core", () => {
  let overlay, sheet, nav, presentMode, getNextChapterTitle;

  beforeEach(() => {
    overlay = stubOverlay();
    sheet = stubSheet();
    nav = stubNavigator();
    document.body.appendChild(overlay.root);
    document.body.appendChild(sheet.root);
    getNextChapterTitle = vi.fn(() => "Chapter Two");
    presentMode = createPresentMode({
      getNavigator: () => nav,
      overlay,
      sheet,
      getNextChapterTitle,
      onPresented: vi.fn(),
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    // The engine toggles classes on document.body; reset them so stale
    // document-level listeners from earlier instances stay inert.
    document.body.className = "";
  });

  it("starts inactive", () => {
    expect(presentMode.isPresenting()).toBe(false);
  });

  it("enter adds the presenting classes and updates the overlay", () => {
    vi.useFakeTimers();
    presentMode.enter();
    expect(presentMode.isPresenting()).toBe(true);
    expect(document.body.classList.contains("presenting")).toBe(true);
    // The overlay updates only after the visual change settles.
    expect(overlay.current.textContent).toBe("");
    vi.runAllTimers();
    expect(overlay.current.textContent).toBe("Intro");
    expect(overlay.next.textContent).toBe("Next: Details");
    expect(overlay.progress.textContent).toBe("Section 1 of 2");
    vi.useRealTimers();
  });

  it("exit removes all mode classes and hides the sheet", () => {
    presentMode.enter();
    document.body.classList.add("blacked-out");
    sheet.root.classList.remove("hidden");
    presentMode.exit();
    expect(presentMode.isPresenting()).toBe(false);
    expect(document.body.classList.contains("presenting")).toBe(false);
    expect(document.body.classList.contains("blacked-out")).toBe(false);
    expect(sheet.root.classList.contains("hidden")).toBe(true);
    expect(nav.clearHighlight).toHaveBeenCalled();
  });

  it("shows the present-mode sheet block while presenting", () => {
    presentMode.enter();
    expect(sheet.presentGrid.classList.contains("hidden")).toBe(false);
    expect(sheet.normalGrid.classList.contains("hidden")).toBe(true);
  });

  it("falls back to 'Next chapter' then 'End of coursebook'", () => {
    vi.useFakeTimers();
    nav.nextText = null;
    presentMode.enter();
    vi.runAllTimers();
    expect(overlay.next.textContent).toBe("Next chapter: Chapter Two");

    getNextChapterTitle.mockReturnValue(null);
    nav.nextText = null;
    nav.count = 1;
    nav.currentIdx = 0;
    presentMode.updateOverlay();
    expect(overlay.next.textContent).toBe("End of coursebook");
    vi.useRealTimers();
  });

  describe("handlePresentKeys (plain keys)", () => {
    it("ignores keys when not presenting", () => {
      const e = key("s");
      expect(presentMode.handlePresentKeys(e)).toBe(false);
      expect(nav.toggleSpotlight).not.toHaveBeenCalled();
    });

    it("consumes S for spotlight while presenting", () => {
      presentMode.enter();
      const e = key("s");
      expect(presentMode.handlePresentKeys(e)).toBe(true);
      expect(nav.toggleSpotlight).toHaveBeenCalled();
    });

    it("consumes T for the host theme toggle only while presenting", () => {
      const onToggleTheme = vi.fn();
      const themed = createPresentMode({
        getNavigator: () => nav,
        overlay,
        sheet,
        getNextChapterTitle,
        onPresented: vi.fn(),
        onToggleTheme,
      });

      const notPresenting = key("t");
      expect(themed.handlePresentKeys(notPresenting)).toBe(false);
      expect(onToggleTheme).not.toHaveBeenCalled();

      themed.enter();
      const e = key("t");
      expect(themed.handlePresentKeys(e)).toBe(true);
      expect(onToggleTheme).toHaveBeenCalledTimes(1);
      expect(e.preventDefault).toHaveBeenCalled();
    });

    it("wakes a blacked-out screen on T without toggling the theme", () => {
      const onToggleTheme = vi.fn();
      const themed = createPresentMode({
        getNavigator: () => nav,
        overlay,
        sheet,
        getNextChapterTitle,
        onPresented: vi.fn(),
        onToggleTheme,
      });
      themed.enter();
      themed.handlePresentKeys(key("b"));
      expect(document.body.classList.contains("blacked-out")).toBe(true);

      expect(themed.handlePresentKeys(key("t"))).toBe(true);
      expect(document.body.classList.contains("blacked-out")).toBe(false);
      expect(onToggleTheme).not.toHaveBeenCalled();
    });

    it("toggles black-out with B and wakes on any other key", () => {
      presentMode.enter();
      presentMode.handlePresentKeys(key("b"));
      expect(document.body.classList.contains("blacked-out")).toBe(true);

      const e = key("x");
      expect(presentMode.handlePresentKeys(e)).toBe(true);
      expect(document.body.classList.contains("blacked-out")).toBe(false);
      expect(e.preventDefault).toHaveBeenCalled();
    });

    it("wakes from black-out with B and exits with Escape", () => {
      presentMode.enter();
      presentMode.handlePresentKeys(key("b"));
      expect(presentMode.handlePresentKeys(key("b"))).toBe(true);
      expect(document.body.classList.contains("blacked-out")).toBe(false);

      sheet.root.classList.remove("hidden");
      expect(presentMode.handlePresentKeys(key("Escape"))).toBe(true);
      // Escape closes the open sheet first; a second Escape exits.
      expect(sheet.root.classList.contains("hidden")).toBe(true);
      expect(presentMode.isPresenting()).toBe(true);

      expect(presentMode.handlePresentKeys(key("Escape"))).toBe(true);
      expect(presentMode.isPresenting()).toBe(false);
    });

    it("toggles the sheet on ? even when not presenting", () => {
      const e = key("?");
      expect(presentMode.handlePresentKeys(e)).toBe(true);
      expect(sheet.root.classList.contains("hidden")).toBe(false);
      expect(presentMode.handlePresentKeys(key("?"))).toBe(true);
      expect(sheet.root.classList.contains("hidden")).toBe(true);
    });
  });

  describe("handlePresentKeys (shortcut combos)", () => {
    it("handles S/B combos only while presenting", () => {
      const sNotPresenting = key("s", { combo: true });
      expect(
        presentMode.handlePresentKeys(sNotPresenting, { isShortcutCombo: true }),
      ).toBe(false);

      presentMode.enter();
      const e = key("b", { combo: true });
      expect(presentMode.handlePresentKeys(e, { isShortcutCombo: true })).toBe(true);
      expect(document.body.classList.contains("blacked-out")).toBe(true);
    });
  });

  it("uses the injected heading text when given", () => {
    const h3 = document.createElement("h3");
    h3.textContent = "Subpoint";
    presentMode.updateOverlay({ heading: h3 });
    expect(overlay.current.textContent).toBe("Subpoint");
  });

  describe("host-specific exit behavior (presentation popup)", () => {
    it("onExit replaces the Escape-exit action without internal cleanup", () => {
      const onExit = vi.fn();
      const popupMode = createPresentMode({
        getNavigator: () => nav,
        overlay,
        sheet,
        onExit,
      });
      popupMode.enter();
      expect(popupMode.handlePresentKeys(key("Escape"))).toBe(true);
      expect(onExit).toHaveBeenCalledTimes(1);
      // The host page is going away anyway, so the mode stays marked present.
      expect(popupMode.isPresenting()).toBe(true);
    });

    it("exitOnFullscreenExit: false keeps presenting when fullscreen ends", () => {
      const popupMode = createPresentMode({
        getNavigator: () => nav,
        overlay,
        sheet,
        onExit: vi.fn(),
        exitOnFullscreenExit: false,
      });
      popupMode.enter();
      document.dispatchEvent(new window.Event("fullscreenchange"));
      expect(popupMode.isPresenting()).toBe(true);

      // The default hosts keep the fullscreen tie: leaving fullscreen exits.
      presentMode.enter();
      document.dispatchEvent(new window.Event("fullscreenchange"));
      expect(presentMode.isPresenting()).toBe(false);
    });
  });
});

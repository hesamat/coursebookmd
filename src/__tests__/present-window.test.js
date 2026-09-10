import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRESENT_DATA_MESSAGE,
  PRESENT_READY_MESSAGE,
  PRESENT_THEME_MESSAGE,
  PRESENT_VIEW_MESSAGE,
  VIEW_MESSAGE,
  activeSectionIdFor,
  buildPopupMetadata,
  buildViewPayload,
  chapterNeighbors,
  shouldApplyView,
} from "../present/popup-helpers.js";
import {
  BOUNDS_STORAGE_KEY,
  DEFAULT_POPUP_FEATURES,
  boundsFromScreen,
  featuresFromBounds,
  parseStoredBounds,
  pickTargetScreen,
} from "../present/window-placement.js";
import { createPresentWindowController } from "../controllers/present-window-controller.js";

const CHAPTERS = [{ title: "Getting Started" }, { title: "What is a coursebook?" }];

describe("window-placement", () => {
  describe("pickTargetScreen", () => {
    it("prefers an external display that is not the current one", () => {
      const laptop = { isInternal: true, availLeft: 0 };
      const projector = { isInternal: false, availLeft: 1920 };
      expect(
        pickTargetScreen({ screens: [laptop, projector], currentScreen: laptop }),
      ).toBe(projector);
    });

    it("falls back to any non-current display", () => {
      const a = { isInternal: true };
      const b = { isInternal: true };
      expect(pickTargetScreen({ screens: [a, b], currentScreen: a })).toBe(b);
    });

    it("falls back to the current display when it is the only one", () => {
      const only = { isInternal: true };
      expect(pickTargetScreen({ screens: [only], currentScreen: only })).toBe(only);
    });

    it("returns null when the details are unusable", () => {
      expect(pickTargetScreen(null)).toBeNull();
      expect(pickTargetScreen({})).toBeNull();
    });
  });

  describe("boundsFromScreen", () => {
    it("maps a screen's available area to window bounds", () => {
      expect(
        boundsFromScreen({
          availLeft: 1440,
          availTop: 0,
          availWidth: 1920,
          availHeight: 1080,
        }),
      ).toEqual({ left: 1440, top: 0, width: 1920, height: 1080 });
    });

    it("returns null for missing or non-numeric values", () => {
      expect(boundsFromScreen(null)).toBeNull();
      expect(boundsFromScreen({})).toBeNull();
      expect(
        boundsFromScreen({
          availLeft: 0,
          availTop: 0,
          availWidth: NaN,
          availHeight: 1080,
        }),
      ).toBeNull();
    });
  });

  describe("parseStoredBounds", () => {
    it("accepts valid bounds and rounds them", () => {
      expect(
        parseStoredBounds(
          JSON.stringify({ left: 10.4, top: -5.6, width: 1920.2, height: 1080.8 }),
        ),
      ).toEqual({ left: 10, top: -6, width: 1920, height: 1081 });
    });

    it("rejects junk, partial, and too-small values", () => {
      expect(parseStoredBounds(null)).toBeNull();
      expect(parseStoredBounds("not json")).toBeNull();
      expect(parseStoredBounds(JSON.stringify([100, 50, 1600, 900]))).toBeNull();
      expect(parseStoredBounds(JSON.stringify({ left: 1, top: 2 }))).toBeNull();
      expect(
        parseStoredBounds(JSON.stringify({ left: 0, top: 0, width: 100, height: 50 })),
      ).toBeNull();
    });
  });

  describe("featuresFromBounds", () => {
    it("serializes remembered bounds", () => {
      expect(featuresFromBounds({ left: 0, top: 0, width: 1920, height: 1080 })).toBe(
        "popup=yes,left=0,top=0,width=1920,height=1080",
      );
    });

    it("uses the default features when no bounds are known", () => {
      expect(featuresFromBounds(null)).toBe(DEFAULT_POPUP_FEATURES);
    });
  });
});

describe("popup-helpers", () => {
  describe("buildPopupMetadata", () => {
    it("maps chapters to popup chapter entries", () => {
      const meta = buildPopupMetadata(
        { coursebook: { chapters: CHAPTERS }, currentChapterIdx: 1 },
        (chapter) => `slug-of-${chapter.title}`,
      );
      expect(meta).toEqual({
        chapters: [
          { id: "slug-of-Getting Started", title: "Getting Started" },
          { id: "slug-of-What is a coursebook?", title: "What is a coursebook?" },
        ],
        currentChapterIdx: 1,
      });
    });

    it("reports standalone mode when no coursebook is loaded", () => {
      expect(
        buildPopupMetadata({ coursebook: null, currentChapterIdx: -1 }, () => ""),
      ).toEqual({ chapters: null, currentChapterIdx: -1 });
    });
  });

  it("activeSectionIdFor maps the landing page and chapters", () => {
    const chapters = [{ id: "ch-1" }, { id: "ch-2" }];
    expect(activeSectionIdFor(-1, chapters)).toBe("overview");
    expect(activeSectionIdFor(0, chapters)).toBe("ch-1");
    expect(activeSectionIdFor(1, chapters)).toBe("ch-2");
    expect(activeSectionIdFor(5, chapters)).toBe("overview");
  });

  it("chapterNeighbors mirrors the chapter nav enablement rules", () => {
    // On the overview: no previous, next available.
    expect(chapterNeighbors(-1, 2)).toEqual({ hasPrev: false, hasNext: true });
    // First chapter: both available.
    expect(chapterNeighbors(0, 2)).toEqual({ hasPrev: true, hasNext: true });
    // Last chapter: next unavailable.
    expect(chapterNeighbors(1, 2)).toEqual({ hasPrev: true, hasNext: false });
  });

  describe("buildViewPayload", () => {
    it("pairs the chapter index with the section id", () => {
      expect(buildViewPayload(0, "what-is-a-coursebook")).toEqual({
        chapterIdx: 0,
        sectionId: "what-is-a-coursebook",
      });
    });

    it("uses overview as the canonical landing-page section id", () => {
      expect(buildViewPayload(-1, "coursebookmd-user-guide")).toEqual({
        chapterIdx: -1,
        sectionId: "coursebookmd-user-guide",
      });
      expect(buildViewPayload(-1)).toEqual({ chapterIdx: -1, sectionId: "overview" });
      expect(buildViewPayload(0, "")).toEqual({ chapterIdx: 0, sectionId: "overview" });
    });
  });

  describe("shouldApplyView", () => {
    it("accepts a valid chapter/section payload", () => {
      expect(shouldApplyView({ chapterIdx: 1, sectionId: "lists" }, null)).toBe(true);
    });

    it("accepts the landing page (-1 is a valid chapter index)", () => {
      expect(shouldApplyView({ chapterIdx: -1, sectionId: "overview" }, null)).toBe(true);
      expect(shouldApplyView({ chapterIdx: -1, sectionId: "overview" }, {})).toBe(true);
    });

    it("rejects malformed payloads", () => {
      expect(shouldApplyView(undefined, null)).toBe(false);
      expect(shouldApplyView(null, null)).toBe(false);
      expect(shouldApplyView("cbmd:view", null)).toBe(false);
      expect(shouldApplyView(42, null)).toBe(false);
      expect(shouldApplyView({}, null)).toBe(false);
      expect(shouldApplyView({ sectionId: "lists" }, null)).toBe(false);
      expect(shouldApplyView({ chapterIdx: "0", sectionId: "lists" }, null)).toBe(false);
      expect(shouldApplyView({ chapterIdx: 1.5, sectionId: "lists" }, null)).toBe(false);
      expect(shouldApplyView({ chapterIdx: NaN, sectionId: "lists" }, null)).toBe(false);
    });

    it("rejects the echo: a payload identical to the last applied one", () => {
      const lastApplied = { chapterIdx: 0, sectionId: "lists" };
      expect(shouldApplyView({ chapterIdx: 0, sectionId: "lists" }, lastApplied)).toBe(
        false,
      );
    });

    it("accepts a section or chapter change against the last applied one", () => {
      const lastApplied = { chapterIdx: 0, sectionId: "lists" };
      expect(shouldApplyView({ chapterIdx: 0, sectionId: "tables" }, lastApplied)).toBe(
        true,
      );
      expect(shouldApplyView({ chapterIdx: 1, sectionId: "lists" }, lastApplied)).toBe(
        true,
      );
    });
  });
});

describe("present-window-controller", () => {
  let targetContent;
  let popupContent;
  let fakeWin;
  let messageHandler;
  let openSpy;
  let addEventListenerSpy;
  let showToast;

  function createController(stateOverrides = {}) {
    return createPresentWindowController({
      state: {
        contentEl: targetContent,
        coursebook: { chapters: CHAPTERS },
        currentChapterIdx: 0,
        ...stateOverrides,
      },
      showToast: (...args) => showToast(...args),
    });
  }

  beforeEach(() => {
    targetContent = document.createElement("div");
    popupContent = document.createElement("div");
    fakeWin = {
      closed: false,
      focus: vi.fn(),
      moveTo: vi.fn(),
      resizeTo: vi.fn(),
      location: { href: "about:blank" },
      postMessage: vi.fn(),
      document: {
        getElementById: (id) => (id === "content" ? popupContent : null),
        adoptNode: (node) => node,
      },
    };
    openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWin);
    addEventListenerSpy = vi.spyOn(window, "addEventListener");
    showToast = vi.fn();
    localStorage.removeItem(BOUNDS_STORAGE_KEY);
  });

  afterEach(() => {
    openSpy.mockRestore();
    addEventListenerSpy.mockRestore();
    delete window.getScreenDetails;
    delete window.screen.isExtended;
    localStorage.removeItem(BOUNDS_STORAGE_KEY);
  });

  /** Instantiate the controller and grab its window "message" listener. */
  function createControllerWithMessageCapture(stateOverrides, extraDeps = {}) {
    const controller = createPresentWindowController({
      state: {
        contentEl: targetContent,
        coursebook: { chapters: CHAPTERS },
        currentChapterIdx: 0,
        ...stateOverrides,
      },
      showToast: (...args) => showToast(...args),
      ...extraDeps,
    });
    const call = addEventListenerSpy.mock.calls.find(([type]) => type === "message");
    messageHandler = call[1];
    return controller;
  }

  it("opens a popup synchronously, places it on the external screen, and navigates it", async () => {
    const laptop = {
      isInternal: true,
      availLeft: 0,
      availTop: 0,
      availWidth: 1440,
      availHeight: 900,
    };
    const projector = {
      isInternal: false,
      availLeft: 1440,
      availTop: 0,
      availWidth: 1920,
      availHeight: 1080,
    };
    window.getScreenDetails = vi.fn(async () => ({
      screens: [laptop, projector],
      currentScreen: laptop,
    }));

    const controller = createControllerWithMessageCapture();
    await controller.openPresentWindow();

    // The window name carries a per-tab suffix so two app tabs never
    // hijack each other's popup.
    expect(openSpy).toHaveBeenCalledWith(
      "about:blank",
      expect.stringMatching(/^coursebookmd-present-/),
      DEFAULT_POPUP_FEATURES,
    );
    expect(fakeWin.moveTo).toHaveBeenCalledWith(1440, 0);
    expect(fakeWin.resizeTo).toHaveBeenCalledWith(1920, 1080);
    expect(fakeWin.location.href).toBe(`${window.location.origin}/present.html`);
  });

  it("opens directly on the cached target screen instead of moving the window", async () => {
    const laptop = {
      isInternal: true,
      availLeft: 0,
      availTop: 0,
      availWidth: 1440,
      availHeight: 900,
    };
    const projector = {
      isInternal: false,
      availLeft: 1440,
      availTop: 0,
      availWidth: 1920,
      availHeight: 1080,
    };
    window.getScreenDetails = vi.fn(async () => ({
      screens: [laptop, projector],
      currentScreen: laptop,
    }));

    const controller = createControllerWithMessageCapture();
    await controller.primeScreenDetails();
    await controller.openPresentWindow();

    expect(openSpy).toHaveBeenCalledWith(
      "about:blank",
      expect.stringMatching(/^coursebookmd-present-/),
      "popup=yes,left=1440,top=0,width=1920,height=1080",
    );
    expect(fakeWin.moveTo).not.toHaveBeenCalled();
    expect(fakeWin.resizeTo).not.toHaveBeenCalled();
    expect(fakeWin.location.href).toBe(`${window.location.origin}/present.html`);
  });

  it("keeps the fallback placement and notifies once when screen access is denied", async () => {
    window.getScreenDetails = vi.fn(async () => {
      const denied = new Error("denied");
      denied.name = "NotAllowedError";
      throw denied;
    });

    const controller = createControllerWithMessageCapture();
    await controller.openPresentWindow();

    expect(fakeWin.moveTo).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("window management"));
    expect(fakeWin.location.href).toBe(`${window.location.origin}/present.html`);

    // A second open keeps the same explanation instead of repeating it.
    fakeWin.closed = true;
    await controller.openPresentWindow();
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("does not nag about placement on a single-screen device", async () => {
    Object.defineProperty(window.screen, "isExtended", {
      value: false,
      configurable: true,
    });
    window.getScreenDetails = vi.fn(async () => {
      const denied = new Error("denied");
      denied.name = "NotAllowedError";
      throw denied;
    });

    const controller = createControllerWithMessageCapture();
    await controller.openPresentWindow();

    expect(showToast).not.toHaveBeenCalled();
    expect(fakeWin.location.href).toBe(`${window.location.origin}/present.html`);
  });

  it("falls back to remembered bounds when the placement API is unavailable", async () => {
    localStorage.setItem(
      BOUNDS_STORAGE_KEY,
      JSON.stringify({ left: 100, top: 50, width: 1600, height: 900 }),
    );

    const controller = createControllerWithMessageCapture();
    await controller.openPresentWindow();

    expect(fakeWin.moveTo).toHaveBeenCalledWith(100, 50);
    expect(fakeWin.resizeTo).toHaveBeenCalledWith(1600, 900);
  });

  it("shows a toast instead of throwing when the popup is blocked", async () => {
    openSpy.mockReturnValue(null);

    const controller = createController();
    await expect(controller.openPresentWindow()).resolves.toBeUndefined();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(fakeWin.location.href).toBe("about:blank");
  });

  it("focuses and re-feeds an already-open window instead of opening a second one", async () => {
    const controller = createControllerWithMessageCapture();
    await controller.openPresentWindow();
    openSpy.mockClear();

    await controller.openPresentWindow();

    expect(openSpy).not.toHaveBeenCalled();
    expect(fakeWin.focus).toHaveBeenCalled();
    // The re-click pushes fresh content (no ready message arrived in this
    // test, so the first open posted nothing).
    expect(fakeWin.postMessage).toHaveBeenCalledTimes(1);
  });

  it("transfers rendered content via DOM adoption when the popup is ready", async () => {
    const controller = createControllerWithMessageCapture();
    await controller.openPresentWindow();
    fakeWin.postMessage.mockClear();

    const section = document.createElement("section");
    section.className = "coursebook-section active";
    const paragraph = document.createElement("p");
    paragraph.textContent = "Slide content";
    section.appendChild(paragraph);
    const copyButton = document.createElement("button");
    copyButton.className = "code-copy-button";
    section.appendChild(copyButton);
    targetContent.appendChild(section);

    messageHandler({
      origin: window.location.origin,
      source: fakeWin,
      data: { type: PRESENT_READY_MESSAGE },
    });

    expect(popupContent.querySelector(".coursebook-section p").textContent).toBe(
      "Slide content",
    );
    expect(popupContent.querySelector(".code-copy-button")).toBeNull();
    expect(fakeWin.postMessage).toHaveBeenCalledTimes(1);
    const payload = fakeWin.postMessage.mock.calls[0][0];
    expect(payload.type).toBe(PRESENT_DATA_MESSAGE);
    expect(payload.chapters).toHaveLength(2);
    expect(payload.currentChapterIdx).toBe(0);
  });

  it("round-trips the popup's T key: toggles the theme and re-pushes content", async () => {
    const toggleTheme = vi.fn(async () => {});
    const controller = createControllerWithMessageCapture({}, { toggleTheme });
    await controller.openPresentWindow();
    fakeWin.postMessage.mockClear();

    messageHandler({
      origin: window.location.origin,
      source: fakeWin,
      data: { type: PRESENT_THEME_MESSAGE },
    });

    await vi.waitFor(() => expect(fakeWin.postMessage).toHaveBeenCalledTimes(1));
    expect(toggleTheme).toHaveBeenCalledTimes(1);
    // The re-push carries fresh PRESENT_DATA_MESSAGE metadata, not another
    // theme request.
    expect(fakeWin.postMessage.mock.calls[0][0].type).toBe(PRESENT_DATA_MESSAGE);
  });

  it("ignores messages from other origins and windows", async () => {
    const controller = createControllerWithMessageCapture();
    await controller.openPresentWindow();
    fakeWin.postMessage.mockClear();

    messageHandler({
      origin: "https://evil.example",
      source: fakeWin,
      data: { type: PRESENT_READY_MESSAGE },
    });
    messageHandler({
      origin: window.location.origin,
      source: {},
      data: { type: PRESENT_READY_MESSAGE },
    });

    expect(fakeWin.postMessage).not.toHaveBeenCalled();
  });

  /** Count of content transfers (PRESENT_DATA_MESSAGE pushes) so far. */
  function dataMessageCount() {
    return fakeWin.postMessage.mock.calls.filter(
      ([message]) => message?.type === PRESENT_DATA_MESSAGE,
    ).length;
  }

  /** Count of view-sync pushes (VIEW_MESSAGE) so far. */
  function viewMessageCount() {
    return fakeWin.postMessage.mock.calls.filter(
      ([message]) => message?.type === VIEW_MESSAGE,
    ).length;
  }

  it("drives followView when the popup reports a chapter change", async () => {
    const followView = vi.fn(async () => {});
    const getViewState = vi.fn(() => ({ chapterIdx: 0, sectionId: "intro" }));
    const controller = createControllerWithMessageCapture(
      {},
      { followView, getViewState },
    );
    await controller.openPresentWindow();

    messageHandler({
      origin: window.location.origin,
      source: fakeWin,
      data: { type: PRESENT_VIEW_MESSAGE, chapterIdx: 1, sectionId: "intro" },
    });

    await vi.waitFor(() =>
      expect(followView).toHaveBeenCalledWith({ chapterIdx: 1, sectionId: "intro" }),
    );
  });

  it("drives followView when the popup reports a section change", async () => {
    const followView = vi.fn(async () => {});
    const getViewState = vi.fn(() => ({ chapterIdx: 0, sectionId: "intro" }));
    const controller = createControllerWithMessageCapture(
      {},
      { followView, getViewState },
    );
    await controller.openPresentWindow();

    messageHandler({
      origin: window.location.origin,
      source: fakeWin,
      data: { type: PRESENT_VIEW_MESSAGE, chapterIdx: 0, sectionId: "lists" },
    });

    await vi.waitFor(() =>
      expect(followView).toHaveBeenCalledWith({ chapterIdx: 0, sectionId: "lists" }),
    );
  });

  it("ignores an echoed view payload", async () => {
    const followView = vi.fn(async () => {});
    const getViewState = vi.fn(() => ({ chapterIdx: 0, sectionId: "lists" }));
    const controller = createControllerWithMessageCapture(
      {},
      { followView, getViewState },
    );
    await controller.openPresentWindow();

    // The popup echoed back the position the main window already holds.
    messageHandler({
      origin: window.location.origin,
      source: fakeWin,
      data: { type: PRESENT_VIEW_MESSAGE, chapterIdx: 0, sectionId: "lists" },
    });

    expect(followView).not.toHaveBeenCalled();
  });

  it("ignores present-view from other origins and windows", async () => {
    const followView = vi.fn(async () => {});
    const getViewState = vi.fn(() => ({ chapterIdx: 0, sectionId: "intro" }));
    const controller = createControllerWithMessageCapture(
      {},
      { followView, getViewState },
    );
    await controller.openPresentWindow();

    messageHandler({
      origin: "https://evil.example",
      source: fakeWin,
      data: { type: PRESENT_VIEW_MESSAGE, chapterIdx: 1, sectionId: "lists" },
    });
    messageHandler({
      origin: window.location.origin,
      source: {},
      data: { type: PRESENT_VIEW_MESSAGE, chapterIdx: 1, sectionId: "lists" },
    });

    expect(followView).not.toHaveBeenCalled();
  });

  it("does not re-transfer content when following a view", async () => {
    const followView = vi.fn(async () => {});
    const getViewState = vi.fn(() => ({ chapterIdx: 0, sectionId: "intro" }));
    const controller = createControllerWithMessageCapture(
      {},
      { followView, getViewState },
    );
    await controller.openPresentWindow();
    fakeWin.postMessage.mockClear();

    messageHandler({
      origin: window.location.origin,
      source: fakeWin,
      data: { type: PRESENT_READY_MESSAGE },
    });
    expect(dataMessageCount()).toBe(1);

    messageHandler({
      origin: window.location.origin,
      source: fakeWin,
      data: { type: PRESENT_VIEW_MESSAGE, chapterIdx: 1, sectionId: "lists" },
    });
    await vi.waitFor(() => expect(followView).toHaveBeenCalled());

    expect(dataMessageCount()).toBe(1);
  });

  it("re-pushes a position the popup moved away from", async () => {
    let current = { chapterIdx: 0, sectionId: "intro" };
    const getViewState = vi.fn(() => current);
    const followView = vi.fn(async () => {});
    const controller = createControllerWithMessageCapture(
      {},
      { followView, getViewState },
    );
    await controller.openPresentWindow();
    fakeWin.postMessage.mockClear();

    controller.pushView();
    expect(viewMessageCount()).toBe(1);

    // The popup moves ahead and the main window follows it there.
    messageHandler({
      origin: window.location.origin,
      source: fakeWin,
      data: { type: PRESENT_VIEW_MESSAGE, chapterIdx: 0, sectionId: "lists" },
    });
    await vi.waitFor(() =>
      expect(followView).toHaveBeenCalledWith({ chapterIdx: 0, sectionId: "lists" }),
    );

    // Back on the first position, the main window must push it again: the
    // popup has moved away in the meantime.
    current = { chapterIdx: 0, sectionId: "intro" };
    controller.pushView();
    expect(viewMessageCount()).toBe(2);
  });

  it("pushes the main window's view to the open popup, once per position", async () => {
    const getViewState = vi.fn(() => ({ chapterIdx: 1, sectionId: "lists" }));
    const controller = createControllerWithMessageCapture({}, { getViewState });
    await controller.openPresentWindow();
    fakeWin.postMessage.mockClear();

    controller.pushView();

    expect(viewMessageCount()).toBe(1);
    const [payload, origin] = fakeWin.postMessage.mock.calls[0];
    expect(payload).toMatchObject({
      type: VIEW_MESSAGE,
      chapterIdx: 1,
      sectionId: "lists",
    });
    expect(origin).toBe(window.location.origin);

    controller.pushView();
    expect(viewMessageCount()).toBe(1);
  });

  it("does not re-broadcast a view while following the popup", async () => {
    let release;
    const followView = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const getViewState = vi.fn(() => ({ chapterIdx: 0, sectionId: "intro" }));
    const controller = createControllerWithMessageCapture(
      {},
      { followView, getViewState },
    );
    await controller.openPresentWindow();
    fakeWin.postMessage.mockClear();

    messageHandler({
      origin: window.location.origin,
      source: fakeWin,
      data: { type: PRESENT_VIEW_MESSAGE, chapterIdx: 1, sectionId: "lists" },
    });
    // The main window's navigation hooks run inside followView; their push
    // must be suppressed so the popup is not told what it just told us.
    controller.pushView();

    expect(viewMessageCount()).toBe(0);

    release();
    await vi.waitFor(() => expect(followView).toHaveBeenCalled());
  });

  it("does not push a view in standalone mode", async () => {
    const getViewState = vi.fn(() => null);
    const controller = createControllerWithMessageCapture(
      { coursebook: null },
      { getViewState },
    );
    await controller.openPresentWindow();
    fakeWin.postMessage.mockClear();

    controller.pushView();

    expect(viewMessageCount()).toBe(0);
  });

  it("stops feeding a window once it has closed", async () => {
    const controller = createControllerWithMessageCapture();
    await controller.openPresentWindow();
    fakeWin.closed = true;
    fakeWin.postMessage.mockClear();

    messageHandler({
      origin: window.location.origin,
      source: fakeWin,
      data: { type: PRESENT_READY_MESSAGE },
    });

    expect(fakeWin.postMessage).not.toHaveBeenCalled();
  });
});

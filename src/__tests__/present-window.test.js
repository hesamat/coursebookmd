import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRESENT_DATA_MESSAGE,
  PRESENT_READY_MESSAGE,
  PRESENT_THEME_MESSAGE,
  activeSectionIdFor,
  buildPopupMetadata,
  chapterNeighbors,
} from "../present/popup-helpers.js";
import {
  BOUNDS_STORAGE_KEY,
  DEFAULT_POPUP_FEATURES,
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

    expect(openSpy).toHaveBeenCalledWith(
      "about:blank",
      "coursebookmd-present",
      DEFAULT_POPUP_FEATURES,
    );
    expect(fakeWin.moveTo).toHaveBeenCalledWith(1440, 0);
    expect(fakeWin.resizeTo).toHaveBeenCalledWith(1920, 1080);
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

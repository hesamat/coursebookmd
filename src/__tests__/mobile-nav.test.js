import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupMobileNavDrawer } from "../core/mobile-nav.js";

// jsdom implements neither `inert` nor `matchMedia`; the browsers this ships
// to implement both. The inert property is defined so the background path
// runs, and each test controls the viewport through the matchMedia stub.
if (!("inert" in window.HTMLElement.prototype)) {
  Object.defineProperty(window.HTMLElement.prototype, "inert", {
    configurable: true,
    writable: true,
    value: false,
  });
}

let matches = false;
let drawer;
let pane;
let toggle;
let list;
let content;
let preview;

function mount() {
  document.body.innerHTML = `
    <nav id="tocPane"><button id="toggle"></button><div id="chapterList"></div></nav>
    <main><section id="previewPane"><div id="content"></div></section></main>
  `;
  pane = document.getElementById("tocPane");
  toggle = document.getElementById("toggle");
  list = document.getElementById("chapterList");
  content = document.getElementById("content");
  preview = document.getElementById("previewPane");
}

function pick(targetMarkup) {
  list.innerHTML = `<div class="chapter-item-wrapper">${targetMarkup}</div>`;
  const item = list.querySelector(".chapter-item, .toc-item");
  item.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  return item;
}

function pressEscape() {
  document.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
}

function clickOutside() {
  document.body.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

beforeEach(() => {
  matches = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      get matches() {
        return matches;
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  drawer?.destroy();
  drawer = null;
  document.body.innerHTML = "";
  document.body.className = "";
  vi.unstubAllGlobals();
});

describe("setupMobileNavDrawer", () => {
  it("returns null without a pane", () => {
    expect(setupMobileNavDrawer({})).toBeNull();
  });

  it("starts closed on a phone and the toggle opens it", () => {
    mount();
    matches = true;
    drawer = setupMobileNavDrawer({ pane, toggle, list, content });
    expect(document.body.classList.contains("sidebar-closed")).toBe(true);
    toggle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(document.body.classList.contains("sidebar-closed")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Hide navigation");
  });

  it("leaves the desktop state alone off the breakpoint", () => {
    mount();
    drawer = setupMobileNavDrawer({ pane, toggle, list, content });
    expect(document.body.classList.contains("sidebar-closed")).toBe(false);
  });

  it("dismisses on Escape and on a tap outside, focusing the toggle", () => {
    mount();
    matches = true;
    drawer = setupMobileNavDrawer({ pane, toggle, list, content });
    drawer.setOpen(true);
    pressEscape();
    expect(document.body.classList.contains("sidebar-closed")).toBe(true);
    expect(document.activeElement).toBe(toggle);

    drawer.setOpen(true);
    clickOutside();
    expect(document.body.classList.contains("sidebar-closed")).toBe(true);
  });

  it("keeps the toggle's own click from counting as an outside tap", () => {
    mount();
    matches = true;
    drawer = setupMobileNavDrawer({ pane, toggle, list, content });
    drawer.setOpen(true);
    toggle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    // The toggle flipped it open→closed exactly once (its own handling).
    expect(document.body.classList.contains("sidebar-closed")).toBe(true);
  });

  it("closes on a pick and moves focus to the picked heading", () => {
    mount();
    matches = true;
    drawer = setupMobileNavDrawer({ pane, toggle, list, content });
    drawer.setOpen(true);
    content.innerHTML = '<h2 id="some-section">A section</h2>';
    pick('<button class="toc-item" data-target="some-section">9.2</button>');
    expect(document.body.classList.contains("sidebar-closed")).toBe(true);
    expect(document.activeElement).toBe(content.querySelector("#some-section"));
  });

  it("inerts the background while open and restores it on close", () => {
    mount();
    matches = true;
    drawer = setupMobileNavDrawer({
      pane,
      toggle,
      list,
      content,
      background: [preview],
    });
    drawer.setOpen(true);
    expect(preview.inert).toBe(true);
    drawer.setOpen(false);
    expect(preview.inert).toBe(false);
  });
});

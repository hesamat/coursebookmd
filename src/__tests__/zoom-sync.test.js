import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { attachMediaZoom } from "../core/media-zoom.js";
import { createZoomSync } from "../present/zoom-sync.js";

// jsdom implements neither `inert` nor its reflection; the browsers this ships
// to implement both. Define the property so the modal-background path runs.
if (!("inert" in window.HTMLElement.prototype)) {
  Object.defineProperty(window.HTMLElement.prototype, "inert", {
    configurable: true,
    writable: true,
    value: false,
  });
}

const IMG = '<p><img src="/docs/assets/shot.png" alt="A screenshot"></p>';
const IMG_AND_DIAGRAM =
  IMG + '<div class="d2-diagram"><svg viewBox="0 0 10 10"></svg></div>';

let root;
let zoom;
let sent;
let sync;

function setup(html, { codeAndMath = false } = {}) {
  document.body.innerHTML = `<div id="content">${html}</div>`;
  root = document.getElementById("content");
  sent = [];
  sync = createZoomSync({
    getZoom: () => root._mediaZoom,
    getContent: () => root,
    onSend: (payload) => sent.push(payload),
  });
  // The popup wires the same hooks into attachMediaZoom (see popup-main.js).
  // They fire only on interaction, after sync is assigned below.
  zoom = attachMediaZoom(root, {
    codeAndMath,
    onOpen: (payload) => sync.localOpen(payload),
    onClose: () => sync.localClose(),
  });
  return sync;
}

function isOpen() {
  return document.querySelector(".media-zoom")?.classList.contains("is-open") ?? false;
}

function click(el) {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function press(key, target = document) {
  target.dispatchEvent(
    new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

afterEach(() => {
  zoom?.destroy();
  zoom = null;
  document.body.innerHTML = "";
  document.body.className = "";
});

describe("createZoomSync", () => {
  beforeEach(() => {
    root = null;
    zoom = null;
    sent = [];
    sync = null;
  });

  it("sends a local open as the media index and a close as open:false", () => {
    setup(IMG_AND_DIAGRAM);
    const img = root.querySelector("img");

    click(img);
    expect(sent).toEqual([{ open: true, index: 0 }]);
    expect(isOpen()).toBe(true);

    press("Escape");
    expect(sent).toEqual([{ open: true, index: 0 }, { open: false }]);
  });

  it("drops code and math zooms, which have no cross-window identity", () => {
    setup(
      "<pre><code>const answer = 42</code></pre>" +
        '<div class="katex-display"><span class="katex">E = mc^2</span></div>',
      { codeAndMath: true },
    );

    click(root.querySelector("pre"));
    click(root.querySelector(".katex-display"));

    expect(isOpen()).toBe(true);
    expect(sent).toEqual([]);
  });

  it("applies a remote open without echoing it back", () => {
    setup(IMG_AND_DIAGRAM);
    const svg = root.querySelector(".d2-diagram svg");

    sync.apply({ open: true, index: 1 });

    expect(isOpen()).toBe(true);
    // Index 1 is the diagram: the overlay shows the same node, moved.
    expect(document.querySelector(".media-zoom__stage svg")).toBe(svg);
    expect(root.querySelector(".d2-diagram svg")).toBeNull();
    expect(sent).toEqual([]);

    sync.apply({ open: false });
    expect(isOpen()).toBe(false);
    expect(root.querySelector(".d2-diagram svg")).toBe(svg);
    expect(sent).toEqual([]);
  });

  it("drops a stale open that arrives while a mirrored zoom is already up", () => {
    setup(IMG_AND_DIAGRAM);

    sync.apply({ open: true, index: 0 });
    sync.apply({ open: true, index: 1 });

    // The second open replaced the first: the stage now holds the diagram,
    // and the displaced image went back into the content tree.
    expect(isOpen()).toBe(true);
    expect(document.querySelector(".media-zoom__stage svg")).not.toBeNull();
    expect(document.querySelector(".media-zoom__stage img")).toBeNull();
    expect(root.querySelector("img")).not.toBeNull();
    // The silent switch must not have leaked a close or an open.
    expect(sent).toEqual([]);
  });

  it("still broadcasts a later local close of a remotely opened zoom", () => {
    setup(IMG);

    sync.apply({ open: true, index: 0 });
    press("Escape");

    expect(sent).toEqual([{ open: false }]);
  });

  it("ignores out-of-range indexes and junk payloads", () => {
    setup(IMG);

    sync.apply({ open: true, index: 9 });
    sync.apply({ open: true });
    sync.apply(null);

    expect(isOpen()).toBe(false);
    expect(sent).toEqual([]);

    // A close with nothing open is a no-op too.
    sync.apply({ open: false });
    expect(sent).toEqual([]);
  });

  it("does nothing without a zoom controller or content root", () => {
    const bare = createZoomSync({
      getZoom: () => null,
      getContent: () => null,
      onSend: () => {},
    });

    expect(() => bare.apply({ open: true, index: 0 })).not.toThrow();
  });
});

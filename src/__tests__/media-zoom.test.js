import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { attachMediaZoom } from "../core/media-zoom.js";

// jsdom implements neither `inert` nor its reflection; the browsers this ships
// to implement both. Define the property so the modal-background path runs.
if (!("inert" in window.HTMLElement.prototype)) {
  Object.defineProperty(window.HTMLElement.prototype, "inert", {
    configurable: true,
    writable: true,
    value: false,
  });
}

let root;
let zoom;

function mount(html) {
  document.body.innerHTML = `<div id="content">${html}</div>`;
  root = document.getElementById("content");
  return root;
}

function overlayEl() {
  return document.querySelector(".media-zoom");
}

function isOpen() {
  return overlayEl()?.classList.contains("is-open") ?? false;
}

function click(el) {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function press(key, target = document) {
  target.dispatchEvent(
    new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

function makeScrollable(el) {
  el.style.overflowY = "auto";
  Object.defineProperty(el, "scrollHeight", { value: 500 });
  Object.defineProperty(el, "clientHeight", { value: 200 });
}

beforeEach(() => {
  zoom = null;
});

afterEach(() => {
  zoom?.destroy();
  zoom = null;
  document.body.innerHTML = "";
  document.body.className = "";
});

describe("attachMediaZoom", () => {
  it("opens a content image in an overlay and dismisses it on click", () => {
    mount('<p><img src="/docs/assets/shot.png" alt="A screenshot"></p>');
    zoom = attachMediaZoom(root);
    const img = root.querySelector("img");

    click(img);

    expect(isOpen()).toBe(true);
    const shown = overlayEl().querySelector(".media-zoom__stage img");
    expect(shown).not.toBeNull();
    expect(shown.getAttribute("alt")).toBe("A screenshot");
    expect(shown.getAttribute("src")).toContain("/docs/assets/shot.png");
    // The in-page image stays where it was.
    expect(root.querySelector("img")).toBe(img);

    click(overlayEl());

    expect(isOpen()).toBe(false);
    expect(overlayEl().querySelector(".media-zoom__stage img")).toBeNull();
  });

  it("moves a diagram into the overlay and restores it on close", () => {
    mount(
      '<figure class="figure">' +
        '<div class="d2-diagram"><svg viewBox="0 0 10 10"></svg></div>' +
        '<figcaption class="figure-caption">Figure 1. Data flow</figcaption>' +
        "</figure>",
    );
    zoom = attachMediaZoom(root);
    const svg = root.querySelector("svg");

    click(svg);

    expect(isOpen()).toBe(true);
    // Same node, not a clone: D2 ids and url(#...) references must survive.
    expect(overlayEl().querySelector(".media-zoom__stage svg")).toBe(svg);
    expect(root.querySelector(".d2-diagram svg")).toBeNull();
    expect(overlayEl().querySelector(".media-zoom__caption").textContent).toBe(
      "Figure 1. Data flow",
    );

    press("Escape");

    expect(isOpen()).toBe(false);
    expect(root.querySelector(".d2-diagram svg")).toBe(svg);
    expect(overlayEl().querySelector(".media-zoom__stage svg")).toBeNull();
  });

  it("ignores linked images, site logos, and tiny media", () => {
    mount(
      '<a href="#target"><img src="/docs/assets/linked.png" alt="Linked"></a>' +
        '<img class="inline-logo" src="/logo.png" alt="Logo">' +
        '<img id="tiny" src="/tiny.png" alt="Tiny">',
    );
    const tiny = root.querySelector("#tiny");
    Object.defineProperty(tiny, "naturalWidth", { value: 32 });
    Object.defineProperty(tiny, "naturalHeight", { value: 24 });
    zoom = attachMediaZoom(root);

    click(root.querySelector("a img"));
    expect(isOpen()).toBe(false);

    click(root.querySelector(".inline-logo"));
    expect(isOpen()).toBe(false);

    click(tiny);
    expect(isOpen()).toBe(false);

    // None of them became keyboard tab stops either.
    expect(root.querySelector("a img").hasAttribute("tabindex")).toBe(false);
    expect(root.querySelector(".inline-logo").hasAttribute("tabindex")).toBe(false);
    expect(tiny.hasAttribute("tabindex")).toBe(false);
  });

  it("makes zoomable media keyboard reachable and opens it with Enter", () => {
    mount('<p><img src="/docs/assets/shot.png" alt="Keyboard"></p>');
    zoom = attachMediaZoom(root);
    const img = root.querySelector("img");

    expect(img.getAttribute("tabindex")).toBe("0");

    img.focus();
    press("Enter", img);

    expect(isOpen()).toBe(true);
  });

  it("leaves a link inside a diagram clickable", () => {
    mount(
      '<figure class="figure"><div class="d2-diagram">' +
        '<svg viewBox="0 0 10 10">' +
        '<a href="https://example.com"><rect id="linked" width="10" height="10"></rect></a>' +
        '<rect id="plain" width="10" height="10"></rect>' +
        "</svg></div></figure>",
    );
    zoom = attachMediaZoom(root);

    click(root.querySelector("#linked"));
    expect(isOpen()).toBe(false);

    // The rest of the diagram still zooms.
    click(root.querySelector("#plain"));
    expect(isOpen()).toBe(true);
  });

  it("makes the page behind the dialog unreachable, and puts it back", () => {
    document.body.innerHTML =
      '<div id="chrome"></div><div id="already"></div><div id="content">' +
      '<img src="/docs/assets/shot.png" alt="">' +
      "</div>";
    root = document.getElementById("content");
    const chrome = document.getElementById("chrome");
    const already = document.getElementById("already");
    // Another feature (the export's drawer) may have made something inert.
    already.inert = true;
    zoom = attachMediaZoom(root);

    click(root.querySelector("img"));

    expect(root.inert).toBe(true);
    expect(chrome.inert).toBe(true);
    expect(already.inert).toBe(true);

    press("Escape");

    expect(root.inert).toBe(false);
    expect(chrome.inert).toBe(false);
    expect(already.inert).toBe(true);
  });

  it("closes when the document enters presentation mode", async () => {
    mount('<img src="/docs/assets/shot.png" alt="">');
    zoom = attachMediaZoom(root);
    click(root.querySelector("img"));
    expect(isOpen()).toBe(true);

    // The exported file presents in-window; the dialog must not outlive it.
    document.body.classList.add("presenting");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(isOpen()).toBe(false);
    document.body.classList.remove("presenting");
  });

  it("consumes Escape so the host does not also react to it", () => {
    mount('<img src="/docs/assets/shot.png" alt="">');
    zoom = attachMediaZoom(root);
    click(root.querySelector("img"));

    let hostSawEscape = false;
    const hostHandler = () => {
      hostSawEscape = true;
    };
    document.addEventListener("keydown", hostHandler);
    press("Escape");
    document.removeEventListener("keydown", hostHandler);

    expect(isOpen()).toBe(false);
    expect(hostSawEscape).toBe(false);
  });

  it("locks the scrolling pane while open and restores it on close", () => {
    mount('<div id="pane"><img src="/docs/assets/shot.png" alt=""></div>');
    const pane = document.getElementById("pane");
    makeScrollable(pane);
    zoom = attachMediaZoom(root);

    click(root.querySelector("img"));
    expect(pane.style.overflowY).toBe("hidden");

    press("Escape");
    expect(pane.style.overflowY).toBe("auto");
  });

  it("re-attaching reuses the same controller and one overlay", () => {
    mount('<img src="/docs/assets/shot.png" alt="">');

    const first = attachMediaZoom(root);
    const second = attachMediaZoom(root);
    zoom = second;

    expect(second).toBe(first);

    click(root.querySelector("img"));

    expect(document.querySelectorAll(".media-zoom")).toHaveLength(1);
    expect(isOpen()).toBe(true);
  });

  it("opening again while open keeps the background restorable", () => {
    mount('<p><img id="first" src="/docs/assets/shot.png" alt=""></p>');
    zoom = attachMediaZoom(root);
    click(root.querySelector("#first"));

    // A second open (only reachable through the controller) must not lose the
    // record of what the dialog made inert.
    zoom.open(root.querySelector("#first"));
    press("Escape");

    expect(isOpen()).toBe(false);
    expect(root.inert).toBe(false);
  });

  it("destroy() removes the overlay and stops responding to clicks", () => {
    mount('<img src="/docs/assets/shot.png" alt="">');
    zoom = attachMediaZoom(root);
    const img = root.querySelector("img");
    click(img);

    zoom.destroy();
    zoom = null;

    expect(document.querySelector(".media-zoom")).toBeNull();
    expect(img.hasAttribute("tabindex")).toBe(false);

    click(img);
    expect(document.querySelector(".media-zoom")).toBeNull();
  });
});

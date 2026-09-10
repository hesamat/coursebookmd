/**
 * media-zoom.js — tap/click-to-expand for images and diagrams, shared by the
 * live app and the standalone export.
 *
 * Zooming is delegated from a content root, so re-renders keep working. A
 * diagram SVG is MOVED into the overlay rather than cloned: D2 embeds
 * per-diagram ids and url(#...) references, and a duplicate would collide with
 * the original. Pair with the `.media-zoom` rules in styles/content.css.
 */
import { icon } from "./icon.js";

/** Below this many pixels in BOTH directions the media is a logo or icon. */
const MIN_ZOOMABLE_PX = 80;

/** Diagrams are wrapped by ContentEnhancer in one of these. */
const DIAGRAM_SELECTOR = ".d2-diagram svg, .svg-diagram svg";

export function attachMediaZoom(root, { doc = document } = {}) {
  if (!root || !doc?.body) return null;
  if (root._mediaZoom) {
    root._mediaZoom.sync();
    return root._mediaZoom;
  }

  let overlay = null;
  let stage = null;
  let closeBtn = null;
  let captionEl = null;
  let overlayImg = null;
  let trigger = null;
  let movedSvg = null;
  let svgMarker = null;
  let lockedScroll = [];
  let inerted = [];
  let syncFrame = 0;
  let observer = null;
  let modeObserver = null;
  // `inert` is newer than the rest of the DOM API used here.
  const supportsInert = "inert" in root;

  function isZoomable(target) {
    if (!target || target.nodeType !== 1) return null;
    // A link keeps its behaviour, whether it wraps an image or a shape inside
    // a diagram (D2 emits anchors for shapes with a link).
    if (target.closest("a[href]")) return null;

    const diagram = target.closest(DIAGRAM_SELECTOR);
    if (diagram && root.contains(diagram)) return diagram;

    const img = target.closest("img");
    if (!img || !root.contains(img)) return null;
    // Site chrome is not content.
    if (img.classList.contains("inline-logo")) return null;
    const naturalSmall =
      img.naturalWidth > 0 &&
      img.naturalHeight > 0 &&
      img.naturalWidth < MIN_ZOOMABLE_PX &&
      img.naturalHeight < MIN_ZOOMABLE_PX;
    const rect = img.getBoundingClientRect();
    const renderedSmall =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.width < MIN_ZOOMABLE_PX &&
      rect.height < MIN_ZOOMABLE_PX;
    if (naturalSmall || renderedSmall) return null;
    return img;
  }

  /** Keyboard users need a tab stop on every zoomable element. */
  function markZoomable() {
    for (const el of root.querySelectorAll(`img, ${DIAGRAM_SELECTOR}`)) {
      const zoomable = isZoomable(el) === el;
      const marked = el.dataset.zoomTabindex === "1";
      if (zoomable && !marked) {
        el.dataset.zoomTabindex = "1";
        el.setAttribute("tabindex", "0");
      } else if (!zoomable && marked) {
        delete el.dataset.zoomTabindex;
        el.removeAttribute("tabindex");
      }
    }
  }

  function scheduleSync() {
    const raf = doc.defaultView?.requestAnimationFrame;
    if (!raf || syncFrame) return;
    syncFrame = raf(() => {
      syncFrame = 0;
      markZoomable();
    });
  }

  function captionFor(el) {
    const caption = el.closest("figure")?.querySelector(".figure-caption");
    if (caption?.textContent?.trim()) return caption.textContent.trim();
    return el.tagName === "IMG" ? el.alt?.trim() || "" : "";
  }

  /** The scroller that owns the media (usually a pane, not the body). */
  function lockScroll(from) {
    lockedScroll = [];
    const view = doc.defaultView;
    let node = from?.parentElement;
    while (node && node !== doc.documentElement && view) {
      const overflowY = view.getComputedStyle(node).overflowY;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        node.scrollHeight > node.clientHeight
      ) {
        lockedScroll.push([node, node.style.overflowY]);
        node.style.overflowY = "hidden";
      }
      node = node.parentElement;
    }
  }

  function unlockScroll() {
    for (const [node, previous] of lockedScroll) node.style.overflowY = previous;
    lockedScroll = [];
  }

  /**
   * The dialog claims `aria-modal`, so the page behind it must be unreachable
   * by keyboard and assistive tech too — the overlay only blocks pointers.
   * Inertness covers descendants, so the reading pane and the chrome beside
   * the dialog both go dark from one pass over the body's children. Elements
   * another feature already made inert are left alone, and every value this
   * sets is put back on close.
   */
  function setBackgroundInert(on) {
    if (!supportsInert) return;
    if (!on) {
      for (const [el, previous] of inerted) el.inert = previous;
      inerted = [];
      return;
    }
    inerted = [];
    for (const el of [root, ...doc.body.children]) {
      // Never the dialog, and never the body itself: everything would go inert,
      // including the dialog inside it.
      if (el === overlay || el === doc.body || !("inert" in el) || el.inert) continue;
      inerted.push([el, el.inert]);
      el.inert = true;
    }
  }

  function build() {
    overlay = doc.createElement("div");
    overlay.className = "media-zoom";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Expanded media");
    overlay.setAttribute("aria-hidden", "true");

    stage = doc.createElement("div");
    stage.className = "media-zoom__stage";
    overlay.appendChild(stage);

    captionEl = doc.createElement("p");
    captionEl.className = "media-zoom__caption";
    captionEl.hidden = true;
    overlay.appendChild(captionEl);

    closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "media-zoom__close";
    closeBtn.setAttribute("aria-label", "Close expanded media");
    const glyph = icon("x", { size: "lg" });
    if (glyph) closeBtn.appendChild(glyph);
    else closeBtn.textContent = "×";
    overlay.appendChild(closeBtn);

    // There is no pan or zoom inside, so any click dismisses. The close button
    // is inside the overlay and bubbles to the same handler.
    overlay.addEventListener("click", (event) => {
      event.preventDefault();
      close();
    });

    doc.body.appendChild(overlay);
  }

  function open(el) {
    // Opening on top of an open dialog would lose track of what this set on
    // the page behind it, and there is nothing to switch to anyway.
    if (overlay?.classList.contains("is-open")) return;
    if (!overlay) build();
    trigger = el;
    lockScroll(el);

    // Read the caption before a diagram is moved out of its figure.
    const caption = captionFor(el);

    if (el.tagName === "IMG") {
      overlayImg = doc.createElement("img");
      overlayImg.alt = el.alt || "";
      // The cell/figure styles that crop the thumbnail do not reach the
      // overlay, so the full image is shown here.
      overlayImg.src = el.currentSrc || el.src;
      stage.appendChild(overlayImg);
    } else {
      svgMarker = doc.createComment("media-zoom");
      el.parentNode.insertBefore(svgMarker, el);
      stage.appendChild(el);
      movedSvg = el;
    }

    captionEl.textContent = caption;
    captionEl.hidden = !caption;
    if (caption) overlay.setAttribute("aria-label", caption);

    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    doc.body.classList.add("media-zoom-open");
    // After the overlay is in the body, so it is the one thing left reachable.
    setBackgroundInert(true);
    closeBtn.focus?.();
  }

  function close() {
    if (!overlay?.classList.contains("is-open")) return;
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("aria-label", "Expanded media");
    doc.body.classList.remove("media-zoom-open");
    unlockScroll();
    setBackgroundInert(false);

    if (movedSvg) {
      if (svgMarker?.parentNode) svgMarker.parentNode.insertBefore(movedSvg, svgMarker);
      svgMarker?.remove();
      movedSvg = null;
      svgMarker = null;
    }
    overlayImg?.remove();
    overlayImg = null;
    captionEl.hidden = true;
    captionEl.textContent = "";

    const back = trigger;
    trigger = null;
    if (back?.isConnected) {
      try {
        back.focus({ preventScroll: true });
      } catch {
        back.focus();
      }
    }
  }

  function onRootClick(event) {
    const el = isZoomable(event.target);
    if (!el) return;
    event.preventDefault();
    open(el);
  }

  function onRootKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const el = isZoomable(event.target);
    if (!el) return;
    // Space would otherwise page-scroll behind the dialog.
    event.preventDefault();
    open(el);
  }

  function onKeyDown(event) {
    if (event.key !== "Escape" || !overlay?.classList.contains("is-open")) return;
    // Captured so the host does not also read Escape as "exit presentation".
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  function sync() {
    markZoomable();
  }

  function unmarkAll() {
    for (const el of root.querySelectorAll(`img, ${DIAGRAM_SELECTOR}`)) {
      if (el.dataset.zoomTabindex === "1") {
        delete el.dataset.zoomTabindex;
        el.removeAttribute("tabindex");
      }
    }
  }

  function destroy() {
    close();
    root.removeEventListener("click", onRootClick);
    root.removeEventListener("keydown", onRootKeyDown);
    doc.removeEventListener("keydown", onKeyDown, true);
    observer?.disconnect();
    observer = null;
    modeObserver?.disconnect();
    modeObserver = null;
    if (syncFrame) doc.defaultView?.cancelAnimationFrame?.(syncFrame);
    syncFrame = 0;
    unmarkAll();
    overlay?.remove();
    overlay = null;
    delete root._mediaZoom;
  }

  const controller = { open, close, sync, destroy };

  root.addEventListener("click", onRootClick);
  root.addEventListener("keydown", onRootKeyDown);
  doc.addEventListener("keydown", onKeyDown, true);
  const Observer = doc.defaultView?.MutationObserver;
  if (Observer) {
    observer = new Observer(() => scheduleSync());
    observer.observe(root, { childList: true, subtree: true });
    // A presentation takes over the whole page (and can start from a keyboard
    // shortcut), so the dialog must not outlive it on top: the exported file
    // presents in-window, and an open dialog would leave it covering the
    // presentation with the reading pane inert and its scroll locked.
    modeObserver = new Observer(() => {
      if (doc.body.classList.contains("presenting")) close();
    });
    modeObserver.observe(doc.body, { attributes: true, attributeFilter: ["class"] });
  }
  root._mediaZoom = controller;
  markZoomable();

  return controller;
}

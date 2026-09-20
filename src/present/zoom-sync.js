/**
 * zoom-sync.js — Bidirectional media-zoom mirroring between the main window
 * and the presentation popup: maximizing an image or diagram in either
 * window maximizes it in the other, and closing it closes it in the other.
 *
 * The trigger travels as its index among the content root's synced media
 * (images + diagrams, see media-zoom.js): the popup receives a structural
 * clone of the main window's tree, so document-order indexes agree. Code
 * blocks and display math are zoomable in the popup only and have no
 * cross-window identity, so those zooms stay local.
 */

import { zoomMediaAt } from "../core/media-zoom.js";

/**
 * @param {object} opts
 * @param {() => object | null} opts.getZoom - This window's media-zoom controller.
 * @param {() => HTMLElement | null} opts.getContent - The content root.
 * @param {(payload: {open: boolean, index?: number}) => void} opts.onSend
 */
export function createZoomSync({ getZoom, getContent, onSend }) {
  // A remote apply must not re-broadcast (the echo case).
  let applying = false;

  /** A locally opened zoom travels as the trigger's media index. */
  function localOpen({ index }) {
    if (applying) return;
    if (!Number.isInteger(index) || index < 0) return;
    onSend({ open: true, index });
  }

  function localClose() {
    if (applying) return;
    onSend({ open: false });
  }

  /**
   * Apply the other window's zoom state without echoing it back. An open
   * arriving while a mirrored zoom is already up (messages can cross) drops
   * it first, so the index resolves against an intact content tree.
   */
  function apply(payload) {
    const zoom = getZoom?.();
    const root = getContent?.();
    if (applying || !zoom || !root || !payload) return;
    applying = true;
    try {
      if (payload.open) {
        if (zoom.isOpen()) zoom.close({ remote: true });
        const el = zoomMediaAt(root, payload.index);
        if (el) zoom.open(el, { remote: true });
      } else {
        zoom.close({ remote: true });
      }
    } finally {
      applying = false;
    }
  }

  return { localOpen, localClose, apply };
}

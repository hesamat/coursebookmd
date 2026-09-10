/**
 * scroll-sync.js — Bidirectional scroll mirroring between the main window and
 * the presentation popup.
 *
 * The two windows render the same content at different sizes and font scales,
 * so raw scrollTop cannot transfer. A position travels as an anchor: the id of
 * the content block at the pane's sync line, plus how far into that block the
 * line sits. The receiver resolves the same anchor against its own layout.
 *
 * The module only reads the pane and the scroll-spy's suppression flag; it
 * never drives the spy. Programmatic (navigator/waypoint) scrolls suppress
 * outgoing anchors, and while a remote anchor is being applied — or the user
 * is scrolling — isActive() is true so the host can hold its waypoint push.
 */

import { anchorsMatch } from "./popup-helpers.js";

/** The line from the pane top that anchors pin to. */
export const SYNC_LINE = 0;

/** How long after the last scroll a pane still counts as scrolling. */
const IDLE_MS = 150;

/** How long a remote apply suppresses outgoing anchors. */
const REMOTE_GRACE_MS = 250;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function syncBlocks(root) {
  return root ? Array.from(root.querySelectorAll("[data-sync-id]")) : [];
}

/**
 * Anchor for the current position: the last block whose top is at or above the
 * sync line, plus the fraction of that block above the line.
 * @returns {{ id: string, fraction: number } | null}
 */
export function captureAnchor(pane, blocks, line = SYNC_LINE) {
  if (!blocks || blocks.length === 0) return null;
  const paneTop = pane.getBoundingClientRect().top;
  let anchor = blocks[0];
  for (const block of blocks) {
    const top = block.getBoundingClientRect().top - paneTop;
    if (top <= line) anchor = block;
    else break;
  }
  const rect = anchor.getBoundingClientRect();
  const top = rect.top - paneTop;
  const fraction = rect.height > 0 ? clamp((line - top) / rect.height, 0, 1) : 0;
  return { id: anchor.dataset.syncId, fraction };
}

/**
 * scrollTop that puts `anchor` at the sync line, or null when the block is not
 * in this document.
 */
export function scrollTopForAnchor(pane, blocks, anchor, line = SYNC_LINE) {
  if (!anchor) return null;
  const el = (blocks ?? []).find((block) => block.dataset.syncId === anchor.id);
  if (!el) return null;
  const paneTop = pane.getBoundingClientRect().top;
  const rect = el.getBoundingClientRect();
  const top = rect.top - paneTop;
  const delta = top - line + (anchor.fraction ?? 0) * rect.height;
  const maxTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
  return clamp(pane.scrollTop + delta, 0, maxTop);
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.pane - The scroll container.
 * @param {() => HTMLElement | null} opts.getContent - Returns the content root.
 * @param {() => number} [opts.getChapterIdx] - Current chapter index, sent with
 *   each anchor so the receiver can reject a stale position across chapters.
 * @param {() => boolean} [opts.getSuppressed] - True while a programmatic
 *   navigator scroll owns the pane (the scroll-spy's isSuppressed).
 * @param {(payload: {chapterIdx: number, id: string, fraction: number}) => void} opts.onSend
 */
export function createScrollSync({
  pane,
  getContent,
  getChapterIdx = () => -1,
  getSuppressed = () => false,
  onSend,
}) {
  let frame = null;
  let frameTimer = null;
  let idleTimer = null;
  let applyingTimer = null;
  let applying = false;
  let remoteUntil = 0;
  let scrolling = false;
  let lastSent = null;

  function blocks() {
    return syncBlocks(getContent());
  }

  function noteScrolling() {
    scrolling = true;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      scrolling = false;
    }, IDLE_MS);
  }

  function flush() {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    clearTimeout(frameTimer);
    frameTimer = null;
    if (applying) return;
    if (getSuppressed()) return;
    const anchor = captureAnchor(pane, blocks());
    if (!anchor || !anchor.id) return;
    const payload = { chapterIdx: getChapterIdx(), ...anchor };
    if (
      lastSent &&
      lastSent.chapterIdx === payload.chapterIdx &&
      anchorsMatch(payload, lastSent)
    ) {
      return;
    }
    lastSent = payload;
    onSend(payload);
  }

  function schedule() {
    if (frame !== null || frameTimer !== null) return;
    // rAF coalesces bursts per frame; the timer keeps a send happening when a
    // backgrounded window has rAF paused.
    frame = requestAnimationFrame(flush);
    frameTimer = setTimeout(flush, 90);
  }

  function onScroll() {
    // The pane's own event from a remote apply is swallowed so it never echoes.
    if (applying) {
      applying = false;
      clearTimeout(applyingTimer);
      applyingTimer = null;
      return;
    }
    // A programmatic navigator scroll is not a user scroll either.
    if (getSuppressed()) return;
    noteScrolling();
    schedule();
  }

  /** Apply a remote anchor without echoing it back. */
  function apply(anchor) {
    const top = scrollTopForAnchor(pane, blocks(), anchor);
    if (top === null) return;
    applying = true;
    remoteUntil = Date.now() + REMOTE_GRACE_MS;
    lastSent = {
      chapterIdx: anchor.chapterIdx,
      id: anchor.id,
      fraction: anchor.fraction,
    };
    pane.scrollTop = top;
    // Release the echo guard even if the scroll produced no event (already there).
    clearTimeout(applyingTimer);
    applyingTimer = setTimeout(() => {
      applying = false;
      applyingTimer = null;
    }, REMOTE_GRACE_MS);
  }

  function attach() {
    pane.addEventListener("scroll", onScroll, { passive: true });
  }

  function destroy() {
    pane.removeEventListener("scroll", onScroll);
    clearTimeout(idleTimer);
    clearTimeout(frameTimer);
    clearTimeout(applyingTimer);
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    frameTimer = null;
    applyingTimer = null;
  }

  return {
    attach,
    destroy,
    apply,
    /** True while a local scroll or remote apply owns the position. */
    isActive: () => scrolling || applying || Date.now() < remoteUntil,
  };
}

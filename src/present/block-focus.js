/**
 * block-focus.js — Block-level focus cursor for the presentation window.
 *
 * A chapter can still be a wall of text even though the projection shows only
 * one at a time. This engine walks the chapter's top-level content blocks (the
 * \`data-sync-id\` anchors SectionNavigator already assigns) so the presenter
 * can pace the room: the focused block stays readable while its siblings dim,
 * \`R\` hides everything past the cursor, and \`Z\` lifts the focused block to
 * fill the pane.
 *
 * Hosts own the keyboard routing; this module owns the cursor state, the
 * classes it applies, and the index math.
 */

const FOCUSED = "is-block-focused";
const MUTED = "is-block-muted";
const HIDDEN = "is-block-reveal-hidden";
const ZOOMED = "is-block-zoomed";

/**
 * @param {object} deps
 * @param {HTMLElement} deps.pane - The scrollable viewport.
 * @param {() => HTMLElement | null} deps.getRoot - The active chapter element
 *   (or the content root when there are no chapters). Blocks are collected
 *   from it.
 * @param {(el: HTMLElement) => void} deps.scrollTo - Bring a block into view.
 * @param {(direction: 1 | -1) => void} [deps.onBoundary] - Called when the
 *   cursor steps past the first or last block; the host may switch chapters
 *   and then refresh() + focusIndex().
 * @returns {object} Cursor controller.
 */
export function createBlockFocus({ pane, getRoot, scrollTo, onBoundary }) {
  let blocks = [];
  let index = -1;
  let reveal = false;
  let zoomed = false;

  function collect() {
    const root = getRoot?.();
    if (!root) return [];
    return Array.from(root.querySelectorAll("[data-sync-id]")).filter((el) =>
      el.parentElement?.matches("section:not(.coursebook-section)"),
    );
  }

  function applyClasses() {
    const active = index >= 0 && blocks.length > 0;
    document.body.classList.toggle("block-focus", active);
    document.body.classList.toggle("block-reveal", active && reveal);
    document.body.classList.toggle("block-zoomed", active && zoomed);
    blocks.forEach((el, i) => {
      el.classList.toggle(FOCUSED, active && i === index);
      el.classList.toggle(MUTED, active && !reveal && i !== index);
      el.classList.toggle(HIDDEN, active && reveal && i > index);
      el.classList.toggle(ZOOMED, active && zoomed && i === index);
    });
  }

  function bringIntoView() {
    const el = index >= 0 ? blocks[index] : null;
    if (el && !zoomed) scrollTo(el);
  }

  function setIndex(next, { scroll = true } = {}) {
    if (blocks.length === 0) return false;
    index = Math.max(0, Math.min(next, blocks.length - 1));
    applyClasses();
    if (scroll) bringIntoView();
    return true;
  }

  /** Start on the first block the audience is already looking at. */
  function activateFromViewport() {
    if (blocks.length === 0) return false;
    const top = pane.getBoundingClientRect().top;
    const found = blocks.findIndex((el) => el.getBoundingClientRect().bottom > top + 8);
    return setIndex(found === -1 ? blocks.length - 1 : found, { scroll: false });
  }

  /** Re-read the block list after a chapter switch or a content transfer. */
  function refresh() {
    blocks = collect();
    if (index >= blocks.length) index = blocks.length - 1;
    applyClasses();
  }

  function next() {
    if (blocks.length === 0) return;
    if (index === -1) {
      activateFromViewport();
      return;
    }
    if (index >= blocks.length - 1) {
      onBoundary?.(1);
      return;
    }
    setIndex(index + 1);
  }

  function prev() {
    if (blocks.length === 0) return;
    if (index === -1) {
      activateFromViewport();
      return;
    }
    if (index <= 0) {
      onBoundary?.(-1);
      return;
    }
    setIndex(index - 1);
  }

  function toggleReveal() {
    if (index === -1 && !activateFromViewport()) return;
    reveal = !reveal;
    applyClasses();
    bringIntoView();
  }

  function toggleZoom() {
    if (index === -1 && !activateFromViewport()) return;
    zoomed = !zoomed;
    applyClasses();
    if (!zoomed) bringIntoView();
  }

  function clear() {
    index = -1;
    reveal = false;
    zoomed = false;
    applyClasses();
  }

  return {
    refresh,
    next,
    prev,
    focusIndex: setIndex,
    clear,
    toggleReveal,
    toggleZoom,
    isActive: () => index >= 0,
    isRevealed: () => reveal,
    isZoomed: () => zoomed,
    count: () => blocks.length,
    getFocused: () => (index >= 0 ? (blocks[index] ?? null) : null),
  };
}

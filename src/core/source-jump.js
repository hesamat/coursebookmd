/**
 * Source jump mapping: preview element -> Markdown source line.
 *
 * Renderer rules in markdown-renderer.js tag block elements with a
 * `data-src-line` attribute (1-based source line). Clicking preview content
 * in edit mode resolves the nearest annotation for the clicked element:
 * the element itself, an annotated ancestor, or — for generated content
 * without an annotation (figure captions, index chrome) — the closest
 * preceding annotated element within the same scope (chapter section or
 * content root).
 */

/** Selector for preview elements that should trigger a source jump. */
export const SOURCE_TARGET_SELECTOR =
  "h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, table, figure, figcaption";

/**
 * Read a 1-based line number from an element's data-src-line attribute.
 * @param {Element} el
 * @returns {number | null}
 */
export function annotatedLine(el) {
  const raw = el?.dataset?.srcLine;
  if (raw === undefined) return null;
  const line = Number(raw);
  return Number.isInteger(line) && line > 0 ? line : null;
}

/**
 * Resolve the source line for a clicked preview element.
 *
 * Resolution order:
 * 1. The element's own `data-src-line` (headings, paragraphs, fences).
 * 2. The nearest enclosing annotated ancestor within scope (li, blockquote).
 * 3. The closest preceding annotated element in document order (generated
 *    content like figure captions falls back to the previous block).
 *
 * @param {Element} target - The clicked block element.
 * @param {HTMLElement} scope - Element bounding the search (chapter section
 *   or the content root), so line numbers never cross chapter boundaries.
 * @returns {number | null}
 */
export function resolveSourceLine(target, scope) {
  for (let node = target; node && node !== scope; node = node.parentElement) {
    const own = annotatedLine(node);
    if (own !== null) return own;
  }

  let nearest = null;
  for (const el of scope.querySelectorAll("[data-src-line]")) {
    if (target.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) {
      nearest = el;
    } else {
      break;
    }
  }
  return annotatedLine(nearest);
}

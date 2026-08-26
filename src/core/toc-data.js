/**
 * Shared TOC data extraction used by both the live app and the exported HTML.
 *
 * Both environments need to build TOC items from heading elements within a
 * section. This module extracts the data (id, text, number, level); each
 * environment renders it differently (DOM buttons vs HTML anchor strings).
 */

/**
 * @typedef {Object} TocItem
 * @property {string} id - The heading's id attribute
 * @property {string} text - The heading text (without the number prefix)
 * @property {string} number - The section number string (e.g. "1.2") or ""
 * @property {string} level - The heading tag name lowercased ("h2" or "h3")
 */

/**
 * Extract TOC items from a section's headings.
 * Skips H1 (the chapter title is already shown as the nav item).
 *
 * @param {HTMLElement} section - The section element to scan
 * @returns {TocItem[]}
 */
export function extractTocItems(section) {
  const headings = Array.from(section.querySelectorAll("h2, h3"));
  return headings.map((heading) => {
    const numSpan = heading.querySelector(".heading-number");
    const text = numSpan
      ? heading.textContent.replace(numSpan.textContent, "").trim()
      : heading.textContent.trim();
    const number = numSpan ? numSpan.textContent.trim() : "";
    return {
      id: heading.id,
      text,
      number,
      level: heading.tagName.toLowerCase(),
    };
  });
}

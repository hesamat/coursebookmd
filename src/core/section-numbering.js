/**
 * Section numbering utility.
 *
 * Assigns hierarchical numbers to headings (h1, h2, h3):
 *   h1 → "1", "2", ...
 *   h2 → "1.1", "1.2", "2.1", ...
 *   h3 → "1.1.1", "1.1.2", ...
 *
 * Used by both the rendered content and the TOC so numbers stay in sync.
 */

/**
 * Compute section numbers for a list of heading elements.
 * @param {Element[]} headings - Array of h1/h2/h3 elements in document order.
 * @returns {string[]} - Array of number strings, same length as input.
 */
export function computeSectionNumbers(headings) {
  const counters = [0, 0, 0]; // h1, h2, h3
  const numbers = [];

  for (const heading of headings) {
    const level = parseInt(heading.tagName.slice(1), 10) - 1; // 0=h1, 1=h2, 2=h3
    if (level < 0 || level > 2) {
      numbers.push("");
      continue;
    }

    // Increment current level
    counters[level]++;

    // Reset deeper levels
    for (let i = level + 1; i < counters.length; i++) {
      counters[i] = 0;
    }

    // Build number string from all levels up to current
    const parts = [];
    for (let i = 0; i <= level; i++) {
      parts.push(counters[i]);
    }
    numbers.push(parts.join("."));
  }

  return numbers;
}

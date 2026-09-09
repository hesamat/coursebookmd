/**
 * Shared full-text search core for the standalone HTML export and the
 * live app. DOM-agnostic: entries reference the elements they were built
 * from, but matching and snippet computation never touch the DOM, so a
 * host may index blocks that are not currently rendered.
 */

// Text blocks considered for search hits. collectSearchEntries keeps only
// blocks that contain none of these (leaves), so wrapped content is not
// indexed twice.
export const SEARCH_BLOCK_SELECTOR =
  "h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td, th";

export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_MAX_RESULTS = 30;

/**
 * Build search entries from the given section root elements.
 * @param {Array<HTMLElement>} sections - Document-order roots to scan.
 * @param {(section: HTMLElement) => string} getLabel - Display label for
 *   a hit found under a section root (e.g. the chapter title).
 * @returns {Array<{el: HTMLElement, text: string, lowerText: string, label: string}>}
 */
export function collectSearchEntries(sections, getLabel) {
  const entries = [];
  for (const section of sections) {
    const label = getLabel(section);
    for (const el of section.querySelectorAll(SEARCH_BLOCK_SELECTOR)) {
      if (el.querySelector(SEARCH_BLOCK_SELECTOR)) continue;
      const text = el.textContent.replace(/\s+/g, " ").trim();
      if (text.length < 3) continue;
      entries.push({ el, text, lowerText: text.toLowerCase(), label });
    }
  }
  return entries;
}

/**
 * Case-insensitive substring search over prebuilt entries, in index
 * order (document order). Returns the first match per entry, capped at
 * `maxResults`.
 * @param {Array} entries - From collectSearchEntries.
 * @param {string} query - Raw user input; trimmed before matching.
 * @param {{maxResults?: number}} [options]
 * @returns {Array<{el: HTMLElement, text: string, label: string, matchIdx: number, matchLen: number}>}
 */
export function searchEntries(entries, query, { maxResults = SEARCH_MAX_RESULTS } = {}) {
  const q = query.trim().toLowerCase();
  if (q.length < SEARCH_MIN_QUERY_LENGTH) return [];
  const hits = [];
  for (const entry of entries) {
    const matchIdx = entry.lowerText.indexOf(q);
    if (matchIdx === -1) continue;
    // Preserve host-added fields (e.g. a section id) alongside the core
    // ones; lowerText is an indexing detail and stays out of hits.
    const { lowerText: _lowerText, ...hit } = entry;
    hits.push({ ...hit, matchIdx, matchLen: q.length });
    if (hits.length >= maxResults) break;
  }
  return hits;
}

/**
 * Compute a one-line snippet around a match for display, with ellipses
 * where text was trimmed on either side.
 * @returns {{prefix: string, match: string, suffix: string}}
 */
export function buildSearchSnippet(
  text,
  matchIdx,
  matchLen,
  { before = 30, after = 50 } = {},
) {
  const start = Math.max(0, matchIdx - before);
  const end = Math.min(text.length, matchIdx + matchLen + after);
  return {
    prefix: (start > 0 ? "…" : "") + text.slice(start, matchIdx),
    match: text.slice(matchIdx, matchIdx + matchLen),
    suffix: text.slice(matchIdx + matchLen, end) + (end < text.length ? "…" : ""),
  };
}

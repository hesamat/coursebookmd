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

// Subtrees excluded from a block's indexed text. KaTeX pairs every
// rendered formula with a visually hidden MathML copy of the raw source;
// without this, snippets end with LaTeX like "\pi r^2".
export const SEARCH_IGNORE_SELECTOR = ".katex-mathml";

function blockText(el, ignoreSelector) {
  if (!ignoreSelector) return el.textContent;
  let out = "";
  for (const node of el.childNodes) {
    if (node.nodeType === 1) {
      if (node.matches(ignoreSelector)) continue;
      out += blockText(node, ignoreSelector);
    } else if (node.nodeType === 3) {
      out += node.nodeValue;
    }
  }
  return out;
}

/**
 * Build search entries from the given section root elements.
 * @param {Array<HTMLElement>} sections - Document-order roots to scan.
 * @param {(section: HTMLElement) => string} getLabel - Display label for
 *   a hit found under a section root (e.g. the chapter title).
 * @param {{ignore?: string}} [options] - Selector for subtrees whose text
 *   is not content (defaults to SEARCH_IGNORE_SELECTOR; pass "" for none).
 * @returns {Array<{el: HTMLElement, text: string, lowerText: string, label: string}>}
 *   Interior newlines are preserved (multi-line blocks like code snippet
 *   one coherent line); matching is whitespace-flexible, so a query with
 *   spaces still finds text broken across lines.
 */
export function collectSearchEntries(
  sections,
  getLabel,
  { ignore = SEARCH_IGNORE_SELECTOR } = {},
) {
  const entries = [];
  for (const section of sections) {
    const label = getLabel(section);
    for (const el of section.querySelectorAll(SEARCH_BLOCK_SELECTOR)) {
      if (el.querySelector(SEARCH_BLOCK_SELECTOR)) continue;
      const text = blockText(el, ignore)
        .replace(/[^\S\n]+/g, " ")
        .trim();
      if (text.length < 3) continue;
      entries.push({ el, text, lowerText: text.toLowerCase(), label });
    }
  }
  return entries;
}

/**
 * Case-insensitive search over prebuilt entries, in index order
 * (document order). Whitespace in the query matches any whitespace run
 * in the block, including the newlines that multi-line blocks keep. Each
 * hit carries every occurrence of the query within its block. Pass
 * `maxResults: Infinity` to get all matching entries; the host caps
 * rendering itself.
 * @param {Array} entries - From collectSearchEntries.
 * @param {string} query - Raw user input; trimmed before matching.
 * @param {{maxResults?: number}} [options]
 * @returns {Array<{el: HTMLElement, text: string, label: string, matches: Array<{idx: number, len: number}>}>}
 */
export function searchEntries(entries, query, { maxResults = SEARCH_MAX_RESULTS } = {}) {
  const q = query.trim().toLowerCase();
  if (q.length < SEARCH_MIN_QUERY_LENGTH) return [];
  const pattern = new RegExp(
    q
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .split(/\s+/)
      .join("\\s+"),
    "g",
  );
  const hits = [];
  for (const entry of entries) {
    const matches = [];
    for (const m of entry.lowerText.matchAll(pattern)) {
      matches.push({ idx: m.index, len: m[0].length });
    }
    if (!matches.length) continue;
    // Preserve host-added fields (e.g. a section id) alongside the core
    // ones; lowerText is an indexing detail and stays out of hits.
    const hit = { ...entry, matches };
    delete hit.lowerText;
    hits.push(hit);
    if (hits.length >= maxResults) break;
  }
  return hits;
}

/**
 * Build a display snippet around the first match, framed within the line
 * containing it: multi-line blocks (code) snippet as one coherent line
 * instead of gluing their lines together. Every occurrence fully inside
 * the window is marked. Ellipses mark text trimmed on either side,
 * folded into the adjacent part.
 * @param {string} text - The block's indexed text (may contain newlines).
 * @param {Array<{idx: number, len: number}>} matches - Ascending matches.
 * @param {{before?: number, after?: number}} [options]
 * @returns {{parts: Array<{text: string, match: boolean}>}}
 */
export function buildSearchSnippet(text, matches, { before = 60, after = 130 } = {}) {
  const first = matches[0];
  if (!first) return { parts: [{ text, match: false }] };
  const lineStart = text.lastIndexOf("\n", first.idx) + 1;
  const nextBreak = text.indexOf("\n", first.idx);
  // A phrase matched across a line break stays in the window; the render
  // collapses the newline to the space the reader typed.
  const lineEnd = Math.max(
    nextBreak === -1 ? text.length : nextBreak,
    first.idx + first.len,
  );
  const start = Math.max(lineStart, first.idx - before);
  const end = Math.min(lineEnd, first.idx + first.len + after);
  const parts = [];
  let cursor = start;
  for (const m of matches) {
    if (m.idx < start || m.idx + m.len > end) continue;
    if (m.idx > cursor) parts.push({ text: text.slice(cursor, m.idx), match: false });
    parts.push({ text: text.slice(m.idx, m.idx + m.len), match: true });
    cursor = m.idx + m.len;
  }
  if (cursor < end) parts.push({ text: text.slice(cursor, end), match: false });
  if (start > lineStart) {
    if (parts[0].match) parts.unshift({ text: "…", match: false });
    else parts[0].text = "…" + parts[0].text;
  }
  if (end < lineEnd) {
    if (parts[parts.length - 1].match) parts.push({ text: "…", match: false });
    else parts[parts.length - 1].text += "…";
  }
  return { parts };
}

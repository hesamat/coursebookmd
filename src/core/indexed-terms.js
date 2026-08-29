/**
 * Indexed terms (`==term==` -> <span class="idx">) and the general index
 * section shared by the live app and the HTML export.
 *
 * v1 anchor strategy: the FIRST occurrence of each term (case-insensitive
 * grouping, first-seen casing) gets a stable id `idx-<slug>` and index
 * entries link to that occurrence only. Later occurrences are still
 * underlined but not linked from the index.
 *
 * The index is a trailing `.coursebook-section` with id "index", appended
 * AFTER section numbering, heading-id dedup, and TOC building so it never
 * participates in `currentChapterIdx + 1` section arithmetic: every
 * chapter-index loop addresses sections positionally from the chapter
 * list, and the index is only reachable by id (hash `#index` or index
 * links). Numbering passes must skip it (see app.js onEditorInput).
 */

const INDEX_ID = "index";
const IDX_ID_PREFIX = "idx-";

/**
 * Collect indexed terms across the given roots and assign an anchor id to
 * the first occurrence of each term. Idempotent across rebuilds: anchor
 * ids previously minted on `.idx` spans are released before re-assignment,
 * so repeated rebuilds do not accumulate `-1` suffixes.
 *
 * @param {Array<HTMLElement>} roots - Elements to scan, in document order.
 * @param {Set<string>} [takenIds] - Ids already in use (heading/section ids).
 * @returns {Array<{term: string, id: string}>} Alphabetical entries.
 */
export function collectIndexedTerms(roots, takenIds = new Set()) {
  for (const root of roots) {
    for (const span of root.querySelectorAll("span.idx[id]")) {
      if (span.id.startsWith(IDX_ID_PREFIX)) span.removeAttribute("id");
    }
  }

  const groups = new Map();
  for (const root of roots) {
    for (const span of root.querySelectorAll(".idx")) {
      const term = span.textContent.trim();
      if (!term) continue;
      const key = term.toLowerCase();
      if (!groups.has(key)) groups.set(key, { term, first: span });
    }
  }

  const entries = [...groups.values()]
    .sort((a, b) => a.term.toLowerCase().localeCompare(b.term.toLowerCase()))
    .map((group) => {
      const base = IDX_ID_PREFIX + slugifyTerm(group.term);
      let id = base;
      let suffix = 1;
      while (takenIds.has(id)) {
        id = `${base}-${suffix++}`;
      }
      takenIds.add(id);
      return { term: group.term, id, first: group.first };
    });

  for (const entry of entries) {
    entry.first.id = entry.id;
  }

  return entries.map(({ term, id }) => ({ term, id }));
}

/**
 * Build the index section element. The heading is plain text so it cannot
 * leak term markup into TOC/navigator text reads.
 *
 * @param {Array<{term: string, id: string}>} entries
 * @returns {HTMLElement}
 */
export function buildIndexSection(entries) {
  const section = document.createElement("section");
  section.id = INDEX_ID;
  section.className = "coursebook-section index-section";

  const heading = document.createElement("h2");
  heading.textContent = "Index";
  section.appendChild(heading);

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "index-empty";
    empty.textContent =
      "No indexed terms. Mark a term with ==double equals== to add it here.";
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement("ul");
  list.className = "index-list";
  for (const { term, id } of entries) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "idx-link";
    link.href = `#${id}`;
    link.setAttribute("data-target", id);
    link.textContent = term;
    item.appendChild(link);
    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}

/**
 * Remove any existing index section from `contentEl`, collect terms across
 * all coursebook sections, and append a fresh index section.
 *
 * @param {HTMLElement} contentEl
 */
export function rebuildIndexSection(contentEl) {
  contentEl.querySelector("section.index-section")?.remove();
  for (const span of contentEl.querySelectorAll("span.idx[id]")) {
    if (span.id.startsWith(IDX_ID_PREFIX)) span.removeAttribute("id");
  }

  const takenIds = new Set();
  for (const el of contentEl.querySelectorAll("[id]")) {
    takenIds.add(el.id);
  }

  const roots = Array.from(contentEl.querySelectorAll(".coursebook-section")).filter(
    (s) => !s.classList.contains("index-section"),
  );
  const entries = collectIndexedTerms(roots, takenIds);
  contentEl.appendChild(buildIndexSection(entries));
}

/**
 * URL-safe slug for a term id. Local to this module so the shared
 * slugifyForId counter fallback cannot mint colliding ids.
 *
 * @param {string} term
 * @returns {string}
 */
function slugifyTerm(term) {
  return term
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

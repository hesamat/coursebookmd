/**
 * Indexed terms (`==term==` -> <span class="idx">) and the general index
 * section shared by the live app and the HTML export.
 *
 * Every occurrence of a term is anchored: the first occurrence gets
 * `idx-<slug>`, subsequent ones `idx-<slug>-2`, `-3`, ... (ids deduped
 * against taken ids). Index entries link to ALL occurrences, each labeled
 * by the enclosing section number (or the heading title for unnumbered
 * sections like the overview).
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
 * Collect indexed terms across the given sections and anchor every
 * occurrence. Idempotent across rebuilds: anchor ids previously minted on
 * `.idx` spans are released before re-assignment, so repeated rebuilds do
 * not accumulate suffixes.
 *
 * @param {Array<{root: HTMLElement, label: string}>} sections - Elements to
 *   scan, in document order, with a fallback label used when an occurrence
 *   has no preceding heading (e.g. the section id).
 * @param {Set<string>} [takenIds] - Ids already in use (heading/section ids).
 * @returns {Array<{term: string, occurrences: Array<{id: string, label: string}>}>}
 *   Alphabetical entries with all occurrences.
 */
export function collectIndexedTerms(sections, takenIds = new Set()) {
  for (const { root } of sections) {
    for (const span of root.querySelectorAll("span.idx[id]")) {
      if (span.id.startsWith(IDX_ID_PREFIX)) span.removeAttribute("id");
    }
  }

  const groups = new Map();
  for (const { root, label } of sections) {
    for (const span of root.querySelectorAll(".idx")) {
      const term = span.textContent.trim();
      if (!term) continue;
      const key = term.toLowerCase();
      if (!groups.has(key)) groups.set(key, { term, hits: [] });
      groups.get(key).hits.push({ span, sectionLabel: label });
    }
  }

  const entries = [...groups.values()]
    .sort((a, b) => a.term.toLowerCase().localeCompare(b.term.toLowerCase()))
    .map((group) => {
      const base = IDX_ID_PREFIX + slugifyTerm(group.term);
      let n = 1;
      const occurrences = group.hits.map(({ span, sectionLabel }) => {
        let id = n === 1 ? base : `${base}-${n}`;
        while (takenIds.has(id)) {
          n++;
          id = n === 1 ? base : `${base}-${n}`;
        }
        takenIds.add(id);
        span.id = id;
        n++;
        return { id, label: occurrenceLabel(span, sectionLabel) };
      });
      return { term: group.term, occurrences };
    });

  return entries;
}

/**
 * Build the index section element. Each entry renders the term followed by
 * one link per occurrence, labeled by the occurrence's section. The heading
 * is plain text so it cannot leak term markup into TOC/navigator text reads.
 *
 * @param {Array<{term: string, occurrences: Array<{id: string, label: string}>}>} entries
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
  for (const { term, occurrences } of entries) {
    const item = document.createElement("li");
    item.className = "index-item";

    const termSpan = document.createElement("span");
    termSpan.className = "index-term";
    termSpan.textContent = term;
    item.appendChild(termSpan);

    const links = document.createElement("span");
    links.className = "index-occurrences";
    for (const { id, label } of occurrences) {
      const link = document.createElement("a");
      link.className = "idx-link";
      link.href = `#${id}`;
      link.setAttribute("data-target", id);
      link.textContent = label;
      links.appendChild(link);
    }
    item.appendChild(links);
    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}

/**
 * Remove any existing index section from `contentEl`, collect terms across
 * all coursebook sections, and append a fresh index section. Also clears
 * leftover highlight flashes from a previous navigation.
 *
 * @param {HTMLElement} contentEl
 */
export function rebuildIndexSection(contentEl) {
  contentEl.querySelector("section.index-section")?.remove();
  for (const span of contentEl.querySelectorAll("span.idx[id]")) {
    if (span.id.startsWith(IDX_ID_PREFIX)) span.removeAttribute("id");
  }
  for (const el of contentEl.querySelectorAll(".idx-highlight")) {
    el.classList.remove("idx-highlight");
  }

  const takenIds = new Set();
  for (const el of contentEl.querySelectorAll("[id]")) {
    takenIds.add(el.id);
  }

  const sections = Array.from(contentEl.querySelectorAll(".coursebook-section"))
    .filter((s) => !s.classList.contains("index-section"))
    .map((s) => ({ root: s, label: s.id }));
  const entries = collectIndexedTerms(sections, takenIds);
  contentEl.appendChild(buildIndexSection(entries));
}

/**
 * Briefly flash the target of an index navigation so the term is easy to
 * spot after the scroll settles. Safe to call repeatedly: the animation
 * restarts on the same element.
 *
 * @param {HTMLElement | null} span
 */
export function flashIndexedTerm(span) {
  if (!span) return;
  span.classList.remove("idx-highlight");
  // Force a reflow so a repeat click restarts the animation.
  void span.offsetWidth;
  span.classList.add("idx-highlight");
  span.addEventListener("animationend", () => span.classList.remove("idx-highlight"), {
    once: true,
  });
}

/**
 * Label for an occurrence: the enclosing section number when the nearest
 * preceding heading carries one, else that heading's title, else the
 * section-level fallback label.
 */
function occurrenceLabel(span, fallback) {
  const heading = nearestPrecedingHeading(span);
  if (!heading) return fallback;
  const number = heading.querySelector(".heading-number");
  return number ? number.textContent.trim() : heading.textContent.trim();
}

function nearestPrecedingHeading(span) {
  let node = span;
  while (node && node !== document.body) {
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (/^H[1-6]$/.test(sib.tagName)) return sib;
    }
    node = node.parentElement;
  }
  return null;
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

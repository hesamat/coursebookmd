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
 * A span with `data-idx-alias` (pipe-separated names, set by the renderer
 * for `==display|alias==`) is additionally listed under each alias; all of
 * a span's entries share its one anchor.
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
  const spanOrder = new Map();
  for (const { root, label } of sections) {
    for (const span of root.querySelectorAll(".idx")) {
      const term = span.textContent.trim();
      if (!term) continue;
      if (!spanOrder.has(span)) spanOrder.set(span, spanOrder.size);
      const key = term.toLowerCase();
      if (!groups.has(key)) groups.set(key, { term, hits: [] });
      groups.get(key).hits.push({ span, sectionLabel: label });
      // `==display|alias==` spans are also listed under each alias. Aliases
      // matching the term itself (case-insensitively) add nothing.
      const aliases = span.getAttribute("data-idx-alias");
      if (!aliases) continue;
      const seenAliases = new Set();
      for (const alias of aliases.split("|")) {
        const name = alias.trim();
        if (!name) continue;
        const aliasKey = name.toLowerCase();
        if (aliasKey === key || seenAliases.has(aliasKey)) continue;
        seenAliases.add(aliasKey);
        if (!groups.has(aliasKey)) groups.set(aliasKey, { term: name, hits: [] });
        groups.get(aliasKey).hits.push({ span, sectionLabel: label });
      }
    }
  }

  // Mint one anchor per span up front: an aliased span is listed under
  // several terms and must keep a single id across all of its entries.
  const spanIds = new Map();
  const nextSuffix = new Map();
  const anchorFor = (span) => {
    const existing = spanIds.get(span);
    if (existing) return existing;
    const base = IDX_ID_PREFIX + slugifyTerm(span.textContent.trim());
    let n = nextSuffix.get(base) ?? 1;
    let id = n === 1 ? base : `${base}-${n}`;
    while (takenIds.has(id)) {
      n++;
      id = n === 1 ? base : `${base}-${n}`;
    }
    takenIds.add(id);
    nextSuffix.set(base, n + 1);
    span.id = id;
    spanIds.set(span, id);
    return id;
  };

  // Resolve each group's occurrence labels once so the entries and the
  // hover pass below work from the same list.
  const groupOccurrences = new Map();
  const ownLabels = new Map();
  for (const group of groups.values()) {
    groupOccurrences.set(
      group,
      group.hits.map(({ span, sectionLabel }) => {
        const label = occurrenceLabel(span, sectionLabel);
        if (!ownLabels.has(span)) ownLabels.set(span, label);
        return { span, label };
      }),
    );
  }

  const entries = [...groups.values()]
    .sort((a, b) => a.term.toLowerCase().localeCompare(b.term.toLowerCase()))
    .map((group) => ({
      term: group.term,
      occurrences: groupOccurrences.get(group).map(({ span, label }) => ({
        id: anchorFor(span),
        label,
      })),
    }));

  // One hover per span, unioned across every term that lists it: an aliased
  // span belongs to several entries, and whichever entry ran last must not
  // hide the others' locations. Multi-location spans read "Also in: ..."; a
  // term appearing nowhere else reads "Only in: ...". The accessible name
  // carries the same information because data-* attributes are invisible
  // to screen readers.
  const othersBySpan = new Map();
  for (const occs of groupOccurrences.values()) {
    for (let i = 0; i < occs.length; i++) {
      if (!othersBySpan.has(occs[i].span)) {
        othersBySpan.set(occs[i].span, new Map());
      }
      const others = othersBySpan.get(occs[i].span);
      for (let j = 0; j < occs.length; j++) {
        if (j !== i) others.set(occs[j].span, occs[j].label);
      }
    }
  }
  for (const [span, others] of othersBySpan) {
    const ordered = [...others.entries()].sort(
      (a, b) => spanOrder.get(a[0]) - spanOrder.get(b[0]),
    );
    const seenLabels = new Set();
    const deduped = [];
    for (const [, label] of ordered) {
      if (seenLabels.has(label)) continue;
      seenLabels.add(label);
      deduped.push(label);
    }
    const own = ownLabels.get(span);
    const attr =
      deduped.length > 0 ? `Also in: ${deduped.join(", ")}` : `Only in: ${own}`;
    span.setAttribute("data-locations", attr);
    span.setAttribute(
      "aria-label",
      `${span.textContent.trim()}, ${
        deduped.length > 0 ? `also in ${deduped.join(", ")}` : `only in ${own}`
      }`,
    );
  }

  return entries;
}

/**
 * Build the index section element. Each entry renders the term followed by
 * one link per distinct locator label, labeled by the occurrence's section.
 * The heading is plain text so it cannot leak term markup into TOC/navigator
 * text reads.
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
    // Print indexes merge identical locators, and two occurrences under the
    // same heading render the same label, so only one link per label is kept.
    const seenLabels = new Set();
    for (const { id, label } of occurrences) {
      if (seenLabels.has(label)) continue;
      seenLabels.add(label);
      if (links.childElementCount > 0) {
        // A bare ", " text node would become an anonymous flex item whose
        // trailing space is trimmed; a pre-whitespace span renders it.
        const sep = document.createElement("span");
        sep.className = "idx-sep";
        sep.textContent = ", ";
        links.appendChild(sep);
      }
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
  for (const span of contentEl.querySelectorAll(".idx[data-locations]")) {
    span.removeAttribute("data-locations");
    span.removeAttribute("aria-label");
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
 * spot. When a scroll pane is given, the flash waits until the programmatic
 * scroll has settled and the term is inside the pane, so the highlight is
 * still on screen when the term arrives. Safe to call repeatedly: the
 * animation restarts on the same element.
 *
 * @param {HTMLElement | null} span
 * @param {HTMLElement | null} [pane] - The scrolling viewport, when the
 *   flash follows a programmatic scroll.
 */
export function flashIndexedTerm(span, pane = null) {
  if (!span) return;
  const begin = () => {
    span.classList.remove("idx-highlight");
    // Force a reflow so a repeat click restarts the animation.
    void span.offsetWidth;
    span.classList.add("idx-highlight");
    const remove = () => span.classList.remove("idx-highlight");
    // Fallback timer for environments where the animation never runs
    // (e.g. prefers-reduced-motion), so the class cannot stick.
    const fallback = setTimeout(remove, 2600);
    span.addEventListener(
      "animationend",
      () => {
        clearTimeout(fallback);
        remove();
      },
      { once: true },
    );
  };

  if (!pane) {
    begin();
    return;
  }

  // Wait for the scroll to settle (scrollTop stable for a few frames)
  // before flashing, so the highlight starts when the term is on screen.
  let lastTop = null;
  let frames = 0;
  const tick = () => {
    if (!document.contains(span)) return;
    const top = pane.scrollTop;
    const settled = lastTop !== null && top === lastTop;
    lastTop = top;
    frames++;
    if (settled && frames > 2 && inPaneView(span, pane)) {
      begin();
      return;
    }
    if (frames < 240) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function inPaneView(span, pane) {
  const spanRect = span.getBoundingClientRect();
  const paneRect = pane.getBoundingClientRect();
  return spanRect.top >= paneRect.top - 1 && spanRect.bottom <= paneRect.bottom + 1;
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

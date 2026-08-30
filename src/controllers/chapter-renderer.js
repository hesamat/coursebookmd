/**
 * chapter-renderer.js — Coursebook/single-document rendering and chapter
 * navigation, composed by app.js via injected dependencies. Controllers
 * never import each other; cross-controller calls are routed through deps.
 */
import { renderMarkdown, sanitizeHtml } from "../renderer/markdown-renderer.js";
import { ContentEnhancer } from "../renderer/content-enhancer.js";
import { SectionNavigator } from "../navigator/section-navigator.js";
import {
  computeSectionNumbers,
  computeSectionNumbersForSections,
  applyHeadingNumber,
} from "../core/section-numbering.js";
import { resolveContentRefs, slugifyForId } from "../core/utils.js";
import { parseLocationHash, formatLocationHash } from "../core/navigation.js";
import { extractTocItems } from "../core/toc-data.js";
import { addReadingAids } from "../core/reading-aids.js";
import { rebuildIndexSection, flashIndexedTerm } from "../core/indexed-terms.js";
import { getChapterTitle, chapterSectionSlug } from "../core/coursebook-loader.js";
import { autoExpandGroup } from "../core/nav-groups.js";

export function createChapterRenderer(deps) {
  const {
    state,
    beforeNavigate,
    updateOverlay,
    updateActiveChapter,
    updateChapterNav,
    syncIndexNavItem,
    syncEditorWithCurrent,
    resolveLocalImages,
  } = deps;

  /**
   * Render the entire coursebook as a single continuous page.
   * Each chapter (and the landing page) is wrapped in a <section> with an id,
   * so scroll-spy can track which chapter is currently in view.
   */
  async function renderAllChapters() {
    // Revoke object URLs from the previous render before clearing the DOM.
    state.localImageUrls.forEach((url) => URL.revokeObjectURL(url));
    state.localImageUrls = [];
    // Disconnect the ResizeObserver before clearing the content so it does not
    // hold references to the detached sections.
    state.scrollSpy.disconnectObserver();
    state.contentEl.innerHTML = "";

    // Build all sections: landing page (idx -1) + chapters (0..N-1)
    const sectionEls = [];

    // Landing page section
    const landingSection = document.createElement("section");
    landingSection.id = "overview";
    landingSection.className = "coursebook-section";
    landingSection.innerHTML = sanitizeHtml(
      renderMarkdown(state.sectionMarkdowns[0] ?? state.coursebook.markdown),
    );
    for (const img of landingSection.querySelectorAll("img")) {
      img.dataset.originalSrc = img.getAttribute("src");
    }
    resolveContentRefs(landingSection, state.coursebook.parentPath);
    await resolveLocalImages(landingSection);
    state.contentEl.appendChild(landingSection);
    sectionEls.push(landingSection);

    // Chapter sections
    for (let i = 0; i < state.coursebook.chapters.length; i++) {
      const sectionIdx = i + 1;
      const markdown = state.sectionMarkdowns[sectionIdx];

      const section = document.createElement("section");
      section.id = chapterSectionSlug(state.coursebook.chapters[i]);
      section.className = "coursebook-section";
      if (markdown) {
        section.innerHTML = sanitizeHtml(renderMarkdown(markdown));
        for (const img of section.querySelectorAll("img")) {
          img.dataset.originalSrc = img.getAttribute("src");
        }
        resolveContentRefs(section, state.coursebook.chapters[i].resolvedPath);
        await resolveLocalImages(section);
      } else {
        // Render a placeholder so section index stays aligned 1:1 with
        // coursebook.chapters — scroll-spy relies on this mapping.
        section.innerHTML = sanitizeHtml(
          renderMarkdown(
            `## Chapter unavailable\n\nThe chapter file could not be loaded.`,
          ),
        );
      }
      state.contentEl.appendChild(section);
      sectionEls.push(section);
    }

    // Apply continuous section numbers across all headings.
    // Use computeSectionNumbersForSections so the landing page (section 0)
    // is left unnumbered and chapter 1 starts at "1". skipFirst ensures the
    // landing page is never numbered even with zero chapters.
    const sectionHeadingArrays = sectionEls.map((s) =>
      Array.from(s.querySelectorAll("h1, h2, h3")),
    );
    const numbersBySection = computeSectionNumbersForSections(sectionHeadingArrays, {
      skipFirst: true,
    });

    // Track used IDs to avoid duplicates across chapters.
    // Section IDs (overview, chapter slugs) must be reserved first so a
    // heading with the same text as a chapter title doesn't collide.
    const usedIds = new Set();
    for (const section of sectionEls) {
      if (section.id) usedIds.add(section.id);
    }
    for (let s = 0; s < sectionEls.length; s++) {
      const headings = sectionHeadingArrays[s];
      const numbers = numbersBySection[s];
      for (let i = 0; i < headings.length; i++) {
        const heading = headings[i];
        // Ensure unique ID across all chapters
        if (!heading.id || usedIds.has(heading.id)) {
          const baseId = heading.id || slugifyForId(heading.textContent);
          let uniqueId = baseId;
          let suffix = 1;
          while (usedIds.has(uniqueId)) {
            uniqueId = `${baseId}-${suffix++}`;
          }
          heading.id = uniqueId;
        }
        usedIds.add(heading.id);
        applyHeadingNumber(heading, numbers[i]);
      }
    }

    // Rewrite parent chapter list .md links to in-app hash navigation
    rewriteChapterLinks();

    // Build TOCs for all chapters
    buildAllTOCs();

    // In-content reading aids (per-H2 go-up links). Runs after numbering/ids
    // after numbering/ids are final and before ContentEnhancer, so the aids
    // are plain DOM and never enhanced.
    for (const section of sectionEls) {
      addReadingAids(section);
    }

    // General index of ==term== occurrences. Appended last, after numbering
    // and id assignment, so it is excluded from section-number arithmetic.
    // Only coursebook mode: a standalone document gets no index section.
    if (state.coursebook) {
      rebuildIndexSection(state.contentEl);
      syncIndexNavItem();
    }

    // Re-observe the content area now that the new sections are in the DOM.
    state.scrollSpy.reobserve();

    // Enhance content (Shiki, KaTeX, copy buttons, D2/SVG diagrams)
    await ContentEnhancer.enhance(state.contentEl);

    // Set up sectionNavigator for presentation mode
    state.sectionNavigator = new SectionNavigator(state.contentEl, state.previewPane, {
      scrollToEl: (el, { instant }) =>
        instant
          ? state.scrollSpy.scrollToInstant(el)
          : state.scrollSpy.scrollToSmooth(el),
    });
    state.sectionNavigator.onNavigate = updateOverlay;
    state.sectionNavigator.setup();
    setupScrollSpyForCurrentChapter();
  }

  /**
   * Render a single markdown document (standalone mode, no coursebook).
   */
  async function renderSingleMarkdown(markdown) {
    state.currentMarkdown = markdown;
    state.contentEl.innerHTML = sanitizeHtml(renderMarkdown(markdown));

    const headings = Array.from(state.contentEl.querySelectorAll("h1, h2, h3"));
    const numbers = computeSectionNumbers(headings);
    for (let i = 0; i < headings.length; i++) {
      if (!headings[i].id) {
        headings[i].id = slugifyForId(headings[i].textContent);
      }
      applyHeadingNumber(headings[i], numbers[i]);
    }

    // Clear all chapter TOCs in standalone mode
    if (state.chapterListEl) state.chapterListEl.innerHTML = "";

    await ContentEnhancer.enhance(state.contentEl);

    state.sectionNavigator = new SectionNavigator(state.contentEl, state.previewPane, {
      scrollToEl: (el, { instant }) =>
        instant
          ? state.scrollSpy.scrollToInstant(el)
          : state.scrollSpy.scrollToSmooth(el),
    });
    state.sectionNavigator.onNavigate = updateOverlay;
    state.sectionNavigator.setup();
    setupScrollSpyForCurrentChapter();

    state.previewPane.scrollTop = 0;
  }

  /**
   * Show only the current chapter/landing section and hide the others.
   */
  function updateVisibleSection() {
    const sections = Array.from(state.contentEl.querySelectorAll(".coursebook-section"));
    const activeId =
      state.currentChapterIdx === -1
        ? "overview"
        : chapterSectionSlug(state.coursebook.chapters[state.currentChapterIdx]);
    for (const section of sections) {
      section.classList.toggle("active", section.id === activeId);
    }
  }

  /**
   * Scroll to the landing page section.
   */
  async function showLandingPage({ skipHash = false } = {}) {
    if (!state.coursebook) return;
    if (state.editMode) await beforeNavigate();
    state.currentChapterIdx = -1;
    state.chapterTitleEl.textContent = state.coursebook.title;
    updateActiveChapter();
    updateChapterNav();
    updateVisibleSection();
    if (state.sectionNavigator) {
      state.sectionNavigator.setup();
      setupScrollSpyForCurrentChapter();
      updateOverlay(0);
    }
    syncEditorWithCurrent();
    if (!skipHash) updateLocationHash();

    const section = state.contentEl.querySelector("#overview");
    if (section) state.scrollSpy.scrollToInstant(section);
  }

  /**
   * Show the generated general-index section. The index lives outside the
   * chapter list, so chapter state (currentChapterIdx, sidebar highlight)
   * is left untouched; chapter navigation deactivates it again via
   * updateVisibleSection.
   */
  function showIndexPage({ skipHash = false } = {}) {
    if (!state.coursebook) return;
    for (const section of state.contentEl.querySelectorAll(".coursebook-section")) {
      section.classList.toggle("active", section.id === "index");
    }
    updateActiveChapter();
    if (!skipHash) history.replaceState(null, "", "#index");

    const section = state.contentEl.querySelector("#index");
    if (section) state.scrollSpy.scrollToInstant(section);
  }

  /**
   * Scroll to a chapter section by index.
   */
  async function loadChapterByIdx(idx, { skipHash = false } = {}) {
    if (!state.coursebook || idx < 0 || idx >= state.coursebook.chapters.length) return;
    if (state.editMode) await beforeNavigate();

    state.currentChapterIdx = idx;
    const chapter = state.coursebook.chapters[idx];
    const title = getChapterTitle(state.sectionMarkdowns[idx + 1], chapter.title);
    state.chapterTitleEl.textContent = `${state.coursebook.title} — ${title}`;
    updateActiveChapter();
    updateChapterNav();
    updateVisibleSection();
    if (state.sectionNavigator) {
      state.sectionNavigator.setup();
      setupScrollSpyForCurrentChapter();
      updateOverlay(0);
    }
    if (!skipHash) updateLocationHash();

    syncEditorWithCurrent();

    const activeWrapper = state.chapterListEl.querySelector(
      `.chapter-item-wrapper[data-chapter-idx="${idx}"]`,
    );
    autoExpandGroup(activeWrapper);

    const sectionId = chapterSectionSlug(chapter);
    const section = state.contentEl.querySelector(`#${CSS.escape(sectionId)}`);
    if (section) state.scrollSpy.scrollToInstant(section);
  }

  /**
   * Get a URL-safe slug for a chapter title.
   * @param {string} title
   * @returns {string}
   */
  function chapterSlug(title) {
    return slugifyForId(title);
  }

  /**
   * Rewrite in-content .md chapter links to #chapter-slug hash links so
   * clicking a chapter in the parent page navigates within the app instead of
   * opening the raw .md file in a new tab.
   */
  function rewriteChapterLinks() {
    if (!state.coursebook) return;

    const pathToSlug = new Map();
    for (const chapter of state.coursebook.chapters) {
      const slug = chapterSectionSlug(chapter);
      pathToSlug.set(chapter.path, slug);
      if (chapter.resolvedPath && chapter.resolvedPath !== chapter.path) {
        pathToSlug.set(chapter.resolvedPath, slug);
      }
    }

    for (const link of state.contentEl.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href") || "";
      if (
        href.startsWith("#") ||
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("//") ||
        href.startsWith("mailto:")
      )
        continue;

      const slug = pathToSlug.get(href);
      if (slug) {
        link.setAttribute("href", `#${slug}`);
        link.removeAttribute("target");
        link.removeAttribute("rel");
      }
    }
  }

  /**
   * Get the chapter slug for the current chapter (or "overview").
   * @returns {string}
   */
  function currentChapterSlug() {
    if (state.currentChapterIdx === -1) return "overview";
    return chapterSectionSlug(state.coursebook.chapters[state.currentChapterIdx]);
  }

  /**
   * Find the chapter index that matches a slug.
   * @param {string} slug
   * @returns {number} chapter index (0-based), or -1 for overview, or -2 if not found
   */
  function findChapterIdxBySlug(slug) {
    if (slug === "overview") return -1;
    for (let i = 0; i < state.coursebook.chapters.length; i++) {
      if (chapterSectionSlug(state.coursebook.chapters[i]) === slug) return i;
    }
    return -2;
  }

  /**
   * Update the URL hash to reflect the current chapter (and optionally a heading).
   * Uses the shared formatLocationHash for the unified hash format.
   *
   * @param {string} [headingSlug] - Optional heading slug to append after /
   */
  function updateLocationHash(headingSlug) {
    const hash = formatLocationHash(currentChapterSlug(), headingSlug);
    if (location.hash !== hash) {
      history.replaceState(null, "", hash);
    }
  }

  /**
   * Parse the current URL hash and navigate to the matching chapter + heading.
   * Uses the shared parseLocationHash for the unified hash format.
   */
  async function navigateFromHash() {
    if (!state.coursebook) return;
    if (state.editMode) await beforeNavigate();
    const { chapterSlug, headingSlug } = parseLocationHash(location.hash.slice(1));
    if (!chapterSlug) return;
    if (chapterSlug === "index") {
      updateChapterNav();
      showIndexPage();
      return;
    }

    const idx = findChapterIdxBySlug(chapterSlug);
    if (idx === -2) {
      // Unknown chapter (e.g. stale hash after HMR) — fall back to overview
      history.replaceState(null, "", location.pathname + location.search);
      state.currentChapterIdx = -1;
      state.chapterTitleEl.textContent = state.coursebook.title;
      updateActiveChapter();
      updateChapterNav();
      updateVisibleSection();
      if (state.sectionNavigator) {
        state.sectionNavigator.setup();
        setupScrollSpyForCurrentChapter();
        updateOverlay(0);
      }
      syncEditorWithCurrent();
      const overview = state.contentEl.querySelector("#overview");
      if (overview) state.scrollSpy.scrollToInstant(overview);
      return;
    }

    // Update current chapter state
    state.currentChapterIdx = idx;
    if (idx === -1) {
      state.chapterTitleEl.textContent = state.coursebook.title;
    } else {
      const title = getChapterTitle(
        state.sectionMarkdowns[idx + 1],
        state.coursebook.chapters[idx].title,
      );
      state.chapterTitleEl.textContent = `${state.coursebook.title} — ${title}`;
    }
    updateActiveChapter();
    updateChapterNav();
    updateVisibleSection();
    if (state.sectionNavigator) {
      state.sectionNavigator.setup();
      setupScrollSpyForCurrentChapter();
      updateOverlay(0);
    }
    syncEditorWithCurrent();

    if (state.currentChapterIdx >= 0) {
      const activeWrapper = state.chapterListEl.querySelector(
        `.chapter-item-wrapper[data-chapter-idx="${state.currentChapterIdx}"]`,
      );
      autoExpandGroup(activeWrapper);
    }

    // Find the target element and navigate to it
    const section = state.contentEl.querySelector(`#${CSS.escape(chapterSlug)}`);
    if (!section) return;

    if (headingSlug) {
      const target = section.querySelector(`#${CSS.escape(headingSlug)}`);
      if (target) {
        // Smooth scroll for heading-level navigation (within a chapter)
        state.scrollSpy.scrollToSmooth(target);
        if (target.classList.contains("idx")) flashIndexedTerm(target, state.previewPane);
        const hash = formatLocationHash(chapterSlug, headingSlug);
        if (location.hash !== hash) history.replaceState(null, "", hash);
      }
    } else {
      // Instant scroll for chapter-level navigation
      state.scrollSpy.scrollToInstant(section);
    }
  }

  /**
   * Build TOC items for all chapters at once. Each chapter's TOC is populated
   * from the headings inside its <section> element.
   */
  function buildAllTOCs() {
    if (!state.coursebook || !state.chapterListEl) return;

    // Landing page TOC (idx -1)
    buildChapterToc(-1, "overview");

    // Chapter TOCs
    for (let i = 0; i < state.coursebook.chapters.length; i++) {
      buildChapterToc(i, chapterSectionSlug(state.coursebook.chapters[i]));
    }
  }

  /**
   * Build the TOC for a single chapter by scanning headings in its section.
   * Uses the shared extractTocItems for heading data extraction.
   * @param {number} chapterIdx - Chapter index (-1 for overview)
   * @param {string} sectionId - The section element's id
   */
  function buildChapterToc(chapterIdx, sectionId) {
    const wrapper = state.chapterListEl.querySelector(
      `.chapter-item-wrapper[data-chapter-idx="${chapterIdx}"]`,
    );
    if (!wrapper) return;
    const tocContainer = wrapper.querySelector(".chapter-toc");
    if (!tocContainer) return;
    tocContainer.innerHTML = "";

    const section = state.contentEl.querySelector(`#${CSS.escape(sectionId)}`);
    if (!section) return;

    const tocItems = extractTocItems(section);
    for (let itemIdx = 0; itemIdx < tocItems.length; itemIdx++) {
      const item = tocItems[itemIdx];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `toc-item toc-item--${item.level}`;
      btn.setAttribute("data-target", item.id);

      if (item.number) {
        const tocNumSpan = document.createElement("span");
        tocNumSpan.className = "toc-number";
        tocNumSpan.textContent = item.number;
        btn.appendChild(tocNumSpan);
        btn.appendChild(document.createTextNode(" " + item.text));
      } else {
        btn.textContent = item.text;
      }

      const headingEl = section.querySelector(`#${CSS.escape(item.id)}`);
      btn.addEventListener("click", () => {
        if (headingEl) {
          // Highlight immediately for instant feedback. The scroll-spy stays
          // consistent with this choice: the scroll below settles the heading
          // above the activation line, so a re-computation picks the same
          // item — no lock needed.
          const items = tocContainer.querySelectorAll(".toc-item");
          items.forEach((el, i) => el.classList.toggle("active", i === itemIdx));
          state.scrollSpy.scrollToSmooth(headingEl);
          const hash = formatLocationHash(sectionId, item.id);
          if (location.hash !== hash) history.replaceState(null, "", hash);
        }
      });
      tocContainer.appendChild(btn);
    }
  }

  /**
   * Get the TOC container for the currently active chapter.
   * @returns {HTMLElement | null}
   */
  function getCurrentChapterToc() {
    if (!state.chapterListEl) return null;
    const selector = `.chapter-item-wrapper[data-chapter-idx="${state.currentChapterIdx}"] .chapter-toc`;
    return state.chapterListEl.querySelector(selector);
  }

  /**
   * Set up the scroll spy for the currently active chapter section.
   * Called after chapter switches, initial render, and content edits.
   * Standalone mode tracks every h2/h3 in the content; coursebook mode tracks
   * the active section's h2/h3.
   */
  function setupScrollSpyForCurrentChapter() {
    if (!state.coursebook) {
      // Standalone mode — track all headings in the content
      state.scrollSpy.setHeadings(Array.from(state.contentEl.querySelectorAll("h2, h3")));
      return;
    }
    const sections = Array.from(state.contentEl.querySelectorAll(".coursebook-section"));
    const activeSection = sections[state.currentChapterIdx + 1] ?? sections[0];
    if (activeSection) {
      state.scrollSpy.setHeadings(Array.from(activeSection.querySelectorAll("h2, h3")));
    }
  }

  // Last-rendered structural fingerprints per section element, used to skip
  // global rebuilds (all-section renumbering, TOCs, index) when an edit
  // changed no headings and no indexed terms. Keyed by element, so a full
  // re-render (fresh elements) always does the full pass.
  const renderFingerprints = new WeakMap();

  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function headingFingerprint(h) {
    let text = "";
    for (const n of h.childNodes) {
      if (n.nodeType === 1 && n.classList.contains("heading-number")) continue;
      text += n.textContent;
    }
    return `${h.tagName}:${normalizeWhitespace(text)}`;
  }

  // Enhancement-invariant fingerprint of a top-level content block: equal
  // fingerprints mean the older (already enhanced) node renders the same
  // content and can be reused instead of being re-rendered and re-highlighted.
  function blockFingerprint(node) {
    if (node.nodeType !== 1) {
      return `#${node.nodeType}:${normalizeWhitespace(node.textContent)}`;
    }
    const tag = node.tagName;
    if (tag === "PRE") {
      const codeEl = node.querySelector(":scope > code");
      const lang =
        node.getAttribute("data-lang") ||
        codeEl?.className.match(/(?:lang|language)-(\S+)/)?.[1] ||
        "text";
      const source = node.getAttribute("data-source") ?? codeEl?.textContent ?? "";
      return `pre:${lang}:${normalizeWhitespace(source)}`;
    }
    if (/^H[1-6]$/.test(tag)) return headingFingerprint(node);
    const imgs = node.querySelectorAll("img");
    if (imgs.length > 0) {
      const srcs = Array.from(imgs)
        .map((img) => img.getAttribute("data-original-src") || img.getAttribute("src"))
        .join(",");
      return `${tag}:imgs:${srcs}:${normalizeWhitespace(node.textContent)}`;
    }
    return `${tag}:${normalizeWhitespace(node.textContent)}`;
  }

  function revokeBlobUrlsIn(root) {
    if (root.nodeType !== 1) return;
    for (const img of root.querySelectorAll("img")) {
      const src = img.getAttribute("src") || "";
      if (src.startsWith("blob:")) {
        URL.revokeObjectURL(src);
        state.localImageUrls = state.localImageUrls.filter((url) => url !== src);
      }
    }
  }

  function applySectionIdsAndNumbers(s, numbers, usedIds) {
    const headings = Array.from(s.querySelectorAll("h1, h2, h3"));
    const nums = numbers ?? computeSectionNumbers(headings);
    for (let i = 0; i < headings.length; i++) {
      if (!headings[i].id || usedIds.has(headings[i].id)) {
        const baseId = headings[i].id || slugifyForId(headings[i].textContent);
        let uniqueId = baseId;
        let suffix = 1;
        while (usedIds.has(uniqueId)) {
          uniqueId = `${baseId}-${suffix++}`;
        }
        headings[i].id = uniqueId;
      }
      usedIds.add(headings[i].id);
      const num = nums[i] || "";
      const existing = headings[i].querySelector(".heading-number");
      const target = num ? num + " " : "";
      if (!existing || existing.textContent !== target) {
        applyHeadingNumber(headings[i], num);
      }
    }
  }

  // A reused block's content is identical but its absolute source line may
  // have shifted (edits above it); copy the fresh annotations over so source
  // jumps stay accurate. Skipped when the annotated-element counts diverge
  // (rare enhanced-subtree shapes) — those self-heal on the next full render.
  function syncSourceLines(oldNode, freshNode) {
    if (oldNode.nodeType !== 1 || freshNode.nodeType !== 1) return;
    const annotated = (root) =>
      [root, ...root.querySelectorAll("[data-src-line]")].filter(
        (n) => n.nodeType === 1 && n.hasAttribute("data-src-line"),
      );
    const oldAnnotated = annotated(oldNode);
    const freshAnnotated = annotated(freshNode);
    if (oldAnnotated.length !== freshAnnotated.length) return;
    for (let i = 0; i < oldAnnotated.length; i++) {
      const line = freshAnnotated[i].getAttribute("data-src-line");
      if (oldAnnotated[i].getAttribute("data-src-line") !== line) {
        oldAnnotated[i].setAttribute("data-src-line", line);
      }
    }
  }

  // SectionNavigator wraps heading groups in plain <section> elements on
  // initial render. The in-place diff works on rendered blocks, so the
  // wrappers are flattened first — the same end state a full re-render of
  // the section produces today.
  function unwrapNavigatorSections(section) {
    for (const wrapper of Array.from(section.querySelectorAll(":scope > section"))) {
      const parent = wrapper.parentNode;
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      wrapper.remove();
    }
  }

  // Reconcile the section's top-level blocks in place, reusing every
  // unchanged block so code blocks keep their Shiki highlight, images keep
  // their blob URLs, and DOM churn stays local to the edit.
  // sectionChapterIdx is the chapter index (-1 = landing page), so content
  // refs resolve against the right chapter directory even when refreshing a
  // section that is not the one currently displayed.
  async function refreshSectionInPlace(section, markdown, sectionChapterIdx) {
    unwrapNavigatorSections(section);
    const tpl = document.createElement("template");
    tpl.innerHTML = sanitizeHtml(renderMarkdown(markdown));

    const headingsFp = Array.from(tpl.content.querySelectorAll("h1, h2, h3"))
      .map(headingFingerprint)
      .join("|");
    const termsFp = (markdown.match(/==[^=]+==/g) || []).sort().join("|");
    const prevFp = renderFingerprints.get(section);
    const headingsChanged = !prevFp || prevFp.headings !== headingsFp;
    const termsChanged = !prevFp || prevFp.terms !== termsFp;
    renderFingerprints.set(section, { headings: headingsFp, terms: termsFp });

    // Go-up buttons are stripped first — addReadingAids re-adds them below,
    // and their presence would otherwise break the block alignment.
    for (const btn of section.querySelectorAll(":scope > .go-up-link")) {
      btn.remove();
    }
    const oldBlocks = Array.from(section.childNodes);
    const newBlocks = Array.from(tpl.content.childNodes);

    let start = 0;
    while (
      start < oldBlocks.length &&
      start < newBlocks.length &&
      blockFingerprint(oldBlocks[start]) === blockFingerprint(newBlocks[start])
    ) {
      syncSourceLines(oldBlocks[start], newBlocks[start]);
      start += 1;
    }
    let endOld = oldBlocks.length;
    let endNew = newBlocks.length;
    while (
      endOld > start &&
      endNew > start &&
      blockFingerprint(oldBlocks[endOld - 1]) === blockFingerprint(newBlocks[endNew - 1])
    ) {
      syncSourceLines(oldBlocks[endOld - 1], newBlocks[endNew - 1]);
      endOld -= 1;
      endNew -= 1;
    }

    const anchor = oldBlocks[endOld] ?? null;
    for (const node of oldBlocks.slice(start, endOld)) {
      revokeBlobUrlsIn(node);
      node.remove();
    }

    // Enhance the replaced blocks in place through temporary wrappers, so
    // Shiki/KaTeX/diagram work only runs for genuinely new content.
    const wrappers = [];
    for (const node of newBlocks.slice(start, endNew)) {
      const wrapper = document.createElement("div");
      wrapper.appendChild(node);
      section.insertBefore(wrapper, anchor);
      wrappers.push(wrapper);
    }

    // Re-apply section numbers and unique IDs synchronously, before any
    // awaits — new headings must never paint without their number spans.
    // The edited section always (replaced blocks may contain headings);
    // all sections only when its heading structure changed, since numbering
    // may shift in later chapters. The generated index section is excluded:
    // it holds an unnumbered heading and would otherwise desync
    // sectionNumbers indices.
    const allSections = Array.from(
      state.contentEl.querySelectorAll(".coursebook-section"),
    ).filter((s) => !s.classList.contains("index-section"));
    const usedIds = new Set();
    for (const s of allSections) {
      if (s.id) usedIds.add(s.id);
    }
    if (headingsChanged) {
      for (let sIdx = 0; sIdx < allSections.length; sIdx++) {
        applySectionIdsAndNumbers(allSections[sIdx], state.sectionNumbers[sIdx], usedIds);
      }
      // Numbers shifted: rebuild ALL chapter TOCs, and the reading aids in
      // every section (re-adding links elsewhere is a no-op).
      buildAllTOCs();
      for (const s of state.contentEl.querySelectorAll(".coursebook-section")) {
        addReadingAids(s);
      }
      rebuildIndexSection(state.contentEl);
    } else {
      applySectionIdsAndNumbers(
        section,
        state.sectionNumbers[allSections.indexOf(section)],
        usedIds,
      );
      addReadingAids(section);
      if (termsChanged) {
        rebuildIndexSection(state.contentEl);
      }
    }

    if (wrappers.length > 0) {
      const contentPath =
        sectionChapterIdx >= 0
          ? state.coursebook.chapters[sectionChapterIdx].resolvedPath
          : state.coursebook.parentPath;
      for (const wrapper of wrappers) {
        for (const img of wrapper.querySelectorAll("img")) {
          img.dataset.originalSrc = img.getAttribute("src");
        }
        resolveContentRefs(wrapper, contentPath);
        await resolveLocalImages(wrapper);
        await ContentEnhancer.enhance(wrapper);
        wrapper.replaceWith(...wrapper.childNodes);
      }
    }
  }

  // Full section re-render — the pre-optimization pipeline, kept as the
  // correctness fallback for when the in-place reconciliation hits an
  // unexpected DOM shape mid-mutation.
  async function refreshSectionFully(section, markdown, sectionChapterIdx) {
    revokeBlobUrlsIn(section);
    section.innerHTML = sanitizeHtml(renderMarkdown(markdown));

    // Preserve the original src so resolveLocalImages can fall back to the
    // coursebook root if the resolved path is not found.
    for (const img of section.querySelectorAll("img")) {
      img.dataset.originalSrc = img.getAttribute("src");
    }

    if (sectionChapterIdx >= 0) {
      resolveContentRefs(
        section,
        state.coursebook.chapters[sectionChapterIdx].resolvedPath,
      );
    } else {
      resolveContentRefs(section, state.coursebook.parentPath);
    }

    await resolveLocalImages(section);

    const allSections = Array.from(
      state.contentEl.querySelectorAll(".coursebook-section"),
    ).filter((s) => !s.classList.contains("index-section"));
    const usedIds = new Set();
    for (const s of allSections) {
      if (s.id) usedIds.add(s.id);
    }
    for (let sIdx = 0; sIdx < allSections.length; sIdx++) {
      applySectionIdsAndNumbers(allSections[sIdx], state.sectionNumbers[sIdx], usedIds);
    }

    buildAllTOCs();
    for (const s of state.contentEl.querySelectorAll(".coursebook-section")) {
      addReadingAids(s);
    }
    rebuildIndexSection(state.contentEl);

    await ContentEnhancer.enhance(section);
  }

  /**
   * Re-render one coursebook section from its markdown, reusing unchanged
   * blocks when possible. Used by editor input (current section) and by the
   * file watcher (any section, including hidden ones).
   * @param {number} chapterIdx - Chapter index, -1 for the landing page.
   * @param {string} markdown
   */
  async function refreshSectionByIndex(chapterIdx, markdown) {
    if (!state.coursebook) return;
    const sectionId =
      chapterIdx === -1
        ? "overview"
        : chapterSectionSlug(state.coursebook.chapters[chapterIdx]);
    const section = state.contentEl.querySelector(`#${CSS.escape(sectionId)}`);
    if (!section) return;

    const isCurrent = chapterIdx === state.currentChapterIdx;
    const scrollTop = isCurrent ? state.previewPane.scrollTop : null;
    try {
      await refreshSectionInPlace(section, markdown, chapterIdx);
    } catch (e) {
      console.warn("In-place refresh failed; full section re-render:", e);
      renderFingerprints.delete(section);
      await refreshSectionFully(section, markdown, chapterIdx);
    }
    if (isCurrent) {
      state.previewPane.scrollTop = scrollTop;

      // Re-setup scroll spy for the new heading elements
      setupScrollSpyForCurrentChapter();
    }
  }

  async function refreshCurrentSection(markdown) {
    await refreshSectionByIndex(state.currentChapterIdx, markdown);
  }

  return {
    renderAllChapters,
    renderSingleMarkdown,
    updateVisibleSection,
    showLandingPage,
    showIndexPage,
    loadChapterByIdx,
    chapterSlug,
    rewriteChapterLinks,
    currentChapterSlug,
    findChapterIdxBySlug,
    updateLocationHash,
    navigateFromHash,
    buildAllTOCs,
    buildChapterToc,
    getCurrentChapterToc,
    setupScrollSpyForCurrentChapter,
    refreshCurrentSection,
    refreshSectionByIndex,
  };
}

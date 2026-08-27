/**
 * SectionNavigator
 * Manages heading-based navigation over a rendered document.
 * Wraps content into <section> elements at h2 boundaries and provides
 * waypoint navigation with spotlight dimming.
 */
export class SectionNavigator {
  /**
   * @param {HTMLElement} contentEl - The container holding rendered HTML.
   * @param {HTMLElement} [pane] - The scrollable viewport containing `contentEl`.
   *   Defaults to `contentEl.parentElement`.
   */
  constructor(contentEl, pane = contentEl.parentElement) {
    this.contentEl = contentEl;
    this.pane = pane;
    this.headings = [];
    this.currentIdx = 0;
    this.spotlight = false;
    this.onNavigate = null;
  }

  /**
   * Wrap top-level children into <section> elements at h2 boundaries.
   * Only runs when the content does NOT already have .coursebook-section
   * elements (i.e. standalone mode). In continuous flow, chapter sections
   * already exist and wrapping them would break spotlight dimming.
   */
  wrapSections() {
    const chapters = this.contentEl.querySelectorAll(".coursebook-section");
    if (chapters.length > 0) {
      for (const chapter of chapters) {
        this._wrapAtHeadings(chapter);
      }
    } else {
      this._wrapAtHeadings(this.contentEl);
    }
  }

  _wrapAtHeadings(container) {
    // Already wrapped this container
    if (container.querySelector(":scope > section")) return;

    const children = Array.from(container.childNodes);
    const sections = [];
    let current = null;

    for (const child of children) {
      if (child.nodeType === 1 && child.tagName === "H2") {
        current = document.createElement("section");
        sections.push(current);
        current.appendChild(child);
      } else if (current) {
        current.appendChild(child);
      } else {
        current = document.createElement("section");
        sections.push(current);
        current.appendChild(child);
      }
    }

    for (const s of sections) {
      container.appendChild(s);
    }
  }

  /**
   * Set up navigation for the currently active chapter/section.
   * Only h1 and h2 within the active section are waypoints.
   */
  setup() {
    this.wrapSections();
    const activeSection = this.contentEl.querySelector(".coursebook-section.active");
    const scope = activeSection || this.contentEl;
    this.headings = Array.from(scope.querySelectorAll("h1, h2"));
    this.headings.forEach((h, i) => {
      if (!h.id) h.id = `heading-${i}`;
    });

    // Only highlight the first heading if we're in presentation mode
    if (this.headings.length > 0 && document.body.classList.contains("presenting")) {
      this._highlight(0);
    }
  }

  /**
   * Get the TOC entries (h1 and h2 only).
   * @returns {Array<{id: string, text: string, level: number}>}
   */
  getTOC() {
    return this.headings.map((h) => ({
      id: h.id,
      text: h.textContent.trim(),
      level: h.tagName === "H1" ? 1 : 2,
    }));
  }

  _clearHighlight() {
    this.headings.forEach((h) => h.classList.remove("current"));
    this.contentEl
      .querySelectorAll("section.active:not(.coursebook-section)")
      .forEach((s) => s.classList.remove("active"));
  }

  /**
   * Clear all navigation highlights. Called when exiting presentation mode.
   */
  clearHighlight() {
    this._clearHighlight();
  }

  /**
   * Update the current heading index and overlay without touching the
   * visual `.current` highlight. Use `syncVisual()` to refresh that.
   *
   * @param {number} idx
   */
  setCurrent(idx) {
    if (idx < 0 || idx >= this.headings.length) return;
    if (idx !== this.currentIdx) {
      this.currentIdx = idx;
      if (this.onNavigate) this.onNavigate(idx, this.headings[idx]);
    }
  }

  /**
   * Apply or remove the `.current` visual highlight for the current heading,
   * but only if the heading is actually visible in the scroll viewport. This
   * avoids layout jumps from highlighting headings that are outside the view.
   */
  syncVisual() {
    const h = this.current;
    // Remove the visual highlight from every other heading first.
    for (const heading of this.headings) {
      if (heading !== h) heading.classList.remove("current");
    }
    this.contentEl
      .querySelectorAll("section.active:not(.coursebook-section)")
      .forEach((s) => s.classList.remove("active"));
    if (!h) return;

    let inView = true;
    if (this.pane) {
      const paneRect = this.pane.getBoundingClientRect();
      const rect = h.getBoundingClientRect();
      const top = rect.top - paneRect.top;
      const bottom = top + rect.height;
      inView = top < this.pane.clientHeight && bottom > 0;
    }

    if (inView) {
      h.classList.add("current");
      if (this.spotlight) {
        // Add .active to the nearest wrapper <section>. In coursebook mode this
        // is the H2 subsection inside the chapter; in standalone mode it is the
        // wrapper section created by _wrapAtHeadings.
        const section = h.closest("section");
        if (section) section.classList.add("active");
      }
    } else {
      h.classList.remove("current");
    }
  }

  _highlight(idx) {
    this.setCurrent(idx);
    this.syncVisual();
  }

  navigateTo(idx, opts = {}) {
    if (idx < 0 || idx >= this.headings.length) return;
    this._highlight(idx);
    this.headings[idx].scrollIntoView({
      behavior: opts.instant ? "auto" : "smooth",
      block: "start",
    });
  }

  next() {
    this.navigateTo(this.currentIdx + 1);
  }

  prev() {
    this.navigateTo(this.currentIdx - 1);
  }

  first() {
    this.navigateTo(0);
  }

  last() {
    this.navigateTo(this.headings.length - 1);
  }

  toggleSpotlight() {
    this.spotlight = !this.spotlight;
    document.body.classList.toggle("spotlight", this.spotlight);
    this.syncVisual();
  }

  get count() {
    return this.headings.length;
  }

  get current() {
    return this.headings[this.currentIdx];
  }

  get currentText() {
    return this.current?.textContent?.trim() || "";
  }

  get nextText() {
    return this.headings[this.currentIdx + 1]?.textContent?.trim() || null;
  }
}

/**
 * SectionNavigator
 * Manages heading-based navigation over a rendered document.
 * Wraps content into <section> elements at h2 boundaries and provides
 * waypoint navigation with spotlight dimming.
 */
export class SectionNavigator {
  /** Beyond this many pixels, programmatic scrolls jump instantly. */
  static LONG_SCROLL_DISTANCE = 3000;

  /**
   * @param {HTMLElement} contentEl - The container holding rendered HTML.
   * @param {HTMLElement} [pane] - The scrollable viewport containing `contentEl`.
   *   Defaults to `contentEl.parentElement`.
   * @param {object} [options]
   * @param {(el: HTMLElement, opts: { instant: boolean }) => void} [options.scrollToEl]
   *   Scroll strategy for waypoint moves, injected by hosts that own a
   *   scroll-spy. Injected moves land at the shared SCROLL_OFFSET and take
   *   part in the spy's suppression guard; without it, moves fall back to
   *   `scrollIntoView`.
   */
  constructor(contentEl, pane = contentEl.parentElement, { scrollToEl } = {}) {
    this.contentEl = contentEl;
    this.pane = pane;
    this.scrollToEl = scrollToEl ?? null;
    this.headings = [];
    this.currentIdx = 0;
    this.spotlight = false;
    this.onNavigate = null;
  }

  /**
   * Wrap content into <section> elements at h2 boundaries.
   * When .coursebook-section chapters exist, each chapter is wrapped INSIDE
   * at its own h2 boundaries, so spotlight dimming activates the matching
   * h2 subsection. In standalone mode the whole content is wrapped the same
   * way at the content root. Containers that already have direct child
   * sections are left untouched.
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

    // Always reset the waypoint index for the new chapter/scope.
    // Highlight only in presentation mode, but the index must be valid
    // regardless of whether the mode is currently active.
    this.currentIdx = 0;
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
    this.headings.forEach((h) => h.classList.remove("active"));
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
   * visual `.active` highlight. Use `syncVisual()` to refresh that.
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
   * Apply or remove the `.active` visual highlight for the current heading,
   * but only if the heading is actually visible in the scroll viewport. This
   * avoids layout jumps from highlighting headings that are outside the view.
   */
  syncVisual() {
    const h = this.current;
    // Remove the visual highlight from every other heading first.
    for (const heading of this.headings) {
      if (heading !== h) heading.classList.remove("active");
    }
    this.contentEl
      .querySelectorAll("section.active:not(.coursebook-section)")
      .forEach((s) => s.classList.remove("active"));
    if (!h) return;

    let inView = true;
    let sectionInView = true;
    let section = null;
    if (this.pane) {
      const paneRect = this.pane.getBoundingClientRect();
      const rect = h.getBoundingClientRect();
      const top = rect.top - paneRect.top;
      const bottom = top + rect.height;
      inView = top < this.pane.clientHeight && bottom > 0;

      section = h.closest("section");
      if (section) {
        const sRect = section.getBoundingClientRect();
        const sTop = sRect.top - paneRect.top;
        const sBottom = sTop + sRect.height;
        sectionInView = sTop < this.pane.clientHeight && sBottom > 0;
      }
    }

    if (inView) {
      h.classList.add("active");
    } else {
      h.classList.remove("active");
    }

    if (this.spotlight && section && sectionInView) {
      // Add .active to the nearest wrapper <section>. In coursebook mode this
      // is the H2 subsection inside the chapter; in standalone mode it is the
      // wrapper section created by _wrapAtHeadings.
      section.classList.add("active");
    }
  }

  _highlight(idx) {
    this.setCurrent(idx);
    this.syncVisual();
  }

  navigateTo(idx, { syncVisual = true, instant = false } = {}) {
    if (idx < 0 || idx >= this.headings.length) return;
    this.setCurrent(idx);
    if (syncVisual) this.syncVisual();
    const heading = this.headings[idx];
    let behavior = instant ? "auto" : "smooth";
    // Very long smooth scrolls read as a hang; jump instead.
    if (behavior === "smooth" && this.pane) {
      const paneTop = this.pane.getBoundingClientRect().top;
      const distance = Math.abs(heading.getBoundingClientRect().top - paneTop);
      if (distance > SectionNavigator.LONG_SCROLL_DISTANCE) behavior = "auto";
    }
    if (this.scrollToEl) {
      this.scrollToEl(heading, { instant: behavior === "auto" });
    } else {
      heading.scrollIntoView({ behavior, block: "start" });
    }
  }

  next(opts) {
    this.navigateTo(this.currentIdx + 1, opts);
  }

  prev(opts) {
    this.navigateTo(this.currentIdx - 1, opts);
  }

  first(opts) {
    this.navigateTo(0, opts);
  }

  last(opts) {
    this.navigateTo(this.headings.length - 1, opts);
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

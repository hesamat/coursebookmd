/**
 * SectionNavigator
 * Manages heading-based navigation over a rendered document.
 * Wraps content into <section> elements at h2 boundaries and provides
 * waypoint navigation with spotlight dimming.
 */
export class SectionNavigator {
  /**
   * @param {HTMLElement} contentEl - The container holding rendered HTML.
   */
  constructor(contentEl) {
    this.contentEl = contentEl;
    this.headings = [];
    this.currentIdx = 0;
    this.spotlight = true;
    this.onNavigate = null;
  }

  /**
   * Wrap top-level children into <section> elements at h2 boundaries.
   * Must be called after content is rendered but before setupNavigation.
   */
  wrapSections() {
    const children = Array.from(this.contentEl.childNodes);
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
      this.contentEl.appendChild(s);
    }
  }

  /**
   * Set up navigation. Only h1 and h2 are waypoints.
   */
  setup() {
    this.wrapSections();
    this.headings = Array.from(this.contentEl.querySelectorAll("h1, h2"));
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
      .querySelectorAll("section.active")
      .forEach((s) => s.classList.remove("active"));
  }

  /**
   * Clear all navigation highlights. Called when exiting presentation mode.
   */
  clearHighlight() {
    this._clearHighlight();
  }

  _highlight(idx) {
    if (idx < 0 || idx >= this.headings.length) return;
    this.currentIdx = idx;
    this._clearHighlight();
    const h = this.headings[idx];
    h.classList.add("current");
    if (this.spotlight) {
      const section = h.closest("section");
      if (section) section.classList.add("active");
    }
    if (this.onNavigate) this.onNavigate(idx, h);
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
    this._highlight(this.currentIdx);
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

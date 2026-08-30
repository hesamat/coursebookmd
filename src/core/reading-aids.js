/**
 * Per-H2 "go up" reading aids shared by the live app and the HTML export:
 * a "go up" link after each H2 that scrolls back to the chapter top.
 *
 * The aids are button elements only — never headings, never <section> — so
 * they cannot leak into scroll-spy heading sets, navigator waypoints, or
 * extractTocItems, and they don't trip _wrapAtHeadings' ":scope > section"
 * already-wrapped guard.
 */

/**
 * Insert a "go up" link as the next sibling of every H2 in the section.
 * The link must not be a child of the heading: heading textContent is read
 * verbatim by the navigator, TOC, and overlay. Idempotent.
 *
 * @param {HTMLElement} section
 */
export function addGoUpLinks(section) {
  for (const h2 of section.querySelectorAll("h2")) {
    if (h2.nextElementSibling?.classList.contains("go-up-link")) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "go-up-link";
    btn.setAttribute("aria-label", "Back to chapter top");
    btn.textContent = "▲";
    h2.insertAdjacentElement("afterend", btn);
  }
}

/**
 * Add the reading aids to a section. Safe to call repeatedly.
 * @param {HTMLElement} section
 */
export function addReadingAids(section) {
  addGoUpLinks(section);
}

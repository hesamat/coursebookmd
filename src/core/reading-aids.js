/**
 * In-content reading aids shared by the live app and the HTML export:
 *  - an "In this Chapter" box at the top of each chapter listing its H2s
 *  - a "go up" link after each H2 that scrolls back to the chapter top
 *
 * Must run after heading ids and .heading-number spans are final. The aids
 * are nav/button elements only — never headings, never <section> — so they
 * cannot leak into scroll-spy heading sets, navigator waypoints, or
 * extractTocItems, and they don't trip _wrapAtHeadings' ":scope > section"
 * already-wrapped guard.
 */

import { extractTocItems } from "./toc-data.js";

/**
 * Build (or rebuild) the "In this Chapter" box as the section's first child.
 * Remove-and-recreate, so repeated calls always reflect the current numbers
 * and heading ids. Skipped entirely when the section has no H2s.
 *
 * @param {HTMLElement} section
 * @returns {HTMLElement | null} The box, or null when nothing was created.
 */
export function addInChapterToc(section) {
  section.querySelector(".in-chapter-toc")?.remove();

  const items = extractTocItems(section).filter((item) => item.level === "h2");
  if (items.length === 0) return null;

  const box = document.createElement("nav");
  box.className = "in-chapter-toc no-math";
  box.setAttribute("aria-label", "In this chapter");

  const title = document.createElement("div");
  title.className = "in-chapter-toc__title";
  title.textContent = "In this Chapter";
  box.appendChild(title);

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "in-chapter-toc__item";
    btn.setAttribute("data-target", item.id);
    if (item.number) {
      const num = document.createElement("span");
      num.className = "in-chapter-toc__number";
      num.textContent = item.number;
      btn.appendChild(num);
      btn.appendChild(document.createTextNode(" " + item.text));
    } else {
      btn.appendChild(document.createTextNode(item.text));
    }
    box.appendChild(btn);
  }

  section.insertBefore(box, section.firstChild);
  return box;
}

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
 * Add both reading aids to a section. Safe to call repeatedly.
 * @param {HTMLElement} section
 */
export function addReadingAids(section) {
  addInChapterToc(section);
  addGoUpLinks(section);
}

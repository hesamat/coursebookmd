/**
 * Section numbering utility.
 *
 * Assigns hierarchical numbers to headings (h1, h2, h3):
 *   h1 → "1", "2", ...
 *   h2 → "1.1", "1.2", "2.1", ...
 *   h3 → "1.1.1", "1.1.2", ...
 *
 * Used by both the rendered content and the TOC so numbers stay in sync.
 */

/**
 * Apply (or replace) a section number span on a heading element.
 * Removes any existing `.heading-number` span first, then prepends a new
 * one if `num` is non-empty.
 *
 * @param {HTMLElement} heading
 * @param {string} num - Section number string (e.g. "1.2"), or "" to clear.
 */
export function applyHeadingNumber(heading, num) {
  const existing = heading.querySelector(".heading-number");
  if (existing) existing.remove();

  if (num) {
    const numSpan = document.createElement("span");
    numSpan.className = "heading-number";
    numSpan.textContent = num + " ";
    heading.insertBefore(numSpan, heading.firstChild);
  }
}

/**
 * Extract h1/h2/h3 headings from raw Markdown.
 * Ignores lines inside code fences and strips inline HTML from titles.
 *
 * @param {string} markdown
 * @returns {Array<{level: number, title: string, tagName: string}>}
 */
export function extractHeadingsFromMarkdown(markdown) {
  const headings = [];
  const lines = markdown.split("\n");
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const match = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      const title = match[2].trim().replace(/<[^>]+>/g, "");
      const level = match[1].length;
      headings.push({
        level,
        title,
        tagName: `H${level}`,
      });
    }
  }

  return headings;
}

/**
 * Determine the heading level from an Element or a plain heading info object.
 * @param {Element | {tagName?: string, level?: number}} heading
 * @returns {number}
 */
function getHeadingLevel(heading) {
  if (heading.tagName) {
    const level = parseInt(heading.tagName.slice(1), 10) - 1;
    if (!isNaN(level)) return level;
  }
  if (typeof heading.level === "number") return heading.level - 1;
  return -1;
}

/**
 * Compute section numbers for a list of heading elements.
 * @param {Element[] | {tagName?: string, level?: number}[]} headings - Array of h1/h2/h3 items in document order.
 * @returns {string[]} - Array of number strings, same length as input.
 */
export function computeSectionNumbers(headings) {
  const counters = [0, 0, 0]; // h1, h2, h3
  const numbers = [];

  for (const heading of headings) {
    const level = getHeadingLevel(heading);
    if (level < 0 || level > 2) {
      numbers.push("");
      continue;
    }

    // Increment current level
    counters[level]++;

    // Reset deeper levels
    for (let i = level + 1; i < counters.length; i++) {
      counters[i] = 0;
    }

    // Build number string from all levels up to current
    const parts = [];
    for (let i = 0; i <= level; i++) {
      parts.push(counters[i]);
    }
    numbers.push(parts.join("."));
  }

  return numbers;
}

/**
 * Compute section numbers across multiple sections, continuing numbering from
 * one section to the next. The first section (e.g. the parent coursebook landing
 * page) is left un-numbered and does not affect the counters, so chapter 1
 * starts with "1".
 *
 * By default the first section is only skipped when there are multiple sections
 * (coursebook mode). When `skipFirst` is true, the first section is always
 * skipped regardless of section count — this ensures a zero-chapter coursebook
 * (landing page only) does not get numbered, preserving the landing-unnumbered
 * invariant.
 *
 * @param {Array<Array<Element | {tagName?: string, level?: number}>>} sections
 * @param {{skipFirst?: boolean, skipIndexes?: number[]}} [opts]
 * @returns {string[][]} - Number strings grouped by section.
 */
export function computeSectionNumbersForSections(sections, opts) {
  const skipFirst = opts?.skipFirst ?? false;
  const skipSet = new Set(opts?.skipIndexes ?? []);
  const all = [];
  const sectionOffsets = [];
  const skipFlags = [];
  let offset = 0;

  // Skip the first section (landing/cover) when:
  // - there are multiple sections (coursebook mode), or
  // - skipFirst is explicitly requested (zero-chapter coursebook guard)
  const skipLanding = sections.length > 1 || skipFirst;

  for (let s = 0; s < sections.length; s++) {
    sectionOffsets.push(offset);
    const skipSection = (skipLanding && s === 0) || skipSet.has(s);
    for (const h of sections[s]) {
      all.push(h);
      skipFlags.push(skipSection);
    }
    offset += sections[s].length;
  }

  const toNumber = all.filter((_, i) => !skipFlags[i]);
  const numbered = computeSectionNumbers(toNumber);

  const allNumbers = [];
  let numberedIndex = 0;
  for (let i = 0; i < all.length; i++) {
    allNumbers.push(skipFlags[i] ? "" : numbered[numberedIndex++]);
  }

  const bySection = [];
  for (let i = 0; i < sections.length; i++) {
    bySection.push(
      allNumbers.slice(sectionOffsets[i], sectionOffsets[i] + sections[i].length),
    );
  }
  return bySection;
}

/**
 * Section indexes to skip for a coursebook whose chapters may include extras
 * (appended non-bullet companions, marked `isExtra` by the loader). Section 0
 * is the landing page, so each extra chapter's section index is its chapter
 * index plus one.
 *
 * @param {Array<{isExtra?: boolean}> | undefined} chapters
 * @returns {number[]}
 */
export function extraSkipIndexes(chapters) {
  const indexes = [];
  for (let i = 0; i < (chapters?.length ?? 0); i++) {
    if (chapters[i].isExtra) indexes.push(i + 1);
  }
  return indexes;
}

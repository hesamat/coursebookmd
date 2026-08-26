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
 * @param {Array<Array<Element | {tagName?: string, level?: number}>>} sections
 * @returns {string[][]} - Number strings grouped by section.
 */
export function computeSectionNumbersForSections(sections) {
  const all = [];
  const sectionOffsets = [];
  let offset = 0;

  for (const section of sections) {
    sectionOffsets.push(offset);
    for (const h of section) {
      all.push(h);
    }
    offset += section.length;
  }

  // If there is more than one section, treat the first one as an unnumbered
  // landing/cover section and start numbering with the first heading of the
  // second section.
  const skipCount = sections.length > 1 ? sections[0].length : 0;
  const toNumber = all.slice(skipCount);
  const numbered = computeSectionNumbers(toNumber);

  const allNumbers = [];
  for (let i = 0; i < all.length; i++) {
    allNumbers.push(i < skipCount ? "" : numbered[i - skipCount]);
  }

  const bySection = [];
  for (let i = 0; i < sections.length; i++) {
    bySection.push(
      allNumbers.slice(sectionOffsets[i], sectionOffsets[i] + sections[i].length),
    );
  }
  return bySection;
}

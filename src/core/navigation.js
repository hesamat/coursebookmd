/**
 * Shared navigation utilities used by both the live app and the exported HTML.
 *
 * Hash format: #chapter-slug or #chapter-slug/heading-slug
 * Both the app and export use this format so URLs are meaningful and
 * shareable, and the parsing logic is identical.
 */

/**
 * Parse a location hash into its chapter and heading components.
 * @param {string} hash - The hash without the leading "#"
 * @returns {{ chapterSlug: string, headingSlug: string | null }}
 */
export function parseLocationHash(hash) {
  if (!hash) return { chapterSlug: "", headingSlug: null };
  const [chapterSlug, headingSlug] = hash.split("/");
  return { chapterSlug, headingSlug: headingSlug || null };
}

/**
 * Format a location hash from chapter and heading slugs.
 * @param {string} chapterSlug
 * @param {string} [headingSlug]
 * @returns {string} The hash including the leading "#"
 */
export function formatLocationHash(chapterSlug, headingSlug) {
  return headingSlug ? `#${chapterSlug}/${headingSlug}` : `#${chapterSlug}`;
}

/**
 * Navigate to a target element: scroll it into view and flash it.
 * Updates the URL hash with the chapter + heading slugs.
 *
 * This function is designed to be injectable via `.toString()` into the
 * exported HTML script, so it must not reference any external scope.
 *
 * @param {HTMLElement} target - The element to scroll to
 * @param {string} chapterSlug - The chapter slug for the hash
 * @param {string} [headingSlug] - The heading slug for the hash
 * @param {Function} [flashFn] - Optional flash function (e.g. flashHeading)
 */
export function navigateToTarget(target, chapterSlug, headingSlug, flashFn) {
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  if (flashFn) flashFn(target);
  const hash = formatLocationHash(chapterSlug, headingSlug);
  if (location.hash !== hash) {
    history.replaceState(null, "", hash);
  }
}

/**
 * Find a heading element within a section by its slug.
 * @param {HTMLElement|Document} root - The section element or document to search
 * @param {string} headingSlug - The heading's id
 * @returns {HTMLElement | null}
 */
export function findHeadingInSection(root, headingSlug) {
  if (!headingSlug) return null;
  return root.querySelector(`#${CSS.escape(headingSlug)}`);
}

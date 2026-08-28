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

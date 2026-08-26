/**
 * Shared utility functions.
 */

/**
 * Convert heading text into a URL-safe id slug.
 * Used for anchor navigation and scroll targets.
 *
 * @param {string} text
 * @returns {string}
 */
export function slugifyForId(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normalize a code language name to a Prism-supported language.
 * @param {string} lang
 * @returns {string}
 */
export function normalizeCodeLanguage(lang) {
  if (!lang) return "none";
  const lower = lang.toLowerCase();
  const aliases = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    sh: "bash",
    shell: "bash",
    yml: "yaml",
    "c++": "cpp",
    "c#": "csharp",
    cs: "csharp",
    rb: "ruby",
    golang: "go",
    kt: "kotlin",
    rs: "rust",
  };
  return aliases[lower] || lower;
}

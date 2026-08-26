/**
 * Shared utility functions.
 */

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

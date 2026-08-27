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

/**
 * Resolve relative <img src> paths inside a rendered section against the
 * chapter's own URL. This makes `../assets/<file>` references in chapter
 * markdown load from the course's asset folder when the app is running from
 * a different URL (e.g. the root page with `?coursebook=...`).
 *
 * @param {HTMLElement} root - The section container to process.
 * @param {string} [chapterResolvedPath] - The resolved path of the chapter file.
 */
export function resolveContentImages(root, chapterResolvedPath) {
  if (!chapterResolvedPath) return;

  // Make the chapter path absolute from the origin so relative image paths
  // resolve against it, not the current page URL.
  const basePath = chapterResolvedPath.startsWith("/")
    ? chapterResolvedPath
    : "/" + chapterResolvedPath;
  let baseUrl;
  try {
    baseUrl = new URL(basePath, location.href).href;
  } catch {
    return;
  }

  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (
      !src ||
      src.startsWith("/") ||
      /^https?:/i.test(src) ||
      src.startsWith("data:") ||
      src.startsWith("blob:")
    ) {
      continue;
    }
    try {
      const resolved = new URL(src, baseUrl);
      img.src = resolved.pathname;
    } catch {
      // leave as-is if the URL cannot be resolved
    }
  }
}

/**
 * Shared utility functions.
 */

let headingCounter = 0;

/**
 * Detect macOS from the browser, checking userAgentData, platform, and the
 * user-agent string in turn.
 * @returns {boolean}
 */
export function isMac() {
  const nav = navigator;
  if (nav.userAgentData?.platform) {
    return /mac/i.test(nav.userAgentData.platform);
  }
  if (typeof nav.platform === "string" && /mac/i.test(nav.platform)) {
    return true;
  }
  return /macintosh|mac os x|macos/i.test(nav.userAgent);
}

export const isMacPlatform = isMac();

/**
 * Whether a keyboard event uses the app's modifier shortcut:
 * macOS: Command+Control (⌘+⌃); Windows/Linux: Ctrl+Alt.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
export function isShortcut(e) {
  if (isMacPlatform) {
    // macOS: Command+Control (⌘+⌃)
    return e.metaKey && e.ctrlKey && !e.altKey && !e.shiftKey;
  }
  // Windows/Linux: Ctrl+Alt
  return e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey;
}

/**
 * Convert heading text into a URL-safe id slug.
 * Used for anchor navigation and scroll targets.
 *
 * @param {string} text
 * @returns {string}
 */
export function slugifyForId(text) {
  let slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    headingCounter += 1;
    slug = `heading-${headingCounter}`;
  }
  return slug;
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

const URL_LIKE = /^[a-z][a-z0-9+.-]*:/i;

function getBaseDir(path) {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function resolvePath(link, baseDir) {
  if (!link || URL_LIKE.test(link) || link.startsWith("/") || link.startsWith("#")) {
    return null;
  }
  // Malformed URLs (e.g. ":invalid") are not valid relative paths either.
  if (link.includes(":") && !URL_LIKE.test(link)) {
    return null;
  }
  const baseParts = baseDir ? baseDir.split("/") : [];
  const parts = [...baseParts];
  for (const part of link.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length ? parts.join("/") : null;
}

/**
 * Resolve relative `img src` and `a href` paths in a DOM container against
 * the source .md file that produced the content.
 *
 * @param {HTMLElement} container
 * @param {string} sourceResolvedPath - Resolved path of the source .md file.
 */
export function resolveContentRefs(container, sourceResolvedPath) {
  if (!sourceResolvedPath) {
    console.warn("resolveContentRefs called with empty source path; no-op.");
    return;
  }
  const baseDir = getBaseDir(sourceResolvedPath);
  for (const img of container.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    const resolved = resolvePath(src, baseDir);
    if (resolved && resolved !== src) img.setAttribute("src", resolved);
  }
  for (const a of container.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") || "";
    const hashIndex = href.indexOf("#");
    const link = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
    const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
    if (!link) continue;
    const resolved = resolvePath(link, baseDir);
    if (resolved && resolved !== link) {
      a.setAttribute("href", resolved + hash);
    }
  }
}

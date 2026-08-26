/**
 * CoursebookLoader
 *
 * Loads a coursebook from a parent `coursebook.md` file. The parent file is a
 * normal Markdown document whose chapter list is a bullet list of Markdown
 * links to chapter files:
 *
 *   - [Getting Started](chapters/01-getting-started.md)
 *   - [Writing Content](chapters/02-writing-content.md)
 *
 * The loader extracts the course title (first H1), the chapter list (link
 * text + path), and can fetch individual chapter files.
 */

/**
 * @typedef {Object} Chapter
 * @property {string} title - The link text from the parent file.
 * @property {string} path - The chapter file path, relative to the parent.
 * @property {string} resolvedPath - The chapter file path, relative to the web root.
 */

/**
 * @typedef {Object} Coursebook
 * @property {string} title - The course title (first H1 in the parent).
 * @property {string} markdown - The full parent markdown content.
 * @property {Chapter[]} chapters - Ordered list of chapters.
 */

/**
 * Parse the parent coursebook markdown to extract the title and chapter list.
 * @param {string} markdown - The raw markdown content of the parent file.
 * @param {string} [parentPath="coursebook.md"] - Path used to fetch the parent file, used to resolve chapter paths.
 * @returns {Coursebook}
 */
export function parseCoursebook(markdown, parentPath = "coursebook.md") {
  // Directory containing the parent file (e.g., "docs" for "docs/coursebook.md")
  const baseDir = parentPath.includes("/")
    ? parentPath.slice(0, parentPath.lastIndexOf("/"))
    : "";

  // Extract title from the first H1
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "Coursebook";

  // Extract chapter links from bullet lists.
  // Matches: - [Chapter Title](path/to/chapter.md)
  // Also matches numbered lists: 1. [Chapter Title](path)
  const linkRegex = /^\s*(?:[-*+]|\d+\.)\s+\[([^\]]+)\]\(([^)]+\.md)\)/gm;
  const chapters = [];
  let match;

  while ((match = linkRegex.exec(markdown)) !== null) {
    const path = match[2].trim();
    // Reject absolute paths, parent directory references, and URLs
    if (path.startsWith("/") || path.includes("..") || /^https?:/.test(path)) {
      continue;
    }
    // Resolve the chapter path relative to the parent file's directory
    const resolvedPath = baseDir ? `${baseDir}/${path}` : path;
    chapters.push({
      title: match[1].trim(),
      path,
      resolvedPath,
    });
  }

  return { title, markdown, chapters };
}

/**
 * Fetch the parent coursebook.md and parse it.
 * @param {string} [parentPath="docs/coursebook.md"] - Path to the parent file.
 * @returns {Promise<Coursebook>}
 */
export async function loadCoursebook(parentPath = "docs/coursebook.md") {
  const res = await fetch(parentPath);
  if (!res.ok) {
    throw new Error(`Failed to load coursebook: ${res.status} ${res.statusText}`);
  }
  const markdown = await res.text();
  return parseCoursebook(markdown, parentPath);
}

/**
 * Fetch a chapter file and return its markdown content.
 * @param {string} chapterPath - Path to the chapter file, relative to the coursebook root.
 * @returns {Promise<string>}
 */
export async function loadChapter(chapterPath) {
  const res = await fetch(chapterPath);
  if (!res.ok) {
    throw new Error(`Failed to load chapter: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Extract the chapter title from its markdown (first H1).
 * Falls back to the filename if no H1 is found.
 * @param {string} markdown - The chapter markdown content.
 * @param {string} [fallback] - Fallback title if no H1 is found.
 * @returns {string}
 */
export function getChapterTitle(markdown, fallback = "Untitled") {
  if (!markdown) return fallback;
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

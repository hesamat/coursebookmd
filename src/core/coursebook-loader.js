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
 * @typedef {Object} NavEntry
 * @property {"group"|"chapter"} type - "group" is an unnumbered label
 *   (e.g. a "Week 1" heading in the parent), "chapter" is a chapter item.
 * @property {string} [title] - For "group" entries: the label text.
 * @property {number} [index] - For "chapter" entries: index into `chapters`.
 */

/**
 * @typedef {Object} Coursebook
 * @property {string} title - The course title (first H1 in the parent).
 * @property {string} markdown - The full parent markdown content.
 * @property {Chapter[]} chapters - Ordered list of chapters.
 * @property {NavEntry[]} nav - Ordered navigation structure. Headings in the
 *   parent that are directly followed by chapter links become unnumbered
 *   group labels; each chapter is listed after its group. When there are no
 *   group headings this is just [{ type: "chapter", index: 0 }, ...].
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

  // Chapter links from bullet lists.
  // Matches: - [Chapter Title](path/to/chapter.md)
  // Also matches numbered lists: 1. [Chapter Title](path)
  const linkRegex = /^\s*(?:[-*+]|\d+\.)\s+\[([^\]]+)\]\(([^)]+\.md)\)/;
  const chapters = [];
  const nav = [];

  // Headings that simply introduce the chapter list are not group labels.
  const BOILERPLATE = /^(chapters|contents|table of contents|toc)$/i;

  let currentGroupTitle = null;
  let groupEmitted = true;
  let inCodeFence = false;

  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    // Track the most recent H2/H3 heading — it becomes a group label when
    // chapter links follow it. H1 is the course title, never a group.
    const headingMatch = trimmed.match(/^(#{2,3})\s+(.+)$/);
    if (headingMatch) {
      const headingTitle = headingMatch[2].trim();
      if (BOILERPLATE.test(headingTitle)) {
        currentGroupTitle = null;
        groupEmitted = true;
      } else {
        currentGroupTitle = headingTitle;
        groupEmitted = false;
      }
      continue;
    }

    const match = trimmed.match(linkRegex);
    if (!match) continue;

    const path = match[2].trim();
    // Reject absolute paths, parent directory references, and URLs
    if (path.startsWith("/") || path.includes("..") || /^https?:/.test(path)) {
      continue;
    }
    // Resolve the chapter path relative to the parent file's directory
    const resolvedPath = baseDir ? `${baseDir}/${path}` : path;
    const chapterIndex = chapters.length;
    chapters.push({
      title: match[1].trim(),
      path,
      resolvedPath,
    });

    // Emit the group label (once) before its first chapter
    if (currentGroupTitle && !groupEmitted) {
      nav.push({ type: "group", title: currentGroupTitle });
      groupEmitted = true;
    }
    nav.push({ type: "chapter", index: chapterIndex });
  }

  return { title, markdown, chapters, nav };
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

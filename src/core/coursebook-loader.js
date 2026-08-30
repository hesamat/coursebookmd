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
import { slugifyForId } from "./utils.js";

/**
 * @typedef {Object} Chapter
 * @property {string} title - The link text from the parent file.
 * @property {string} path - The chapter file path, relative to the parent.
 * @property {string} resolvedPath - The chapter file path, relative to the web root.
 * @property {string} [slug] - Document-wide unique URL-safe section id,
 *   assigned by assignChapterSlugs after loading or retitling.
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

  return { title, markdown, parentPath, chapters, nav };
}

export function getBaseDir(path) {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/** Ids reserved by the app shell (landing page and generated index section). */
const RESERVED_SECTION_SLUGS = new Set(["overview", "index"]);

/**
 * The section id a chapter renders under: its assigned unique slug, or the
 * title slug as a fallback for coursebooks that predate slug assignment.
 * @param {Chapter} chapter
 * @returns {string}
 */
export function chapterSectionSlug(chapter) {
  return chapter.slug || slugifyForId(chapter.title);
}

/**
 * Assign every chapter a document-wide unique URL-safe slug derived from its
 * title, so duplicated titles never produce duplicate section ids (which
 * would break sidebar, hash, and index navigation). Reserved shell ids are
 * excluded. Called after loading and after in-place retitles.
 * @param {Chapter[]} chapters - Mutated in place.
 */
export function assignChapterSlugs(chapters) {
  const used = new Set(RESERVED_SECTION_SLUGS);
  for (const chapter of chapters) {
    const base = slugifyForId(chapter.title) || "chapter";
    let slug = base;
    let suffix = 1;
    while (used.has(slug)) {
      slug = `${base}-${suffix++}`;
    }
    used.add(slug);
    chapter.slug = slug;
  }
}

/**
 * Build a map from chapter file paths (both `path` and `resolvedPath`) to
 * their URL-safe slugs. Used when rewriting .md chapter links to anchors.
 * @param {Coursebook} coursebook
 * @returns {Map<string, string>}
 */
export function buildChapterSlugMap(coursebook) {
  const pathToSlug = new Map();
  for (const chapter of coursebook.chapters) {
    const slug = chapterSectionSlug(chapter);
    if (chapter.path) pathToSlug.set(chapter.path, slug);
    if (chapter.resolvedPath && chapter.resolvedPath !== chapter.path) {
      pathToSlug.set(chapter.resolvedPath, slug);
    }
  }
  return pathToSlug;
}

function isWithinCoursebook(resolvedPath, coursebookRoot) {
  if (!coursebookRoot) return true;
  const rootParts = coursebookRoot.split("/").filter(Boolean);
  const parts = resolvedPath.split("/").filter(Boolean);
  return rootParts.every((part, i) => parts[i] === part);
}

export function resolveLink(linkPath, baseDir) {
  if (
    !linkPath ||
    linkPath.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(linkPath) ||
    linkPath.startsWith("//")
  ) {
    return null;
  }
  const link = linkPath.startsWith("/") ? linkPath.slice(1) : linkPath;
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

function extractMdLinks(markdown, baseDir, coursebookRoot) {
  const links = [];
  const seen = new Set();
  const lines = markdown.split("\n");
  let inCodeFence = false;
  const mdLinkPattern = /(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    let match;
    while ((match = mdLinkPattern.exec(line)) !== null) {
      const path = match[2];
      if (!path.toLowerCase().endsWith(".md")) continue;
      const resolvedPath = resolveLink(path, baseDir);
      if (!resolvedPath || !isWithinCoursebook(resolvedPath, coursebookRoot)) continue;
      if (seen.has(resolvedPath)) continue;
      seen.add(resolvedPath);
      const title = match[1].trim() || resolvedPath;
      links.push({ title, path, resolvedPath });
    }
  }
  return links;
}

/**
 * Fetch the parent coursebook.md and parse it, then discover and load every
 * .md file linked from the parent or from any loaded section.
 *
 * Bullet-list chapters in the parent are kept in their parent order. All
 * other discovered .md files (parent non-bullet links and links inside
 * sections) are appended afterwards and appear under a "Supplements" group.
 *
 * @param {string} [parentPath="docs/coursebook.md"] - Path to the parent file.
 * @param {string} [parentMarkdown] - Pre-loaded parent markdown (for local files).
 * @param {(resolvedPath: string, sourcePath: string) => Promise<string>} [loadFile] - Custom loader.
 * @returns {Promise<Coursebook>}
 */
export async function loadCoursebook(
  parentPath = "docs/coursebook.md",
  parentMarkdown,
  loadFile = loadChapter,
) {
  const parentBaseDir = getBaseDir(parentPath);
  const coursebookRoot = parentBaseDir;

  if (parentMarkdown === undefined) {
    try {
      parentMarkdown = await loadFile(parentPath);
    } catch (err) {
      throw new Error(`Failed to load coursebook: ${err.message || err}`);
    }
  }
  const parentInfo = parseCoursebook(parentMarkdown, parentPath);

  // Normalize parent chapter resolved paths so they match the normalized paths
  // produced by extractMdLinks.
  for (const chapter of parentInfo.chapters) {
    const resolved = resolveLink(chapter.path, parentBaseDir);
    if (resolved && isWithinCoursebook(resolved, coursebookRoot)) {
      chapter.resolvedPath = resolved;
    }
  }

  /** @type {Chapter[]} */
  const chapters = [];

  /** @type {NavEntry[]} */
  const nav = [...parentInfo.nav];

  /** @type {Map<string, number>} */
  const loaded = new Map();

  /** @type {Set<string>} */
  const discovered = new Set();

  /** @type {{ title: string; path: string; resolvedPath: string; depth: number }[]} */
  const queue = [];

  for (const chapter of parentInfo.chapters) {
    if (discovered.has(chapter.resolvedPath)) continue;
    discovered.add(chapter.resolvedPath);
    queue.push({
      title: chapter.title,
      path: chapter.path,
      resolvedPath: chapter.resolvedPath,
      depth: 1,
    });
  }

  const parentLinks = extractMdLinks(parentMarkdown, parentBaseDir, coursebookRoot);
  for (const link of parentLinks) {
    if (discovered.has(link.resolvedPath)) continue;
    discovered.add(link.resolvedPath);
    queue.push({ ...link, depth: 1 });
  }

  const MAX_DEPTH = 5;
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const link = queue[queueIndex++];
    if (loaded.has(link.resolvedPath)) continue;
    let markdown;
    try {
      markdown = await loadFile(link.resolvedPath, link.path);
    } catch (err) {
      console.warn(`Failed to load coursebook section ${link.resolvedPath}:`, err);
      // Failed loads still create a placeholder section so the navigation
      // stays in sync with the discovery order.
      markdown = undefined;
    }
    const index = chapters.length;
    chapters.push({
      title: getChapterTitle(markdown, link.title),
      path: link.path,
      resolvedPath: link.resolvedPath,
      markdown,
    });
    loaded.set(link.resolvedPath, index);

    if (link.depth >= MAX_DEPTH) continue;

    const baseDir = getBaseDir(link.resolvedPath);
    const childLinks = extractMdLinks(markdown, baseDir, coursebookRoot);
    for (const child of childLinks) {
      if (loaded.has(child.resolvedPath) || discovered.has(child.resolvedPath)) {
        continue;
      }
      discovered.add(child.resolvedPath);
      queue.push({ ...child, depth: link.depth + 1 });
    }
  }

  const bulletCount = parentInfo.chapters.length;
  const hasSupplement = chapters
    .slice(bulletCount)
    .some((chapter) => chapter.markdown !== undefined);
  if (hasSupplement) {
    nav.push({ type: "group", title: "Supplements" });
    for (let i = bulletCount; i < chapters.length; i++) {
      if (chapters[i].markdown !== undefined) {
        nav.push({ type: "chapter", index: i });
      }
    }
  }

  assignChapterSlugs(chapters);
  return { ...parentInfo, parentPath, chapters, nav };
}

/**
 * Fetch a chapter file and return its markdown content.
 * @param {string} chapterPath - Path to the chapter file, relative to the coursebook root.
 * @param {string} [sourcePath] - Original source path (ignored by the default loader).
 * @returns {Promise<string>}
 */
export async function loadChapter(chapterPath, _sourcePath) {
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

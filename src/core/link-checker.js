/**
 * Link validation for coursebook content.
 *
 * Pure module: no DOM access. Classification mirrors the loader/renderer
 * machinery so validation can never disagree with rewriting:
 *
 * - `.md` links are resolved with the loader's resolveLink and checked
 *   against the known chapter path set (same normalized forms that
 *   rewriteChapterLinks matches against).
 * - Other relative targets are checked with the `exists` callback, first
 *   resolved against the source file's directory, then (like
 *   resolveLocalImages) as a bare path at the coursebook root.
 * - `#hash` links are checked against the set of heading ids that the
 *   renderer actually mints.
 *
 * External URLs (scheme:, //) and root-absolute paths (/...) are skipped,
 * matching resolvePath/resolveLocalImages, which silently ignore them.
 */

import { getBaseDir, resolveLink } from "./coursebook-loader.js";

const MD_LINK_PATTERN = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g;
const URL_LIKE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Extract markdown links and images from raw markdown, skipping code fences
 * exactly like extractMdLinks in coursebook-loader.js (same fence markers,
 * same toggle behavior, no inline-code skipping).
 *
 * @param {string} markdown
 * @returns {Array<{target: string, isImage: boolean, line: number}>}
 */
export function extractAllMdLinks(markdown) {
  const links = [];
  const lines = markdown.split("\n");
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    MD_LINK_PATTERN.lastIndex = 0;
    let match;
    while ((match = MD_LINK_PATTERN.exec(lines[i])) !== null) {
      links.push({
        target: match[3],
        isImage: match[1] === "!",
        line: i + 1,
      });
    }
  }
  return links;
}

/**
 * Find broken internal links in one markdown document.
 *
 * @param {object} options
 * @param {string} options.markdown - Raw markdown of the source document.
 * @param {string} options.sourcePath - Path of the source .md file.
 * @param {Iterable<string>} options.knownChapterPaths - Normalized chapter
 *   paths (both `path` and `resolvedPath` forms, as used by
 *   rewriteChapterLinks).
 * @param {Set<string>} [options.headingSlugs] - Heading ids that exist in the
 *   rendered document (used for `#hash` validation).
 * @param {string} [options.coursebookRoot] - Coursebook root directory;
 *   .md links resolving outside it are skipped, matching the loader.
 * @param {(resolvedPath: string) => boolean | Promise<boolean>} [options.exists]
 *   - Async-capable existence check for non-markdown relative targets. When
 *   omitted, path checks are skipped.
 * @returns {Promise<Array<{kind: "chapter"|"path"|"hash", target: string, reason: string, line?: number}>>}
 */
export async function findBrokenLinks({
  markdown,
  sourcePath,
  knownChapterPaths,
  headingSlugs,
  coursebookRoot,
  exists,
}) {
  const issues = [];
  if (!markdown || !sourcePath) return issues;

  const baseDir = getBaseDir(sourcePath);
  const chapterPaths =
    knownChapterPaths instanceof Set ? knownChapterPaths : new Set(knownChapterPaths);

  for (const { target, line } of extractAllMdLinks(markdown)) {
    // Split off a #fragment; the file part is validated, the fragment is
    // not cross-checked against the target chapter's headings in v1.
    const hashIndex = target.indexOf("#");
    const linkPart = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
    const fragment = hashIndex >= 0 ? target.slice(hashIndex + 1) : "";

    if (!linkPart) {
      // Pure intra-document hash link.
      if (fragment && headingSlugs && !headingSlugs.has(fragment)) {
        issues.push({
          kind: "hash",
          target,
          reason: `No heading with id "#${fragment}"`,
          line,
        });
      }
      continue;
    }

    if (
      URL_LIKE.test(linkPart) ||
      linkPart.startsWith("//") ||
      linkPart.startsWith("/")
    ) {
      continue;
    }

    const resolved = resolveLink(linkPart, baseDir);
    if (!resolved) continue;

    const isChapterTarget =
      linkPart.toLowerCase().endsWith(".md") ||
      chapterPaths.has(linkPart) ||
      chapterPaths.has(resolved);

    if (isChapterTarget) {
      const withinRoot = !coursebookRoot || isWithinRoot(resolved, coursebookRoot);
      if (!withinRoot) continue;
      if (!chapterPaths.has(linkPart) && !chapterPaths.has(resolved)) {
        issues.push({
          kind: "chapter",
          target,
          reason: `No chapter file "${resolved}"`,
          line,
        });
      }
      continue;
    }

    if (!exists) continue;
    const found = await checkExists(exists, resolved);
    if (found) continue;
    // Mirrors resolveLocalImages: a bare path (no ./ or ../) that fails in
    // the chapter's directory is retried at the coursebook root.
    if (!linkPart.startsWith("./") && !linkPart.startsWith("../")) {
      const rootResolved = coursebookRoot
        ? `${coursebookRoot}/${linkPart}`
        : resolveLink(linkPart, "");
      if (rootResolved && rootResolved !== resolved) {
        const foundAtRoot = await checkExists(exists, rootResolved);
        if (foundAtRoot) continue;
      }
    }
    issues.push({
      kind: "path",
      target,
      reason: `File not found: ${resolved}`,
      line,
    });
  }

  return issues;
}

function isWithinRoot(resolvedPath, coursebookRoot) {
  const rootParts = coursebookRoot.split("/").filter(Boolean);
  const parts = resolvedPath.split("/").filter(Boolean);
  return rootParts.every((part, i) => parts[i] === part);
}

async function checkExists(exists, resolvedPath) {
  try {
    return Boolean(await exists(resolvedPath));
  } catch {
    return false;
  }
}

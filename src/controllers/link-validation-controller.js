/**
 * link-validation-controller.js — Link validation for coursebook and
 * standalone mode, composed by app.js via injected dependencies.
 * Controllers never import each other; cross-controller calls are routed
 * through deps.
 */
import { findBrokenLinks } from "../core/link-checker.js";
import { slugifyForId } from "../core/utils.js";

export function createLinkValidationController(deps) {
  const { state, readFileFromDirectory, getBaseDir, chapterSectionSlug, showToast } =
    deps;

  /**
   * Build a set of known chapter file paths (both path and resolvedPath)
   * for link validation.
   * @returns {Set<string>}
   */
  function buildKnownChapterPathSet() {
    const paths = new Set();
    if (state.coursebook) {
      for (const chapter of state.coursebook.chapters) {
        if (chapter.path) paths.add(chapter.path);
        if (chapter.resolvedPath) paths.add(chapter.resolvedPath);
      }
    }
    return paths;
  }

  /**
   * The set of heading ids that renderAllChapters mints, emulated from
   * sectionHeadings: section ids (overview + chapter slugs) are reserved
   * first, then headings are slugged in document order with the same
   * `-1` suffix dedup scheme.
   * @returns {Set<string>}
   */
  function buildHeadingSlugSet() {
    const used = new Set(["overview"]);
    if (state.coursebook) {
      for (const chapter of state.coursebook.chapters) {
        used.add(chapterSectionSlug(chapter));
      }
    }
    for (const headings of state.sectionHeadings) {
      for (const heading of headings) {
        const baseId = slugifyForId(heading.title);
        let id = baseId;
        let suffix = 1;
        while (used.has(id)) {
          id = `${baseId}-${suffix++}`;
        }
        used.add(id);
      }
    }
    return used;
  }

  /**
   * Existence check for a resolved relative path in the active file store.
   * Returns null when existence cannot be determined (no store), which
   * disables path checks in URL-loaded mode.
   * @param {string} relPath
   * @returns {Promise<boolean|null>}
   */
  async function localFileExists(relPath) {
    if (!state.localFileStore) return null;
    if (state.localFileStore.dirHandle) {
      try {
        await readFileFromDirectory(state.localFileStore.dirHandle, relPath, {
          quiet: true,
        });
        return true;
      } catch {
        return false;
      }
    }
    if (state.localFileStore.fileMap) {
      if (state.localFileStore.fileMap.has(relPath)) return true;
      if (state.localFileStore.fileMapLower?.has(relPath.toLowerCase())) return true;
      return false;
    }
    return null;
  }

  /**
   * Validate all loaded sections for broken internal links.
   * Path checks are skipped when no local file store is available
   * (URL-loaded coursebooks); chapter and #hash checks still run.
   * @returns {Promise<Array|null>} Issues, or null when not applicable.
   */
  async function validateCoursebookLinks() {
    if (!state.coursebook) return null;
    const exists = state.localFileStore ? localFileExists : undefined;

    const knownChapterPaths = buildKnownChapterPathSet();
    const headingSlugs = buildHeadingSlugSet();
    const coursebookRoot = getBaseDir(
      state.localFileStore?.parentPath ?? state.coursebook.parentPath,
    );

    const issues = [];
    const sections = [
      { path: state.localFileStore?.parentPath ?? state.coursebook.parentPath, idx: 0 },
    ];
    state.coursebook.chapters.forEach((chapter, i) => {
      sections.push({ path: chapter.resolvedPath || chapter.path, idx: i + 1 });
    });

    for (const { path, idx } of sections) {
      const markdown = state.sectionMarkdowns[idx];
      if (markdown === undefined || markdown === null) continue;
      const sectionIssues = await findBrokenLinks({
        markdown,
        sourcePath: path,
        knownChapterPaths,
        headingSlugs,
        coursebookRoot,
        exists,
      });
      for (const issue of sectionIssues) {
        issues.push({ ...issue, source: path });
      }
    }
    return issues;
  }

  function logLinkIssues(issues) {
    for (const issue of issues) {
      console.warn(
        `Broken link (${issue.kind}) in ${issue.source}:${issue.line ?? "?"} ` +
          `→ ${issue.target}: ${issue.reason}`,
      );
    }
  }

  /**
   * Run validation and surface a summary toast plus console details.
   * @param {Array|null} issues - Pre-computed issues, or null to validate now.
   */
  async function reportLinkIssues(issues) {
    if (issues === null || issues === undefined) issues = await validateCoursebookLinks();
    if (!issues || issues.length === 0) return;
    logLinkIssues(issues);
    showToast(
      `${issues.length} broken link${issues.length === 1 ? "" : "s"} found — ` +
        "details in the browser console.",
    );
  }

  return { validateCoursebookLinks, reportLinkIssues, logLinkIssues };
}

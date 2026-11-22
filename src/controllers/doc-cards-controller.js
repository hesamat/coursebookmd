/**
 * doc-cards-controller.js — loads a coursebook's doc-cards.md glossary and
 * owns the active doc card registry for it. The registry snapshot itself
 * lives in core/doc-cards.js; this controller reads the glossary in every
 * coursebook access mode, resolves entries against the glossary's context,
 * reports validation problems, and resets to the bundled pack when no
 * coursebook is open. Composed by app.js via injected dependencies.
 */
import { buildRegistry, setActiveDocCards } from "../core/doc-cards.js";
import {
  buildGlossaryRegistry,
  resolveGlossaryEntries,
  parseGlossary,
} from "../core/doc-cards-glossary.js";
import { getBaseDir } from "../core/coursebook-loader.js";
import { readFileFromDirectory } from "../core/fs.js";

const GLOSSARY_FILE_NAME = "doc-cards.md";

export function docCardsPathFor(parentPath) {
  if (!parentPath) return null;
  const baseDir = getBaseDir(parentPath);
  return baseDir ? `${baseDir}/${GLOSSARY_FILE_NAME}` : GLOSSARY_FILE_NAME;
}

/** Path comparison that tolerates "./" prefixes, trailing slashes, and
 *  case differences between the coursebook.md links and the filesystem. */
function normalizePathForCompare(path) {
  return (path ?? "").replace(/^\.\//, "").replace(/\/$/, "").toLowerCase();
}

/** The glossary chapter, when doc-cards.md is listed in coursebook.md. */
function glossaryChapterOf(coursebook) {
  const target = normalizePathForCompare(coursebook.docCardsPath);
  return (
    coursebook.chapters?.find(
      (chapter) =>
        normalizePathForCompare(chapter.resolvedPath || chapter.path) === target,
    ) ?? null
  );
}

export function createDocCardsController(deps) {
  const { state, showToast } = deps;

  /**
   * Read the glossary file in whichever access mode is active. Returns
   * `{ markdown }` when present, `{ missing: true }` when the file does not
   * exist (an expected state — pack-only coursebooks), or `{ error }` for
   * read failures that must be reported.
   */
  async function readGlossaryMarkdown(coursebook) {
    // When the glossary is a listed chapter, loadCoursebook already loaded
    // its markdown — reuse it rather than re-fetching (a transient fetch
    // failure must not discard a valid glossary).
    const glossaryChapter = glossaryChapterOf(coursebook);
    if (glossaryChapter?.markdown !== undefined) {
      return { markdown: glossaryChapter.markdown };
    }

    const docCardsPath = coursebook.docCardsPath;
    if (state.localFileStore?.dirHandle) {
      try {
        const { file } = await readFileFromDirectory(
          state.localFileStore.dirHandle,
          docCardsPath,
          { quiet: true },
        );
        return { markdown: await file.text() };
      } catch (error) {
        if (error?.code === "ENOENT" || error?.name === "NotFoundError") {
          return { missing: true };
        }
        return { error };
      }
    }

    if (state.localFileStore?.fileMap) {
      const file =
        state.localFileStore.fileMap.get(docCardsPath) ??
        state.localFileStore.fileMapLower?.get(docCardsPath.toLowerCase());
      if (!file) return { missing: true };
      try {
        return { markdown: await file.text() };
      } catch (error) {
        return { error };
      }
    }

    // URL-loaded coursebook: fetch the known sibling by name. A coursebook
    // host that serves its SPA shell for unknown paths would answer 200 with
    // the app's HTML — treat only an actual HTML document as missing, never
    // a glossary that legitimately starts with an HTML comment. Only a real
    // "not found" status means missing; 403/500 etc. are read errors.
    try {
      const res = await fetch(docCardsPath);
      if (res.status === 404 || res.status === 410) return { missing: true };
      if (!res.ok) {
        return { error: new Error(`HTTP ${res.status} for ${docCardsPath}`) };
      }
      const text = await res.text();
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("text/html") || /^\s*<!doctype html>/i.test(text)) {
        return { missing: true };
      }
      return { markdown: text };
    } catch (error) {
      return { error };
    }
  }

  /**
   * Load (or reload) doc cards for the open coursebook: read the glossary,
   * parse it, resolve entries, build the registry, and activate it. Always
   * leaves a valid registry active — a missing or broken glossary degrades
   * to the bundled Python pack with the problems recorded for report().
   * @returns {Promise<{registry: object, problems: {errors: string[], warnings: string[]}}>}
   */
  async function loadForCoursebook(coursebook) {
    coursebook.docCardsPath = docCardsPathFor(coursebook.parentPath);
    const result = await readGlossaryMarkdown(coursebook);
    const glossaryChapter = glossaryChapterOf(coursebook);
    const glossaryChapterSlug = glossaryChapter?.slug ?? null;
    let registry;
    let problems;

    if (result.missing) {
      registry = buildRegistry({ packs: ["python"] });
      problems = { errors: [], warnings: [] };
    } else if (result.error) {
      registry = buildRegistry({ packs: ["python"] });
      problems = {
        errors: [
          `doc-cards.md could not be read: ${result.error?.message ?? result.error}`,
        ],
        warnings: [],
      };
    } else {
      coursebook.docCardsRaw = result.markdown;
      const built = buildGlossaryRegistry({
        markdown: result.markdown,
        sourcePath: coursebook.docCardsPath,
        glossaryChapterSlug,
        baseDir: getBaseDir(coursebook.docCardsPath),
      });
      registry = built.registry;
      problems = built.problems;
    }

    setActiveDocCards(registry);
    coursebook.docCardsProblems = problems;
    return { registry, problems };
  }

  /**
   * Rebuild the registry from a (possibly just-edited) glossary text without
   * re-reading the file — the watcher and the in-app editor path. Keeping
   * the raw text on the coursebook lets the watcher's external-change
   * comparison see what was applied.
   */
  function applyGlossaryText(markdown) {
    const coursebook = state.coursebook;
    if (!coursebook?.docCardsPath) return { registry: null, problems: null };
    coursebook.docCardsRaw = markdown;
    const glossaryChapter = glossaryChapterOf(coursebook);
    const built = buildGlossaryRegistry({
      markdown,
      sourcePath: coursebook.docCardsPath,
      glossaryChapterSlug: glossaryChapter?.slug ?? null,
      baseDir: getBaseDir(coursebook.docCardsPath),
    });
    setActiveDocCards(built.registry);
    coursebook.docCardsProblems = built.problems;
    return { registry: built.registry, problems: built.problems };
  }

  /** Standalone mode: no coursebook, so only the bundled pack is active. */
  function resetToPack() {
    setActiveDocCards(buildRegistry({ packs: ["python"] }));
  }

  /**
   * Surface validation problems: every line lands in the console, and errors
   * — which block export — also get a toast. Warnings stay console-only.
   */
  function report() {
    const problems = state.coursebook?.docCardsProblems;
    if (!problems) return;
    for (const error of problems.errors) console.warn(`Doc cards error: ${error}`);
    for (const warning of problems.warnings)
      console.warn(`Doc cards warning: ${warning}`);
    if (problems.errors.length > 0) {
      showToast(
        `Doc cards: ${problems.errors.length} problem(s) found — details in the browser console.`,
      );
    }
  }

  return {
    docCardsPathFor,
    loadForCoursebook,
    applyGlossaryText,
    resetToPack,
    report,
    parseGlossary,
    resolveGlossaryEntries,
  };
}

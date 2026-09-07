/**
 * popup-helpers.js — Pure logic shared by the presentation popup window and
 * the opener-side present-window controller. No DOM access; imported by
 * popup-main.js, present-window-controller.js, and unit tests.
 */

export const PRESENT_READY_MESSAGE = "cbmd:present-ready";
export const PRESENT_DATA_MESSAGE = "cbmd:present-data";

/**
 * Build the metadata payload transferred from the opener to the popup.
 * `host` is the subset of app state the popup needs; `slugFor` resolves a
 * chapter's section id (chapterSectionSlug). Standalone mode (no coursebook)
 * yields `chapters: null`.
 */
export function buildPopupMetadata(host, slugFor) {
  if (!host.coursebook) {
    return { chapters: null, currentChapterIdx: -1 };
  }
  return {
    chapters: host.coursebook.chapters.map((chapter) => ({
      id: slugFor(chapter),
      title: chapter.title,
    })),
    currentChapterIdx: host.currentChapterIdx,
  };
}

/**
 * Section id that should carry `.active` for a chapter index
 * (-1 = landing page/overview).
 */
export function activeSectionIdFor(currentChapterIdx, chapters) {
  if (!chapters || currentChapterIdx === -1) return "overview";
  return chapters[currentChapterIdx]?.id ?? "overview";
}

/** Prev/next availability for the chapter nav, mirroring updateChapterNav. */
export function chapterNeighbors(currentChapterIdx, chapterCount) {
  return {
    hasPrev: currentChapterIdx >= 0,
    hasNext: currentChapterIdx >= -1 && currentChapterIdx < chapterCount - 1,
  };
}

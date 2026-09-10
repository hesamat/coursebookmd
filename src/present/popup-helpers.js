/**
 * popup-helpers.js — Pure logic shared by the presentation popup window and
 * the opener-side present-window controller. No DOM access; imported by
 * popup-main.js, present-window-controller.js, and unit tests.
 */

export const PRESENT_READY_MESSAGE = "cbmd:present-ready";
export const PRESENT_DATA_MESSAGE = "cbmd:present-data";
export const PRESENT_THEME_MESSAGE = "cbmd:present-theme";
export const PRESENT_VIEW_MESSAGE = "cbmd:present-view";
export const VIEW_MESSAGE = "cbmd:view";

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

/**
 * Position payload for view sync: the chapter index plus the current heading
 * (section) id. The landing page has no chapter heading of its own, so a
 * missing section id falls back to the canonical "overview" (chapterIdx -1
 * is a valid position — it is the landing/overview page).
 */
export function buildViewPayload(chapterIdx, sectionId) {
  return { chapterIdx, sectionId: sectionId || "overview" };
}

/**
 * Whether an inbound view payload should be applied. Rejects non-objects,
 * a missing/non-integer chapter index, and a payload deep-equal to the last
 * applied one — the echo case that would otherwise ping-pong the two windows.
 */
export function shouldApplyView(incoming, lastApplied) {
  if (!incoming || typeof incoming !== "object") return false;
  if (!Number.isInteger(incoming.chapterIdx)) return false;
  if (
    lastApplied &&
    lastApplied.chapterIdx === incoming.chapterIdx &&
    lastApplied.sectionId === incoming.sectionId
  ) {
    return false;
  }
  return true;
}

/** Prev/next availability for the chapter nav, mirroring updateChapterNav. */
export function chapterNeighbors(currentChapterIdx, chapterCount) {
  return {
    hasPrev: currentChapterIdx >= 0,
    hasNext: currentChapterIdx >= -1 && currentChapterIdx < chapterCount - 1,
  };
}

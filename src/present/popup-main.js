/**
 * popup-main.js — Entry point for the presentation popup window
 * (present.html). Receives already-rendered content from the opener window
 * (the main app) and reproduces the present-mode experience: section
 * navigation, spotlight, overlay, and chapter switching. Deliberately does
 * not boot the full app — the popup never loads a coursebook itself.
 */
import { SectionNavigator } from "../navigator/section-navigator.js";
import { createScrollSpy } from "../core/scroll-spy.js";
import { hydrateIcons } from "../core/icon.js";
import {
  PRESENT_DATA_MESSAGE,
  PRESENT_READY_MESSAGE,
  activeSectionIdFor,
  chapterNeighbors,
  computeOverlayNext,
} from "./popup-helpers.js";
import { BOUNDS_STORAGE_KEY } from "./window-placement.js";

const dom = {
  pane: document.getElementById("previewPane"),
  contentEl: document.getElementById("content"),
  chapterNav: document.getElementById("chapterNav"),
  prevChapterBtn: document.getElementById("prevChapterBtn"),
  nextChapterBtn: document.getElementById("nextChapterBtn"),
  overlayCurrent: document.getElementById("overlayCurrent"),
  overlayNext: document.getElementById("overlayNext"),
  overlayProgress: document.getElementById("overlayProgress"),
  presentHint: document.getElementById("presentHint"),
  presentHintBtn: document.getElementById("presentHintBtn"),
};

// ---- Metadata received from the opener ----
let chapters = null; // [{ id, title }] for [overview(-1), chapter0, ...] or null
let currentChapterIdx = -1;

// ---- Navigation stack (mirrors the app.js wiring) ----
let sectionNavigator = null;
const scrollSpy = createScrollSpy({
  pane: dom.pane,
  resizeTarget: dom.contentEl,
  getTocContainer: () => null,
  getNavigator: () => sectionNavigator,
  // The popup is always presenting: the spy must never override the
  // navigator's explicit waypoint moves.
  getDefaultLock: () => true,
});
scrollSpy.attach();

document.body.classList.add("presenting");
hydrateIcons();

showWaiting();

window.opener?.postMessage({ type: PRESENT_READY_MESSAGE }, window.location.origin);

/** Placeholder shown until the opener transfers the rendered coursebook. */
function showWaiting() {
  const p = document.createElement("p");
  p.className = "present-waiting";
  p.textContent = window.opener
    ? "Waiting for content from the main window…"
    : "Open a coursebook in the main CoursebookMD window, then click Present.";
  dom.contentEl.appendChild(p);
}

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.source !== window.opener) return;
  if (event.data?.type === PRESENT_DATA_MESSAGE) handleData(event.data);
});

/**
 * Apply a (re-)transferred dataset. Idempotent: the opener re-pushes fresh
 * content when the user clicks Present while the window is already open.
 */
function handleData(data) {
  if (window.opener) {
    try {
      applyThemeFrom(window.opener.document);
    } catch {
      // Opener went away or is cross-origin — keep the current theme.
    }
  }
  chapters = data.chapters ?? null;
  currentChapterIdx = chapters ? (data.currentChapterIdx ?? -1) : -1;

  if (!sectionNavigator) {
    sectionNavigator = new SectionNavigator(dom.contentEl, dom.pane, {
      scrollToEl: (el, { instant }) =>
        instant ? scrollSpy.scrollToInstant(el) : scrollSpy.scrollToSmooth(el),
    });
    sectionNavigator.onNavigate = updateOverlay;
  }

  // setup() scopes navigation to the active chapter, so the active section
  // must be settled first.
  updateVisibleSection();
  sectionNavigator.setup();
  setupScrollSpyForCurrentChapter();
  updateChapterNav();
  updateOverlay(0);
  dom.pane.scrollTop = 0;

  attemptFullscreen();
}

/**
 * Copy the opener's theme attributes onto this document. Shiki colors are
 * baked into the transferred inline styles, so the popup must render under
 * the same theme rather than re-deriving it.
 */
function applyThemeFrom(openerDoc) {
  for (const attr of ["data-theme", "data-palette"]) {
    const value = openerDoc.documentElement.getAttribute(attr);
    if (value) document.documentElement.setAttribute(attr, value);
  }
}

function updateVisibleSection() {
  if (!chapters) return;
  const activeId = activeSectionIdFor(currentChapterIdx, chapters);
  for (const section of dom.contentEl.querySelectorAll(".coursebook-section")) {
    section.classList.toggle("active", section.id === activeId);
  }
}

/** Mirrors setupScrollSpyForCurrentChapter in the chapter renderer. */
function setupScrollSpyForCurrentChapter() {
  if (!chapters) {
    scrollSpy.setHeadings(Array.from(dom.contentEl.querySelectorAll("h2, h3")));
    return;
  }
  const sections = Array.from(dom.contentEl.querySelectorAll(".coursebook-section"));
  const activeSection = sections[currentChapterIdx + 1] ?? sections[0];
  if (activeSection) {
    scrollSpy.setHeadings(Array.from(activeSection.querySelectorAll("h2, h3")));
  }
}

/** Mirrors updateChapterNav in the menu controller, using transferred titles. */
function updateChapterNav() {
  if (!chapters || chapters.length === 0) {
    dom.chapterNav.classList.add("hidden");
    return;
  }
  dom.chapterNav.classList.remove("hidden");

  const { hasPrev, hasNext } = chapterNeighbors(currentChapterIdx, chapters.length);
  dom.prevChapterBtn.disabled = !hasPrev;
  dom.nextChapterBtn.disabled = !hasNext;

  // Tooltips only — the visible labels stay short "← Previous" / "Next →",
  // matching the main app.
  if (hasPrev) {
    const prevIdx = currentChapterIdx - 1;
    const prevLabel = prevIdx >= 0 ? chapters[prevIdx].title : "Overview";
    dom.prevChapterBtn.title = `Previous: ${prevLabel}`;
    dom.prevChapterBtn.setAttribute("aria-label", `Previous chapter: ${prevLabel}`);
  } else {
    dom.prevChapterBtn.title = "No previous chapter";
    dom.prevChapterBtn.setAttribute("aria-label", "No previous chapter");
  }
  if (hasNext) {
    const nextLabel = chapters[currentChapterIdx + 1].title;
    dom.nextChapterBtn.title = `Next: ${nextLabel}`;
    dom.nextChapterBtn.setAttribute("aria-label", `Next chapter: ${nextLabel}`);
  } else {
    dom.nextChapterBtn.title = "No next chapter";
    dom.nextChapterBtn.setAttribute("aria-label", "No next chapter");
  }
}

function updateOverlay(idx, heading) {
  if (!sectionNavigator) return;
  const current = heading?.textContent?.trim() || sectionNavigator.currentText;
  dom.overlayCurrent.textContent = current;
  dom.overlayNext.textContent = computeOverlayNext({
    nextText: sectionNavigator.nextText,
    currentChapterIdx,
    chapters,
  });
  dom.overlayProgress.textContent = idx + 1 + " / " + sectionNavigator.count;
}

/** Mirrors goPrevChapter/goNextChapter in the menu controller. */
function goPrevChapter() {
  if (currentChapterIdx > 0) switchChapter(currentChapterIdx - 1);
  else if (currentChapterIdx === 0) switchChapter(-1);
}

function goNextChapter() {
  if (currentChapterIdx === -1) switchChapter(0);
  else if (chapters && currentChapterIdx < chapters.length - 1) {
    switchChapter(currentChapterIdx + 1);
  }
}

/** Chapter switch inside the popup — no round-trip to the opener needed. */
function switchChapter(idx) {
  if (!chapters || idx < -1 || idx >= chapters.length || idx === currentChapterIdx) {
    return;
  }
  currentChapterIdx = idx;
  updateVisibleSection();
  if (sectionNavigator) {
    sectionNavigator.setup();
    setupScrollSpyForCurrentChapter();
    updateOverlay(0);
  }
  updateChapterNav();
  const section = dom.contentEl.querySelector(
    `#${CSS.escape(activeSectionIdFor(currentChapterIdx, chapters))}`,
  );
  if (section) scrollSpy.scrollToInstant(section);
}

dom.prevChapterBtn.addEventListener("click", goPrevChapter);
dom.nextChapterBtn.addEventListener("click", goNextChapter);

// ---- Fullscreen ----
// The popup usually has no user activation of its own, so the automatic
// request is often rejected; the hint chip offers a one-click retry that
// does have one.
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) dom.presentHint.classList.add("hidden");
});

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  } else {
    document.documentElement.requestFullscreen?.().catch(() => {
      dom.presentHint.classList.remove("hidden");
    });
  }
}

function attemptFullscreen() {
  if (document.fullscreenElement) return;
  document.documentElement.requestFullscreen?.().catch(() => {
    dom.presentHint.classList.remove("hidden");
  });
  // Covers browsers that neither reject nor fulfill without a gesture.
  setTimeout(() => {
    if (!document.fullscreenElement) dom.presentHint.classList.remove("hidden");
  }, 600);
}

dom.presentHintBtn.addEventListener("click", toggleFullscreen);

// ---- Keyboard navigation (mirrors the main app's present-mode key map) ----
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // Let Space/Page activate a focused button (e.g. chapter nav) instead of
  // treating it as section navigation.
  if (
    e.target.closest("button") &&
    (e.key === " " || e.key === "PageUp" || e.key === "PageDown")
  ) {
    return;
  }

  switch (e.key) {
    case "ArrowRight":
      e.preventDefault();
      scrollSpy.withNavigatorScroll(() => sectionNavigator?.next(), true);
      break;
    case " ":
    case "PageDown":
      e.preventDefault();
      scrollSpy.withNavigatorScroll(
        () => sectionNavigator?.next({ syncVisual: false }),
        false,
      );
      break;
    case "ArrowLeft":
      e.preventDefault();
      scrollSpy.withNavigatorScroll(() => sectionNavigator?.prev(), true);
      break;
    case "PageUp":
      e.preventDefault();
      scrollSpy.withNavigatorScroll(
        () => sectionNavigator?.prev({ syncVisual: false }),
        false,
      );
      break;
    case "ArrowUp":
      e.preventDefault();
      dom.pane.scrollBy({ top: -scrollStep(), behavior: "smooth" });
      break;
    case "ArrowDown":
      e.preventDefault();
      dom.pane.scrollBy({ top: scrollStep(), behavior: "smooth" });
      break;
    case "Home":
      e.preventDefault();
      scrollSpy.withNavigatorScroll(
        () => sectionNavigator?.first({ syncVisual: false }),
        false,
      );
      break;
    case "End":
      e.preventDefault();
      scrollSpy.withNavigatorScroll(
        () => sectionNavigator?.last({ syncVisual: false }),
        false,
      );
      break;
    case "s":
    case "S":
      e.preventDefault();
      sectionNavigator?.toggleSpotlight();
      break;
    case "f":
    case "F":
      e.preventDefault();
      toggleFullscreen();
      break;
    case "Escape":
      // Fullscreen exit is handled natively by the browser (a second Esc
      // then lands here); otherwise close the presentation window.
      if (!document.fullscreenElement) window.close();
      break;
  }
});

function scrollStep() {
  return Math.max(120, Math.round(dom.pane.clientHeight * 0.5));
}

// ---- Window bounds memory ----
// Lets the fallback placement (no multi-screen API) reopen where the user
// last put the window.
function currentBounds() {
  return {
    left: window.screenX,
    top: window.screenY,
    width: window.outerWidth,
    height: window.outerHeight,
  };
}

function writeBounds() {
  try {
    localStorage.setItem(BOUNDS_STORAGE_KEY, JSON.stringify(currentBounds()));
  } catch {
    // Storage unavailable — placement just falls back to defaults.
  }
}

let boundsTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(writeBounds, 500);
});
window.addEventListener("beforeunload", () => {
  clearTimeout(boundsTimer);
  writeBounds();
});

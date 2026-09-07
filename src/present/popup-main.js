/**
 * popup-main.js — Entry point for the presentation popup window
 * (present.html). Receives already-rendered content from the opener window
 * (the main app) and presents it through the shared present-mode engine
 * (core/present-mode.js), so spotlight, black-out, the shortcuts sheet, and
 * the overlay behave exactly as in the app and the exported HTML.
 * Deliberately does not boot the full app — the popup never loads a
 * coursebook itself.
 */
import { SectionNavigator } from "../navigator/section-navigator.js";
import { createScrollSpy } from "../core/scroll-spy.js";
import { createPresentMode } from "../core/present-mode.js";
import { hydrateIcons } from "../core/icon.js";
import { isShortcut } from "../core/utils.js";
import {
  PRESENT_DATA_MESSAGE,
  PRESENT_READY_MESSAGE,
  PRESENT_THEME_MESSAGE,
  activeSectionIdFor,
  chapterNeighbors,
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
  shortcutsSheet: document.getElementById("shortcutsSheet"),
  shortcutsSheetBackdrop: document.getElementById("shortcutsSheetBackdrop"),
  shortcutsSheetPresent: document.getElementById("shortcutsSheetPresent"),
};

// ---- Metadata received from the opener ----
let chapters = null; // [{ id, title }] for [overview(-1), chapter0, ...] or null
let currentChapterIdx = -1;
let lastSectionId = null; // Section id shown after the previous transfer

// ---- Navigation stack ----
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

// The popup is born presenting; the engine takes over once content arrives.
document.body.classList.add("presenting");
hydrateIcons();

showWaiting();

window.opener?.postMessage({ type: PRESENT_READY_MESSAGE }, window.location.origin);

const presentMode = createPresentMode({
  getNavigator: () => sectionNavigator,
  overlay: {
    root: document.getElementById("overlay"),
    current: dom.overlayCurrent,
    next: dom.overlayNext,
    progress: dom.overlayProgress,
  },
  sheet: {
    root: dom.shortcutsSheet,
    backdrop: dom.shortcutsSheetBackdrop,
    presentGrid: dom.shortcutsSheetPresent,
  },
  getNextChapterTitle: () => {
    if (!chapters || chapters.length === 0) return null;
    if (currentChapterIdx >= chapters.length - 1) return null;
    if (currentChapterIdx === -1) return chapters[0]?.title ?? null;
    return chapters[currentChapterIdx + 1]?.title ?? null;
  },
  onPresented: presentSettled,
  // Leaving presentation means leaving the page.
  onExit: () => window.close(),
  // Un-fullscreening the projector window must not end the presentation.
  exitOnFullscreenExit: false,
  // The popup cannot re-run Shiki itself, so T asks the opener to flip the
  // theme and re-push freshly highlighted content (see the message handler
  // in the present-window controller).
  onToggleTheme: () => {
    window.opener?.postMessage({ type: PRESENT_THEME_MESSAGE }, window.location.origin);
  },
});

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
    // The overlay mirrors the navigator's waypoint as it moves; the active
    // h3's text overrides its parent h2 waypoint, like in the app.
    sectionNavigator.onNavigate = (idx, heading) =>
      presentMode.updateOverlay({ heading });
  }

  // A re-push (theme toggle, fresh edits) may resume the presenter's place:
  // the re-adopted content replaces the nodes the navigator waypoints point
  // at, and setup() below resets the waypoint index — capture it now. Resume
  // only when the active section is unchanged (the incoming clone already
  // carries the opener's new active section, so compare against the section
  // this popup showed after the previous transfer, kept in lastSectionId);
  // across a chapter switch the index would land mid-way through an
  // unrelated chapter.
  const nextSectionId = activeSectionIdFor(currentChapterIdx, chapters);
  const resumeIdx =
    lastSectionId !== null &&
    lastSectionId === nextSectionId &&
    sectionNavigator.currentIdx > 0
      ? sectionNavigator.currentIdx
      : 0;

  // setup() scopes navigation to the active chapter, so the active section
  // must be settled first.
  updateVisibleSection();
  lastSectionId = nextSectionId;
  sectionNavigator.setup();
  setupScrollSpyForCurrentChapter();
  updateChapterNav();

  if (!presentMode.isPresenting()) {
    // Requests fullscreen and settles the view once the mode has applied.
    presentMode.enter();
  } else {
    // Re-push: re-run the settle sequence enter() schedules, then resume on
    // the waypoint that was current before the transfer.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        presentSettled();
        if (resumeIdx > 0) sectionNavigator?.navigateTo(resumeIdx, { instant: true });
        else presentMode.updateOverlay();
      }),
    );
  }

  attemptFullscreenHint();
}

/** Mirrors the app's onPresented: settle the view after the mode applied. */
function presentSettled() {
  dom.pane.scrollTop = 0;
  sectionNavigator?.setup();
  setupScrollSpyForCurrentChapter();
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
    presentMode.updateOverlay();
  }
  updateChapterNav();
  const section = dom.contentEl.querySelector(
    `#${CSS.escape(activeSectionIdFor(currentChapterIdx, chapters))}`,
  );
  if (section) scrollSpy.scrollToInstant(section);
}

dom.prevChapterBtn.addEventListener("click", goPrevChapter);
dom.nextChapterBtn.addEventListener("click", goNextChapter);

// ---- In-content clicks ----
// The transferred DOM carries no delegated handlers from the main window.
dom.contentEl.addEventListener("click", (event) => {
  const goUp = event.target.closest(".go-up-link");
  if (goUp) {
    event.preventDefault();
    scrollSpy.scrollToSmooth(goUp.closest(".coursebook-section") ?? dom.contentEl);
    return;
  }
  // A user-authored relative .md link would navigate the presentation
  // window away from present.html — keep the window presenting instead.
  const link = event.target.closest("a[href]");
  if (!link) return;
  const href = link.getAttribute("href") || "";
  if (
    href.startsWith("#") ||
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("//") ||
    href.startsWith("mailto:") ||
    !href.endsWith(".md")
  ) {
    return;
  }
  event.preventDefault();
});

// ---- Fullscreen ----
// The engine requests fullscreen on enter, but a just-opened popup usually
// has no user activation of its own, so the request is often rejected or
// left pending; the hint chip offers a one-click retry that does have one.
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

function attemptFullscreenHint() {
  if (document.fullscreenElement) return;
  // Covers browsers that neither reject nor fulfill without a gesture.
  setTimeout(() => {
    if (!document.fullscreenElement) dom.presentHint.classList.remove("hidden");
  }, 600);
}

dom.presentHintBtn.addEventListener("click", toggleFullscreen);

// ---- Keyboard navigation ----
document.addEventListener("keydown", (e) => {
  // Ctrl+Alt+P (⌘+⌃+P on macOS) exits, mirroring the app's present toggle.
  if (isShortcut(e)) {
    if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      window.close();
    }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // While fullscreen the browser handles Esc natively; un-fullscreening
  // must never close the window.
  if (e.key === "Escape" && document.fullscreenElement) return;

  // Let Space/Page activate a focused button (e.g. chapter nav) instead of
  // treating it as section navigation.
  if (
    e.target.closest("button") &&
    (e.key === " " || e.key === "PageUp" || e.key === "PageDown")
  ) {
    return;
  }

  // Shared present-mode keys: any-key black-out wake, S/B, the shortcuts
  // sheet (?), and Escape (closes the sheet, then the window via onExit).
  if (presentMode.handlePresentKeys(e)) return;

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
    case "f":
    case "F":
      e.preventDefault();
      toggleFullscreen();
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

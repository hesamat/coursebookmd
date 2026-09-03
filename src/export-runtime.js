/**
 * Export runtime
 *
 * IIFE bundle that boots the read-only CoursebookMD viewer in the
 * standalone HTML export. It reuses the same core modules, DOM classes,
 * CSS variables, and interaction patterns as the live app.
 */

import { SectionNavigator } from "./navigator/section-navigator.js";
import { LinkPreview } from "./renderer/link-preview.js";
import { ThemeManager } from "./core/theme-manager.js";
import { icon, hydrateIcons } from "./core/icon.js";
import {
  loadCollapsedGroups,
  createGroupElement,
  autoExpandGroup,
} from "./core/nav-groups.js";
import { parseLocationHash, formatLocationHash } from "./core/navigation.js";
import { extractTocItems } from "./core/toc-data.js";
import { slugifyForId } from "./core/utils.js";
import { createScrollSpy } from "./core/scroll-spy.js";
import { flashIndexedTerm } from "./core/indexed-terms.js";

let currentChapterIdx = -1;
let sectionNavigator = null;
let scrollSpy = null;

let sectionsData = [];
let navData = [];
let coursebookTitle = "";

let previewPane;
let contentEl;
let chapterListEl;
let chapterPaneTitle;
let chapterNav;
let prevChapterBtn;
let nextChapterBtn;
let themeToggleBtn;
let tocPane;
let tocToggleBtn;

// Sandboxed previews (Teams/SharePoint/Office viewers) run the export in a
// srcdoc frame with an opaque origin, where history updates throw
// SecurityError. Deep-linking no-ops there; everything else keeps working.
function safeReplaceState(hash) {
  try {
    history.replaceState(null, "", hash);
  } catch {
    // Hash updates are unsupported in opaque-origin documents.
  }
}

function getDomRefs() {
  previewPane = document.getElementById("previewPane");
  contentEl = document.getElementById("content");
  chapterListEl = document.getElementById("chapterList");
  chapterPaneTitle = document.getElementById("chapterPaneTitle");
  chapterNav = document.getElementById("chapterNav");
  prevChapterBtn = document.getElementById("prevChapterBtn");
  nextChapterBtn = document.getElementById("nextChapterBtn");
  themeToggleBtn = document.getElementById("themeToggleBtn");
  tocPane = document.getElementById("tocPane");
  tocToggleBtn = document.getElementById("tocToggleBtn");
}

function init(config) {
  sectionsData = config.sections ?? [];
  navData = config.nav ?? [];
  coursebookTitle = config.title ?? "";

  ThemeManager.applyTheme(config.theme ?? "light");
  ThemeManager.applyPalette(config.palette ?? "warm-graphite");

  getDomRefs();
  scrollSpy = createScrollSpy({
    pane: previewPane,
    resizeTarget: contentEl,
    getTocContainer: getCurrentChapterToc,
    getNavigator: () => sectionNavigator,
    getDefaultLock: () => true,
    tocMatch: "dataTarget",
    // Re-derive the tracked headings on every update (instead of using the
    // chapter-switch cache) so a section with no h2/h3 clears the TOC
    // highlight rather than keeping a stale one.
    rederive: () => {
      if (!previewPane || !contentEl) return null;
      const sections = Array.from(contentEl.querySelectorAll(".coursebook-section"));
      const activeSection = sections[currentChapterIdx + 1] ?? sections[0];
      return activeSection ? Array.from(activeSection.querySelectorAll("h2, h3")) : null;
    },
  });
  sectionNavigator = new SectionNavigator(contentEl, previewPane, {
    scrollToEl: (el, { instant }) =>
      instant ? scrollSpy.scrollToInstant(el) : scrollSpy.scrollToSmooth(el),
  });

  buildSidebar();
  buildChapterNav();
  setupNavigation();
  scrollSpy.attach();
  // Lock the navigator on initial setup so arrow navigation always starts at
  // the first heading rather than a heading the scroll-spy happens to see.
  scrollSpy.update({ lockNavigator: true });
  setupThemeToggle();
  setupCopyButtons();
  setupReadingAids();
  setupIndexLinks();
  setupKeyboardShortcuts();
  hydrateIcons(document.getElementById("app"));

  LinkPreview.enhance(contentEl);

  const { chapterSlug } = parseLocationHash(location.hash.slice(1));
  if (chapterSlug) {
    navigateFromHash();
  } else {
    showLandingPage();
  }
}

function buildChapterNav() {
  updateChapterNav();
}

function buildSidebar() {
  if (chapterPaneTitle) chapterPaneTitle.textContent = coursebookTitle;
  if (!chapterListEl) return;
  chapterListEl.innerHTML = "";

  const collapsedGroups = loadCollapsedGroups();

  const homeWrapper = document.createElement("div");
  homeWrapper.className = "chapter-item-wrapper";
  homeWrapper.dataset.chapterIdx = "-1";
  const homeItem = document.createElement("button");
  homeItem.type = "button";
  homeItem.className = "chapter-item";
  const homeText = document.createElement("span");
  homeText.className = "chapter-item__text";
  homeText.textContent = sectionsData[0]?.title ?? "Course Overview";
  homeItem.appendChild(homeText);
  homeItem.addEventListener("click", () => showLandingPage());
  homeWrapper.appendChild(homeItem);
  const homeToc = document.createElement("nav");
  homeToc.className = "chapter-toc";
  homeWrapper.appendChild(homeToc);
  chapterListEl.appendChild(homeWrapper);

  const navEntries = navData.length
    ? navData
    : sectionsData.slice(1).map((_, idx) => ({ type: "chapter", index: idx }));

  let currentGroup = null;
  let groupIdx = 0;
  for (const entry of navEntries) {
    if (entry.type === "group") {
      const groupKey = `${slugifyForId(entry.title)}-${groupIdx++}`;
      const group = createGroupElement(entry.title, collapsedGroups, groupKey);
      chapterListEl.appendChild(group);
      currentGroup = group;
      continue;
    }

    const idx = entry.index;
    const section = sectionsData[idx + 1];
    if (!section) continue;

    const wrapper = document.createElement("div");
    wrapper.className = "chapter-item-wrapper";
    wrapper.dataset.chapterIdx = String(idx);

    const item = document.createElement("button");
    item.type = "button";
    item.className = "chapter-item";

    const numSpan = document.createElement("span");
    numSpan.className = "chapter-item__number";
    numSpan.textContent = String(idx + 1);
    item.appendChild(numSpan);

    const textSpan = document.createElement("span");
    textSpan.className = "chapter-item__text";
    textSpan.textContent = section.title;
    item.appendChild(textSpan);

    item.addEventListener("click", () => loadChapterByIdx(idx));
    wrapper.appendChild(item);

    const toc = document.createElement("nav");
    toc.className = "chapter-toc";
    wrapper.appendChild(toc);

    if (currentGroup) {
      currentGroup.appendChild(wrapper);
    } else {
      chapterListEl.appendChild(wrapper);
    }
  }

  // General index entry — only when the exporter serialized one. The index
  // is a trailing section outside sectionsData (see coursebook-exporter).
  if (contentEl.querySelector("section.index-section")) {
    const indexItem = document.createElement("button");
    indexItem.type = "button";
    indexItem.className = "chapter-item index-nav-item";
    const indexText = document.createElement("span");
    indexText.className = "chapter-item__text";
    indexText.textContent = "Index";
    indexItem.appendChild(indexText);
    indexItem.addEventListener("click", () => showIndexPage());
    chapterListEl.appendChild(indexItem);
  }

  buildAllTOCs();
}

function buildAllTOCs() {
  if (!chapterListEl) return;
  const overview = sectionsData[0];
  if (overview) buildChapterToc(-1, overview.id);
  for (let i = 0; i < sectionsData.length - 1; i++) {
    const section = sectionsData[i + 1];
    if (section) buildChapterToc(i, section.id);
  }
}

function buildChapterToc(chapterIdx, sectionId) {
  const wrapper = chapterListEl.querySelector(
    `.chapter-item-wrapper[data-chapter-idx="${chapterIdx}"]`,
  );
  if (!wrapper) return;
  const tocContainer = wrapper.querySelector(".chapter-toc");
  if (!tocContainer) return;
  tocContainer.innerHTML = "";

  const section = contentEl.querySelector(`#${CSS.escape(sectionId)}`);
  if (!section) return;

  const tocItems = extractTocItems(section);
  for (const item of tocItems) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `toc-item toc-item--${item.level}`;
    btn.setAttribute("data-target", item.id);

    if (item.number) {
      const tocNumSpan = document.createElement("span");
      tocNumSpan.className = "toc-number";
      tocNumSpan.textContent = item.number;
      btn.appendChild(tocNumSpan);
      btn.appendChild(document.createTextNode(" " + item.text));
    } else {
      btn.textContent = item.text;
    }

    const headingEl = section.querySelector(`#${CSS.escape(item.id)}`);
    btn.addEventListener("click", () => {
      if (headingEl) {
        scrollSpy.scrollToSmooth(headingEl);
        const hash = formatLocationHash(sectionId, item.id);
        if (location.hash !== hash) safeReplaceState(hash);
      }
    });
    tocContainer.appendChild(btn);
  }
}

function updateActiveChapter() {
  if (!chapterListEl) return;
  const wrappers = chapterListEl.querySelectorAll(".chapter-item-wrapper");
  wrappers.forEach((wrapper) => {
    const idx = parseInt(wrapper.dataset.chapterIdx, 10);
    const isActive = idx === currentChapterIdx;
    const item = wrapper.querySelector(".chapter-item");
    const toc = wrapper.querySelector(".chapter-toc");
    if (item) item.classList.toggle("active", isActive);
    if (toc) toc.classList.toggle("is-open", isActive);
  });
}

function updateChapterNav() {
  if (!chapterNav) return;
  const totalChapters = sectionsData.length - 1;
  if (totalChapters <= 0) {
    chapterNav.classList.add("hidden");
    return;
  }
  chapterNav.classList.remove("hidden");

  const hasPrev = currentChapterIdx >= 0;
  const hasNext = currentChapterIdx < totalChapters - 1;

  prevChapterBtn.disabled = !hasPrev;
  nextChapterBtn.disabled = !hasNext;

  if (hasPrev) {
    const prevTitle =
      currentChapterIdx === 0
        ? (sectionsData[0]?.title ?? "Overview")
        : (sectionsData[currentChapterIdx]?.title ?? "Previous");
    prevChapterBtn.title = `Previous: ${prevTitle}`;
    prevChapterBtn.setAttribute("aria-label", `Previous chapter: ${prevTitle}`);
  } else {
    prevChapterBtn.title = "No previous chapter";
    prevChapterBtn.setAttribute("aria-label", "No previous chapter");
  }

  if (hasNext) {
    const nextTitle = sectionsData[currentChapterIdx + 2]?.title ?? "Next";
    nextChapterBtn.title = `Next: ${nextTitle}`;
    nextChapterBtn.setAttribute("aria-label", `Next chapter: ${nextTitle}`);
  } else {
    nextChapterBtn.title = "No next chapter";
    nextChapterBtn.setAttribute("aria-label", "No next chapter");
  }
}

function updateVisibleSection() {
  const sections = Array.from(contentEl.querySelectorAll(".coursebook-section"));
  const activeId =
    currentChapterIdx === -1 ? "overview" : sectionsData[currentChapterIdx + 1]?.id;
  for (const section of sections) {
    section.classList.toggle("active", section.id === activeId);
  }
}

function loadChapterByIdx(idx) {
  if (idx < -1 || idx >= sectionsData.length - 1) return;
  currentChapterIdx = idx;
  const sectionId = idx === -1 ? "overview" : sectionsData[idx + 1]?.id;
  const section = contentEl.querySelector(`#${CSS.escape(sectionId)}`);
  if (!section) return;

  updateActiveChapter();
  updateChapterNav();
  updateVisibleSection();

  if (sectionNavigator) {
    sectionNavigator.setup();
    setupScrollSpyForCurrentChapter();
  }

  scrollSpy.scrollToInstant(section);
  safeReplaceState(formatLocationHash(sectionId));

  const activeWrapper = chapterListEl.querySelector(
    `.chapter-item-wrapper[data-chapter-idx="${idx}"]`,
  );
  autoExpandGroup(activeWrapper);
}

function showLandingPage() {
  loadChapterByIdx(-1);
}

/**
 * Activate the generated index section. Like the live app, chapter state is
 * untouched; the next chapter navigation deactivates the index via
 * updateVisibleSection.
 */
function showIndexPage() {
  const indexSection = contentEl.querySelector("section.index-section");
  if (!indexSection) return;
  for (const section of contentEl.querySelectorAll(".coursebook-section")) {
    section.classList.toggle("active", section === indexSection);
  }
  updateActiveChapter();
  safeReplaceState("#index");
  scrollSpy.scrollToInstant(indexSection);
}

function goPrevChapter() {
  if (currentChapterIdx > 0) {
    loadChapterByIdx(currentChapterIdx - 1);
  } else if (currentChapterIdx === 0) {
    showLandingPage();
  }
}

function goNextChapter() {
  if (currentChapterIdx === -1) {
    loadChapterByIdx(0);
  } else if (currentChapterIdx < sectionsData.length - 2) {
    loadChapterByIdx(currentChapterIdx + 1);
  }
}

/**
 * Seed the spy with the active section's h2/h3. The spy re-derives the same
 * set on every update; this keeps the heading cache fresh for direct
 * setActive calls between updates.
 */
function setupScrollSpyForCurrentChapter() {
  const sections = Array.from(contentEl.querySelectorAll(".coursebook-section"));
  const activeSection = sections[currentChapterIdx + 1] ?? sections[0];
  if (activeSection) {
    scrollSpy.setHeadings(Array.from(activeSection.querySelectorAll("h2, h3")));
  }
}

function getCurrentChapterToc() {
  if (!chapterListEl) return null;
  const selector = `.chapter-item-wrapper[data-chapter-idx="${currentChapterIdx}"] .chapter-toc`;
  return chapterListEl.querySelector(selector);
}

function setupNavigation() {
  prevChapterBtn?.addEventListener("click", goPrevChapter);
  nextChapterBtn?.addEventListener("click", goNextChapter);
  tocToggleBtn?.addEventListener("click", () => {
    tocPane.classList.toggle("collapsed");
    const collapsed = tocPane.classList.contains("collapsed");
    tocToggleBtn.setAttribute(
      "aria-label",
      collapsed ? "Expand contents" : "Collapse contents",
    );
    tocToggleBtn.setAttribute("title", collapsed ? "Expand" : "Collapse");
  });
}

function setupThemeToggle() {
  themeToggleBtn?.addEventListener("click", () => {
    ThemeManager.toggleTheme();
  });
}

function navigateFromHash() {
  const { chapterSlug, headingSlug } = parseLocationHash(location.hash.slice(1));
  if (!chapterSlug) return;
  if (chapterSlug === "index") {
    showIndexPage();
    return;
  }
  const idx = findChapterIndexBySlug(chapterSlug);
  if (idx === -2) return;

  currentChapterIdx = idx;
  updateActiveChapter();
  updateChapterNav();
  updateVisibleSection();

  if (sectionNavigator) {
    sectionNavigator.setup();
    setupScrollSpyForCurrentChapter();
  }

  const activeWrapper = chapterListEl.querySelector(
    `.chapter-item-wrapper[data-chapter-idx="${currentChapterIdx}"]`,
  );
  autoExpandGroup(activeWrapper);

  const sectionId = idx === -1 ? "overview" : sectionsData[idx + 1]?.id;
  const section = contentEl.querySelector(`#${CSS.escape(sectionId)}`);
  if (!section) return;

  if (headingSlug) {
    const target = section.querySelector(`#${CSS.escape(headingSlug)}`);
    if (target) {
      scrollSpy.scrollToSmooth(target);
      const hash = formatLocationHash(chapterSlug, headingSlug);
      if (location.hash !== hash) safeReplaceState(hash);
    }
  } else {
    scrollSpy.scrollToInstant(section);
  }
}

window.addEventListener("hashchange", navigateFromHash);

function findChapterIndexBySlug(slug) {
  if (slug === "overview") return -1;
  for (let i = 0; i < sectionsData.length - 1; i++) {
    if (sectionsData[i + 1]?.id === slug) return i;
  }
  return -2;
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.target.closest(".chapter-item, .toc-item, .chapter-nav__btn")) {
      if (e.key === " " || e.key === "Enter") {
        return;
      }
    }

    if (isShortcut(e)) {
      switch (e.key) {
        case "i":
        case "I":
          e.preventDefault();
          ThemeManager.toggleTheme();
          return;
      }
    }

    const isTextInput =
      e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/i.test(e.target.tagName);
    const inPreview =
      previewPane.contains(e.target) ||
      tocPane.contains(e.target) ||
      e.target === document.body;
    if (isTextInput || !inPreview) return;

    if (e.target.closest("button")) {
      if (e.key === " " || e.key === "PageUp" || e.key === "PageDown") return;
    }

    const SCROLL_STEP = Math.max(120, Math.round(previewPane.clientHeight * 0.5));

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
        previewPane.scrollBy({ top: -SCROLL_STEP, behavior: "smooth" });
        break;
      case "ArrowDown":
        e.preventDefault();
        previewPane.scrollBy({ top: SCROLL_STEP, behavior: "smooth" });
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
    }
  });
}

function isShortcut(e) {
  const isMac =
    (navigator.userAgentData && /mac/i.test(navigator.userAgentData.platform)) ||
    /mac/i.test(navigator.platform) ||
    /macintosh|mac os x|macos/i.test(navigator.userAgent);
  if (isMac) {
    return e.metaKey && e.ctrlKey && !e.altKey && !e.shiftKey;
  }
  return e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey;
}

async function copyTextToClipboard(text) {
  if (
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function" &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
  document.body.appendChild(textarea);
  textarea.select();

  let success = false;
  try {
    success = document.execCommand("copy");
  } catch {
    // non-fatal
  }

  document.body.removeChild(textarea);
  return success;
}

function resetCopyButton(button) {
  button.classList.remove("is-copied", "is-copy-failed");
  button.setAttribute("aria-label", "Copy code to clipboard");
  button.setAttribute("title", "Copy");
  const oldSvg = button.querySelector("svg");
  if (oldSvg) oldSvg.remove();
  const copyIcon = icon("copy", { size: "sm" });
  if (copyIcon) button.appendChild(copyIcon);
}

function setupCopyButtons() {
  contentEl?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".code-copy-button");
    if (!btn) return;
    e.preventDefault();
    const pre = btn.closest("pre");
    if (!pre) return;
    const code = pre.querySelector("code");
    if (!code) return;

    const text = code.textContent || "";
    const success = await copyTextToClipboard(text);

    if (success) {
      btn.classList.add("is-copied");
      btn.setAttribute("aria-label", "Copied");
      btn.setAttribute("title", "Copied");
      const oldSvg = btn.querySelector("svg");
      if (oldSvg) oldSvg.remove();
      const checkIcon = icon("clipboard-check", { size: "sm" });
      if (checkIcon) btn.appendChild(checkIcon);
    } else {
      btn.classList.add("is-copy-failed");
      btn.setAttribute("aria-label", "Copy failed");
      btn.setAttribute("title", "Copy failed");
      const oldSvg = btn.querySelector("svg");
      if (oldSvg) oldSvg.remove();
      const xIcon = icon("clipboard-x", { size: "sm" });
      if (xIcon) btn.appendChild(xIcon);
    }

    if (btn._copyResetTimer) clearTimeout(btn._copyResetTimer);
    btn._copyResetTimer = setTimeout(() => resetCopyButton(btn), 2000);
  });
}

// The reading aids themselves are injected at serialize time by the
// exporter; the runtime only handles their clicks. Go-up jumps instantly —
// the export shows one chapter at a time, so the chapter top is always a
// short jump (matching chapter-switch behavior).
function setupReadingAids() {
  contentEl?.addEventListener("click", (e) => {
    const goUp = e.target.closest(".go-up-link");
    if (!goUp) return;
    e.preventDefault();
    const section = goUp.closest(".coursebook-section");
    if (section) scrollSpy.scrollToInstant(section);
  });
}

// Index entries link to a term's first occurrence, which may live in a
// hidden section in the single-page-at-a-time export: switch to that
// section first, then scroll to the term.
function setupIndexLinks() {
  contentEl?.addEventListener("click", (e) => {
    const link = e.target.closest(".idx-link");
    if (!link) return;
    e.preventDefault();

    const target = document.getElementById(link.getAttribute("data-target") || "");
    const section = target?.closest(".coursebook-section");
    if (!target || !section) return;
    if (section.classList.contains("index-section")) return;

    const idx = findChapterIndexBySlug(section.id);
    if (idx !== -2) {
      loadChapterByIdx(idx);
    }
    scrollSpy.scrollToSmooth(target);
    flashIndexedTerm(target, previewPane);
    safeReplaceState(formatLocationHash(section.id, target.id));
  });
}

const dataEl = document.getElementById("coursebook-data");
if (dataEl) {
  try {
    init(JSON.parse(dataEl.textContent));
  } catch (err) {
    console.error("Failed to initialize export runtime:", err);
  }
}

export default { init };

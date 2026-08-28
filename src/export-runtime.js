/**
 * Export runtime
 *
 * IIFE bundle that boots the read-only CoursebookMD viewer in the
 * standalone HTML export. It reuses the same core modules, DOM classes,
 * CSS variables, and interaction patterns as the live app.
 */

import { SectionNavigator } from "./navigator/section-navigator.js";
import { ThemeManager } from "./core/theme-manager.js";
import { icon, hydrateIcons } from "./core/icon.js";
import {
  loadCollapsedGroups,
  createGroupElement,
  autoExpandGroup,
} from "./core/nav-groups.js";
import { parseLocationHash, formatLocationHash } from "./core/navigation.js";
import { extractTocItems } from "./core/toc-data.js";

const SCROLL_OFFSET = 80;
const BOTTOM_THRESHOLD = 100;
const ACTIVATION_LINE = 120;
const SCROLL_TARGET_TOLERANCE = 4;
const LONG_SCROLL_DISTANCE = 3000;

let currentChapterIdx = -1;
let suppressScrollGeneration = 0;
let suppressScrollSpy = false;
let scrollSpyHeadings = [];
let scrollSpyFrame = null;
let scrollSpyResizeObserver = null;
let navigator = null;

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
  navigator = new SectionNavigator(contentEl, previewPane);

  buildSidebar();
  buildChapterNav();
  setupNavigation();
  setupScrollSpy();
  setupThemeToggle();
  setupCopyButtons();
  setupKeyboardShortcuts();
  hydrateIcons(document.getElementById("app"));

  const { chapterSlug, headingSlug } = parseLocationHash(location.hash.slice(1));
  if (chapterSlug) {
    navigateFromHash(chapterSlug, headingSlug);
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
      const groupKey = `group-${groupIdx++}`;
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
        scrollToElSmooth(headingEl);
        const hash = formatLocationHash(sectionId, item.id);
        if (location.hash !== hash) history.replaceState(null, "", hash);
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

  if (navigator) {
    navigator.setup();
    setupScrollSpyForCurrentChapter();
  }

  scrollToElInstant(section);
  history.replaceState(null, "", formatLocationHash(sectionId));

  const activeWrapper = chapterListEl.querySelector(
    `.chapter-item-wrapper[data-chapter-idx="${idx}"]`,
  );
  autoExpandGroup(activeWrapper);
}

function showLandingPage() {
  loadChapterByIdx(-1);
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

function scrollTopForElement(el) {
  const paneRect = previewPane.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  return previewPane.scrollTop + (elRect.top - paneRect.top) - SCROLL_OFFSET;
}

function scrollToElInstant(el) {
  const gen = ++suppressScrollGeneration;
  suppressScrollSpy = true;
  previewPane.scrollTop = scrollTopForElement(el);
  requestAnimationFrame(() => {
    if (gen !== suppressScrollGeneration) return;
    cancelScheduledScrollSpyUpdate();
    suppressScrollSpy = false;
    syncScrollSpyAfterScroll();
  });
}

function scrollToElSmooth(el) {
  const maxTop = Math.max(0, previewPane.scrollHeight - previewPane.clientHeight);
  const targetTop = Math.min(Math.max(scrollTopForElement(el), 0), maxTop);
  const distance = Math.abs(targetTop - previewPane.scrollTop);
  suppressScrollSpyUntilDone({ activeHeading: el, expectedTop: targetTop });
  previewPane.scrollTo({
    top: targetTop,
    behavior: distance > LONG_SCROLL_DISTANCE ? "auto" : "smooth",
  });
}

function suppressScrollSpyUntilDone({
  lockNavigator = false,
  activeHeading = null,
  expectedTop = null,
} = {}) {
  const gen = ++suppressScrollGeneration;
  suppressScrollSpy = true;
  let done = false;
  let quietPolls = 0;
  let started = false;
  let lastTop = previewPane.scrollTop;
  let pollTimer = null;
  let noStartTimer = null;
  let capTimer = null;

  function reenable() {
    if (done) return;
    if (gen !== suppressScrollGeneration) return;
    done = true;
    clearInterval(pollTimer);
    clearTimeout(noStartTimer);
    clearTimeout(capTimer);
    previewPane.removeEventListener("scrollend", reenable);
    cancelScheduledScrollSpyUpdate();
    suppressScrollSpy = false;
    syncScrollSpyAfterScroll({ lockNavigator, activeHeading, expectedTop });
  }

  pollTimer = setInterval(() => {
    const top = previewPane.scrollTop;
    if (top !== lastTop) {
      lastTop = top;
      started = true;
      quietPolls = 0;
      return;
    }
    if (started && ++quietPolls >= 2) reenable();
  }, 100);

  noStartTimer = setTimeout(() => {
    if (!started) reenable();
  }, 250);

  capTimer = setTimeout(reenable, 4000);

  if ("onscrollend" in previewPane) {
    previewPane.addEventListener("scrollend", reenable, { once: true });
  }
}

function setupScrollSpy() {
  previewPane.addEventListener("scroll", scheduleScrollSpyUpdate, { passive: true });
  scrollSpyResizeObserver = new ResizeObserver(() => {
    if (!suppressScrollSpy) scheduleScrollSpyUpdate();
  });
  scrollSpyResizeObserver.observe(contentEl);
  scrollSpyUpdate();
}

function setupScrollSpyForCurrentChapter() {
  const sections = Array.from(contentEl.querySelectorAll(".coursebook-section"));
  const activeSection = sections[currentChapterIdx + 1] ?? sections[0];
  if (activeSection) {
    setupScrollSpyHeadings(activeSection);
  }
}

function setupScrollSpyHeadings(section) {
  scrollSpyHeadings = Array.from(section.querySelectorAll("h2, h3"));
}

function scheduleScrollSpyUpdate() {
  if (scrollSpyFrame !== null) return;
  scrollSpyFrame = requestAnimationFrame(() => {
    scrollSpyFrame = null;
    scrollSpyUpdate();
  });
}

function cancelScheduledScrollSpyUpdate() {
  if (scrollSpyFrame !== null) {
    cancelAnimationFrame(scrollSpyFrame);
    scrollSpyFrame = null;
  }
}

function scrollSpyUpdate() {
  if (suppressScrollSpy) return;
  if (!previewPane || !contentEl) return;

  const paneTop = previewPane.getBoundingClientRect().top;
  const { scrollTop, clientHeight, scrollHeight } = previewPane;

  const sections = Array.from(contentEl.querySelectorAll(".coursebook-section"));
  const activeSection = sections[currentChapterIdx + 1] ?? sections[0];
  if (!activeSection) return;

  setupScrollSpyHeadings(activeSection);

  const nearBottom =
    scrollHeight > clientHeight &&
    scrollTop + clientHeight >= scrollHeight - BOTTOM_THRESHOLD;
  let activeHeading = null;
  if (nearBottom) {
    const headings = Array.from(activeSection.querySelectorAll("h2, h3"));
    activeHeading = headings[headings.length - 1] ?? null;
  } else {
    for (const heading of scrollSpyHeadings) {
      const top = heading.getBoundingClientRect().top - paneTop;
      if (top <= ACTIVATION_LINE) {
        activeHeading = heading;
      } else {
        break;
      }
    }
  }

  scrollSpySetActive(activeHeading);
}

function getCurrentChapterToc() {
  if (!chapterListEl) return null;
  const selector = `.chapter-item-wrapper[data-chapter-idx="${currentChapterIdx}"] .chapter-toc`;
  return chapterListEl.querySelector(selector);
}

function scrollSpySetActive(heading, { lockNavigator = false } = {}) {
  const tocContainer = getCurrentChapterToc();
  if (tocContainer) {
    const items = tocContainer.querySelectorAll(".toc-item");
    items.forEach((item) => item.classList.remove("active"));
    if (heading) {
      const target = heading.id;
      for (const item of items) {
        if (item.getAttribute("data-target") === target) {
          item.classList.add("active");
          break;
        }
      }
    }
  }

  if (heading && navigator && !lockNavigator) {
    let h2 = heading;
    const idx = scrollSpyHeadings.indexOf(heading);
    for (let i = idx; i >= 0; i--) {
      if (scrollSpyHeadings[i].tagName === "H2") {
        h2 = scrollSpyHeadings[i];
        break;
      }
    }
    const navIdx = navigator.headings.indexOf(h2);
    if (navIdx >= 0) {
      navigator.setCurrent(navIdx);
    }
  }
}

function syncScrollSpyAfterScroll({
  lockNavigator = false,
  activeHeading = null,
  expectedTop = null,
} = {}) {
  if (lockNavigator && navigator) {
    navigator.syncVisual();
  }
  const onTarget =
    expectedTop == null ||
    Math.abs(previewPane.scrollTop - expectedTop) <= SCROLL_TARGET_TOLERANCE;
  if (activeHeading && document.contains(activeHeading) && onTarget) {
    scrollSpySetActive(activeHeading, { lockNavigator });
  } else {
    scrollSpyUpdate();
  }
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

function withNavigatorScroll(action, syncVisual = true) {
  if (!navigator) return;
  const before = navigator.currentIdx;
  action();
  if (navigator.currentIdx === before) return;
  suppressScrollSpyUntilDone({
    lockNavigator: syncVisual,
    activeHeading: navigator.current,
  });
}

function navigateFromHash(chapterSlug, headingSlug) {
  if (!chapterSlug) return;
  const idx = findChapterIndexBySlug(chapterSlug);
  if (idx === -2) return;

  currentChapterIdx = idx;
  updateActiveChapter();
  updateChapterNav();
  updateVisibleSection();

  if (navigator) {
    navigator.setup();
    setupScrollSpyForCurrentChapter();
  }

  const sectionId = idx === -1 ? "overview" : sectionsData[idx + 1]?.id;
  const section = contentEl.querySelector(`#${CSS.escape(sectionId)}`);
  if (!section) return;

  if (headingSlug) {
    const target = section.querySelector(`#${CSS.escape(headingSlug)}`);
    if (target) {
      scrollToElSmooth(target);
      const hash = formatLocationHash(chapterSlug, headingSlug);
      if (location.hash !== hash) history.replaceState(null, "", hash);
    }
  } else {
    scrollToElInstant(section);
  }
}

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
        withNavigatorScroll(() => navigator?.next({ syncVisual: true }));
        break;
      case " ":
      case "PageDown":
        e.preventDefault();
        withNavigatorScroll(() => navigator?.next({ syncVisual: false }));
        break;
      case "ArrowLeft":
        e.preventDefault();
        withNavigatorScroll(() => navigator?.prev({ syncVisual: true }));
        break;
      case "PageUp":
        e.preventDefault();
        withNavigatorScroll(() => navigator?.prev({ syncVisual: false }));
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
        withNavigatorScroll(() => navigator?.first({ syncVisual: false }));
        break;
      case "End":
        e.preventDefault();
        withNavigatorScroll(() => navigator?.last({ syncVisual: false }));
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

const dataEl = document.getElementById("coursebook-data");
if (dataEl) {
  try {
    init(JSON.parse(dataEl.textContent));
  } catch (err) {
    console.error("Failed to initialize export runtime:", err);
  }
}

export default { init };

/**
 * app.js — Application entry point.
 * Wires together coursebook loading, theme management, icon hydration,
 * menu dropdowns, the editor, renderer, navigator, and presentation mode.
 */
import { renderMarkdown, sanitizeHtml } from "./renderer/markdown-renderer.js";
import { ContentEnhancer } from "./renderer/content-enhancer.js";
import { SectionNavigator } from "./navigator/section-navigator.js";
import { ThemeManager, PALETTES } from "./core/theme-manager.js";
import { hydrateIcons } from "./core/icon.js";
import {
  computeSectionNumbers,
  computeSectionNumbersForSections,
  extractHeadingsFromMarkdown,
  applyHeadingNumber,
} from "./core/section-numbering.js";
import { slugifyForId } from "./core/utils.js";
import { flashHeading } from "./core/heading-flash.js";
import {
  parseLocationHash,
  formatLocationHash,
  navigateToTarget,
} from "./core/navigation.js";
import { extractTocItems } from "./core/toc-data.js";
import {
  loadCoursebook,
  loadChapter,
  getChapterTitle,
} from "./core/coursebook-loader.js";
import {
  exportCoursebookHtml,
  exportSingleHtml,
} from "./renderer/coursebook-exporter.js";

const DEFAULT_CONTENT = `# Welcome to CoursebookMD

Write your course chapter in Markdown. Use **Present** to teach from it.

## Getting Started

- Edit the Markdown on the left (click **Edit**)
- The preview updates live on the right
- Press **Present** or \`F\` to enter presentation mode
- Use arrow keys to navigate between headings
- Press \`S\` to toggle spotlight dimming

## Features

| Feature | Status |
| ------- | ------ |
| Markdown rendering | Working |
| Code highlighting (Shiki) | Working |
| Math (KaTeX) | Working |
| Diagrams (Mermaid) | Working |
| Tables | Working |
| Live editor | Basic |
| Save / Open | Basic |
| Export HTML | Basic |
| Dark mode + palettes | Working |

### Code example

\`\`\`python
def greet(name):
    print(f"Hello, {name}!")

greet("COMP 1510")
\`\`\`

### Math example

The area of a rectangle: $A = w \\times h$

$$E = mc^2$$

### Diagram example

\`\`\`mermaid
graph TD
    A[Write] --> B[Run]
    B --> C{Works?}
    C -->|No| D[Fix]
    D --> B
    C -->|Yes| E[Done]
\`\`\`

## Try It

1. Click **Edit** to show the editor pane.
2. Modify this text and watch the preview update.
3. Click **Present** to enter full-screen presentation mode.
4. Use arrow keys to navigate between sections.
5. Toggle dark mode with the switch in the top bar.
6. Switch palettes from **Settings** in the menu.
`;

// ---- DOM refs ----
const contentEl = document.getElementById("content");
const editorEl = document.getElementById("editor");
const editorPane = document.getElementById("editorPane");
const toggleEditBtn = document.getElementById("toggleEditBtn");
const toggleEditLabel = document.getElementById("toggleEditLabel");
const presentBtn = document.getElementById("presentBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const toggleFullscreenBtn = document.getElementById("toggleFullscreenBtn");
const menuBtn = document.getElementById("menuBtn");
const menuDropdown = document.getElementById("menuDropdown");
const menuOpenFileBtn = document.getElementById("menuOpenFileBtn");
const menuToggleEditBtn = document.getElementById("menuToggleEditBtn");
const menuExportHtmlBtn = document.getElementById("menuExportHtmlBtn");
const menuSettingsBtn = document.getElementById("menuSettingsBtn");
const overlayCurrent = document.getElementById("overlayCurrent");
const overlayNext = document.getElementById("overlayNext");
const overlayProgress = document.getElementById("overlayProgress");
const tocPane = document.getElementById("tocPane");
const tocToggleBtn = document.getElementById("tocToggleBtn");
const settingsModal = document.getElementById("settingsModal");
const settingsBackdrop = document.getElementById("settingsBackdrop");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const settingsThemeToggle = document.getElementById("settingsThemeToggle");
const settingsPaletteWarm = document.getElementById("settingsPaletteWarm");
const settingsPaletteIndigo = document.getElementById("settingsPaletteIndigo");
const settingsPaletteBlue = document.getElementById("settingsPaletteBlue");
const chapterListEl = document.getElementById("chapterList");
const chapterPaneTitle = document.getElementById("chapterPaneTitle");
const chapterNav = document.getElementById("chapterNav");
const prevChapterBtn = document.getElementById("prevChapterBtn");
const nextChapterBtn = document.getElementById("nextChapterBtn");
const chapterTitleEl = document.getElementById("chapterTitle");
const previewPane = document.getElementById("previewPane");

// ---- State ----
let navigator = null;
let editMode = false;
let renderTimer = null;
let currentMarkdown = DEFAULT_CONTENT;
let suppressScrollSpy = false;

/** @type {import("./core/coursebook-loader.js").Coursebook | null} */
let coursebook = null;
let currentChapterIdx = -1; // -1 means parent/landing page

// Pre-loaded chapter markdowns and per-section heading/number data.
// sectionHeadings[0] is the parent landing page, sectionHeadings[i+1] is chapter i.
let sectionMarkdowns = [];
let sectionHeadings = [];
let sectionNumbers = [];

// ---- Theme ----
ThemeManager.initTheme();

/**
 * Re-highlight code blocks when the theme changes.
 * Shiki bakes colors into inline styles, so a theme switch requires
 * re-running the highlighter with the new theme.
 */
async function onThemeChange() {
  if (contentEl) {
    await ContentEnhancer.rehighlight(contentEl);
  }
}

themeToggleBtn.addEventListener("click", async () => {
  ThemeManager.toggleTheme();
  await onThemeChange();
});

// Settings modal theme toggle (mirrors the topbar toggle)
settingsThemeToggle.addEventListener("click", async () => {
  ThemeManager.toggleTheme();
  await onThemeChange();
});

// ---- Settings modal ----
function openSettings() {
  settingsModal.classList.remove("hidden");
  updateActivePalette();
}

function closeSettings() {
  settingsModal.classList.add("hidden");
}

function updateActivePalette() {
  const current = ThemeManager.getPalette();
  for (const palette of PALETTES) {
    const btn = document.querySelector(`.settings-palette[data-palette="${palette}"]`);
    if (btn) btn.classList.toggle("active", palette === current);
  }
}

settingsBackdrop.addEventListener("click", closeSettings);
settingsCloseBtn.addEventListener("click", closeSettings);

// Palette selection in settings
const paletteButtons = [settingsPaletteWarm, settingsPaletteIndigo, settingsPaletteBlue];
for (const btn of paletteButtons) {
  if (!btn) continue;
  btn.addEventListener("click", () => {
    const palette = btn.getAttribute("data-palette");
    ThemeManager.setPalette(palette);
    updateActivePalette();
  });
}

// ---- Icon hydration ----
hydrateIcons();

// ---- Rendering pipeline ----

/**
 * Render the entire coursebook as a single continuous page.
 * Each chapter (and the landing page) is wrapped in a <section> with an id,
 * so scroll-spy can track which chapter is currently in view.
 */
async function renderAllChapters() {
  contentEl.innerHTML = "";

  // Build all sections: landing page (idx -1) + chapters (0..N-1)
  const sectionEls = [];

  // Landing page section
  const landingSection = document.createElement("section");
  landingSection.id = "overview";
  landingSection.className = "coursebook-section";
  landingSection.innerHTML = sanitizeHtml(
    renderMarkdown(sectionMarkdowns[0] ?? coursebook.markdown),
  );
  contentEl.appendChild(landingSection);
  sectionEls.push(landingSection);

  // Chapter sections
  for (let i = 0; i < coursebook.chapters.length; i++) {
    const sectionIdx = i + 1;
    const markdown = sectionMarkdowns[sectionIdx];
    if (!markdown) continue;

    const section = document.createElement("section");
    section.id = chapterSlug(coursebook.chapters[i].title);
    section.className = "coursebook-section";
    section.innerHTML = sanitizeHtml(renderMarkdown(markdown));
    contentEl.appendChild(section);
    sectionEls.push(section);
  }

  // Apply continuous section numbers across all headings.
  // Use computeSectionNumbersForSections so the landing page (section 0)
  // is left unnumbered and chapter 1 starts at "1".
  const sectionHeadingArrays = sectionEls.map((s) =>
    Array.from(s.querySelectorAll("h1, h2, h3")),
  );
  const numbersBySection = computeSectionNumbersForSections(sectionHeadingArrays);

  // Track used IDs to avoid duplicates across chapters
  const usedIds = new Set();
  for (let s = 0; s < sectionEls.length; s++) {
    const headings = sectionHeadingArrays[s];
    const numbers = numbersBySection[s];
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      // Ensure unique ID across all chapters
      if (!heading.id || usedIds.has(heading.id)) {
        let baseId = heading.id || slugifyForId(heading.textContent);
        let uniqueId = baseId;
        let suffix = 1;
        while (usedIds.has(uniqueId)) {
          uniqueId = `${baseId}-${suffix++}`;
        }
        heading.id = uniqueId;
      }
      usedIds.add(heading.id);
      applyHeadingNumber(heading, numbers[i]);
    }
  }

  // Build TOCs for all chapters
  buildAllTOCs();

  // Enhance content (Shiki, KaTeX, copy buttons, Mermaid)
  await ContentEnhancer.enhance(contentEl);

  // Set up navigator for presentation mode
  navigator = new SectionNavigator(contentEl);
  navigator.onNavigate = updateOverlay;
  navigator.setup();
}

/**
 * Render a single markdown document (standalone mode, no coursebook).
 */
async function renderSingleMarkdown(markdown) {
  currentMarkdown = markdown;
  contentEl.innerHTML = sanitizeHtml(renderMarkdown(markdown));

  const headings = Array.from(contentEl.querySelectorAll("h1, h2, h3"));
  const numbers = computeSectionNumbers(headings);
  for (let i = 0; i < headings.length; i++) {
    if (!headings[i].id) {
      headings[i].id = slugifyForId(headings[i].textContent);
    }
    applyHeadingNumber(headings[i], numbers[i]);
  }

  // Clear all chapter TOCs in standalone mode
  if (chapterListEl) chapterListEl.innerHTML = "";

  await ContentEnhancer.enhance(contentEl);

  navigator = new SectionNavigator(contentEl);
  navigator.onNavigate = updateOverlay;
  navigator.setup();

  previewPane.scrollTop = 0;
}

function updateOverlay(idx) {
  if (!navigator) return;
  overlayCurrent.textContent = navigator.currentText;
  const next = navigator.nextText;
  overlayNext.textContent = next ? "Next: " + next : "End of chapter";
  overlayProgress.textContent = idx + 1 + " / " + navigator.count;
}

// ---- Coursebook loading ----
async function initCoursebook() {
  try {
    coursebook = await loadCoursebook("docs/coursebook.md");
    chapterPaneTitle.textContent = coursebook.title;
    chapterTitleEl.textContent = coursebook.title;

    // Pre-load all chapter markdowns and heading data so section numbering is
    // continuous across the whole coursebook.
    await preloadSectionHeadings();

    buildChapterList();
    // Render all chapters as a continuous page
    await renderAllChapters();

    // If the URL has a hash, navigate to that section; otherwise start at top
    if (location.hash) {
      navigateFromHash();
    } else {
      currentChapterIdx = -1;
      updateActiveChapter();
      updateChapterNav();
      previewPane.scrollTop = 0;
    }
  } catch (e) {
    // No coursebook.md found — fall back to standalone mode
    console.warn("Coursebook not loaded, using standalone mode:", e.message);
    coursebook = null;
    sectionMarkdowns = [];
    sectionHeadings = [];
    sectionNumbers = [];
    chapterListEl.innerHTML = "";
    chapterPaneTitle.textContent = "Chapters";
    chapterTitleEl.textContent = "CoursebookMD";
    chapterNav.classList.add("hidden");
    await renderSingleMarkdown(DEFAULT_CONTENT);
  }
}

async function preloadSectionHeadings() {
  if (!coursebook) return;

  // Parent landing page is section 0
  sectionMarkdowns = [coursebook.markdown];
  sectionHeadings = [extractHeadingsFromMarkdown(coursebook.markdown)];

  // Chapters are sections 1..N. Use allSettled so a single missing chapter
  // does not prevent the whole coursebook from loading.
  const results = await Promise.allSettled(
    coursebook.chapters.map((chapter) => loadChapter(chapter.resolvedPath)),
  );
  for (const result of results) {
    if (result.status === "fulfilled") {
      sectionMarkdowns.push(result.value);
      sectionHeadings.push(extractHeadingsFromMarkdown(result.value));
    } else {
      sectionMarkdowns.push(null);
      sectionHeadings.push([]);
    }
  }

  sectionNumbers = computeSectionNumbersForSections(sectionHeadings);
}

function buildChapterList() {
  if (!coursebook || !chapterListEl) return;
  chapterListEl.innerHTML = "";

  // Add a "home" item for the landing page (with a nested TOC container)
  const homeWrapper = document.createElement("div");
  homeWrapper.className = "chapter-item-wrapper";
  homeWrapper.dataset.chapterIdx = "-1";

  const homeItem = document.createElement("button");
  homeItem.type = "button";
  homeItem.className = "chapter-item";
  const homeText = document.createElement("span");
  homeText.className = "chapter-item__text";
  homeText.textContent = "Course Overview";
  homeItem.appendChild(homeText);
  homeItem.addEventListener("click", () =>
    showLandingPage({ flash: true, skipHash: false }),
  );
  homeWrapper.appendChild(homeItem);

  const homeToc = document.createElement("nav");
  homeToc.className = "chapter-toc";
  homeWrapper.appendChild(homeToc);

  chapterListEl.appendChild(homeWrapper);

  coursebook.chapters.forEach((chapter, idx) => {
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
    textSpan.textContent = chapter.title;
    item.appendChild(textSpan);

    item.addEventListener("click", () => loadChapterByIdx(idx, { flash: true }));
    wrapper.appendChild(item);

    const toc = document.createElement("nav");
    toc.className = "chapter-toc";
    wrapper.appendChild(toc);

    chapterListEl.appendChild(wrapper);
  });
}

function updateActiveChapter() {
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

/** How far from the top of the preview pane a scrolled-to element should sit. */
const SCROLL_OFFSET = 80;

/**
 * Compute the preview pane's scrollTop that places `el` SCROLL_OFFSET px
 * below the top of the pane. Uses getBoundingClientRect so the math is
 * consistent with the scroll-spy (which also uses rects).
 * @param {HTMLElement} el
 * @returns {number}
 */
function scrollTopForElement(el) {
  const paneRect = previewPane.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  return previewPane.scrollTop + (elRect.top - paneRect.top) - SCROLL_OFFSET;
}

/**
 * Scroll to an element instantly (no smooth animation). Used for chapter-level
 * navigation. The caller is responsible for setting currentChapterIdx, sidebar
 * state, and hash — the scroll-spy is suppressed so it doesn't override them.
 * @param {HTMLElement} el
 */
function scrollToElInstant(el) {
  suppressScrollSpy = true;
  previewPane.scrollTop = scrollTopForElement(el);
  // Keep scroll-spy suppressed until after the queued scroll event fires
  requestAnimationFrame(() => {
    suppressScrollSpy = false;
  });
}

/**
 * Scroll to an element smoothly, suppressing scroll-spy during the animation.
 * Uses the scrollend event when available, with a fallback timeout.
 * @param {HTMLElement} el
 * @param {Function} [onSettled] - Called after scroll completes
 */
function scrollToElSmooth(el, onSettled) {
  suppressScrollSpy = true;
  previewPane.scrollTo({ top: scrollTopForElement(el), behavior: "smooth" });

  const reenable = () => {
    suppressScrollSpy = false;
    if (onSettled) onSettled();
  };

  // Prefer the scrollend event (fires when scroll animation completes)
  if ("onscrollend" in previewPane) {
    previewPane.addEventListener("scrollend", reenable, { once: true });
  } else {
    setTimeout(reenable, 600);
  }
}

/**
 * Scroll to the landing page section.
 */
function showLandingPage({ flash = false, skipHash = false } = {}) {
  if (!coursebook) return;
  currentChapterIdx = -1;
  chapterTitleEl.textContent = coursebook.title;
  updateActiveChapter();
  updateChapterNav();
  if (!skipHash) updateLocationHash();

  const section = contentEl.querySelector("#overview");
  if (section) {
    scrollToElInstant(section);
    if (flash) {
      const h1 = section.querySelector("h1");
      if (h1) flashHeading(h1);
    }
  }
}

/**
 * Scroll to a chapter section by index.
 */
function loadChapterByIdx(idx, { skipHash = false, flash = true } = {}) {
  if (!coursebook || idx < 0 || idx >= coursebook.chapters.length) return;

  currentChapterIdx = idx;
  const chapter = coursebook.chapters[idx];
  const title = getChapterTitle(sectionMarkdowns[idx + 1], chapter.title);
  chapterTitleEl.textContent = `${coursebook.title} — ${title}`;
  updateActiveChapter();
  updateChapterNav();
  if (!skipHash) updateLocationHash();

  const sectionId = chapterSlug(chapter.title);
  const section = contentEl.querySelector(`#${CSS.escape(sectionId)}`);
  if (section) {
    scrollToElInstant(section);
    if (flash) {
      const h1 = section.querySelector("h1");
      if (h1) flashHeading(h1);
    }
  }
}

/**
 * Get a URL-safe slug for a chapter title.
 * @param {string} title
 * @returns {string}
 */
function chapterSlug(title) {
  return slugifyForId(title);
}

/**
 * Get the chapter slug for the current chapter (or "overview").
 * @returns {string}
 */
function currentChapterSlug() {
  if (currentChapterIdx === -1) return "overview";
  return chapterSlug(coursebook.chapters[currentChapterIdx].title);
}

/**
 * Find the chapter index that matches a slug.
 * @param {string} slug
 * @returns {number} chapter index (0-based), or -1 for overview, or -2 if not found
 */
function findChapterIdxBySlug(slug) {
  if (slug === "overview") return -1;
  for (let i = 0; i < coursebook.chapters.length; i++) {
    if (chapterSlug(coursebook.chapters[i].title) === slug) return i;
  }
  return -2;
}

/**
 * Update the URL hash to reflect the current chapter (and optionally a heading).
 * Uses the shared formatLocationHash for the unified hash format.
 *
 * @param {string} [headingSlug] - Optional heading slug to append after /
 */
function updateLocationHash(headingSlug) {
  const hash = formatLocationHash(currentChapterSlug(), headingSlug);
  if (location.hash !== hash) {
    history.replaceState(null, "", hash);
  }
}

/**
 * Parse the current URL hash and navigate to the matching chapter + heading.
 * Uses the shared parseLocationHash for the unified hash format.
 */
function navigateFromHash() {
  if (!coursebook) return;
  const { chapterSlug, headingSlug } = parseLocationHash(location.hash.slice(1));
  if (!chapterSlug) return;

  const idx = findChapterIdxBySlug(chapterSlug);
  if (idx === -2) return; // unknown chapter

  // Update current chapter state
  currentChapterIdx = idx;
  if (idx === -1) {
    chapterTitleEl.textContent = coursebook.title;
  } else {
    const title = getChapterTitle(
      sectionMarkdowns[idx + 1],
      coursebook.chapters[idx].title,
    );
    chapterTitleEl.textContent = `${coursebook.title} — ${title}`;
  }
  updateActiveChapter();
  updateChapterNav();

  // Find the target element and navigate to it
  const section = contentEl.querySelector(`#${CSS.escape(chapterSlug)}`);
  if (!section) return;

  if (headingSlug) {
    const target = section.querySelector(`#${CSS.escape(headingSlug)}`);
    if (target) {
      // Smooth scroll for heading-level navigation (within a chapter)
      scrollToElSmooth(target, () => flashHeading(target));
      const hash = formatLocationHash(chapterSlug, headingSlug);
      if (location.hash !== hash) history.replaceState(null, "", hash);
    }
  } else {
    // Instant scroll for chapter-level navigation
    scrollToElInstant(section);
  }
}

window.addEventListener("hashchange", navigateFromHash);

function updateChapterNav() {
  if (!coursebook || coursebook.chapters.length === 0) {
    chapterNav.classList.add("hidden");
    return;
  }
  chapterNav.classList.remove("hidden");

  const hasPrev = currentChapterIdx >= 0;
  const hasNext =
    currentChapterIdx >= -1 && currentChapterIdx < coursebook.chapters.length - 1;

  prevChapterBtn.disabled = !hasPrev;
  nextChapterBtn.disabled = !hasNext;

  // Update labels
  if (hasPrev) {
    const prevIdx = currentChapterIdx - 1;
    const prevLabel = prevIdx >= 0 ? coursebook.chapters[prevIdx].title : "Overview";
    prevChapterBtn.querySelector(".chapter-nav__label").textContent = prevLabel;
  } else {
    prevChapterBtn.querySelector(".chapter-nav__label").textContent = "Previous";
  }

  if (hasNext) {
    const nextIdx = currentChapterIdx + 1;
    nextChapterBtn.querySelector(".chapter-nav__label").textContent =
      coursebook.chapters[nextIdx].title;
  } else {
    nextChapterBtn.querySelector(".chapter-nav__label").textContent = "Next";
  }
}

prevChapterBtn.addEventListener("click", () => {
  if (currentChapterIdx > 0) {
    loadChapterByIdx(currentChapterIdx - 1);
  } else if (currentChapterIdx === 0) {
    showLandingPage({ flash: true });
  }
});

nextChapterBtn.addEventListener("click", () => {
  if (currentChapterIdx === -1) {
    loadChapterByIdx(0);
  } else if (currentChapterIdx < coursebook.chapters.length - 1) {
    loadChapterByIdx(currentChapterIdx + 1);
  }
});

// ---- Table of Contents ----

/**
 * Build TOC items for all chapters at once. Each chapter's TOC is populated
 * from the headings inside its <section> element.
 */
function buildAllTOCs() {
  if (!coursebook || !chapterListEl) return;

  // Landing page TOC (idx -1)
  buildChapterToc(-1, "overview");

  // Chapter TOCs
  for (let i = 0; i < coursebook.chapters.length; i++) {
    buildChapterToc(i, chapterSlug(coursebook.chapters[i].title));
  }
}

/**
 * Build the TOC for a single chapter by scanning headings in its section.
 * Uses the shared extractTocItems for heading data extraction.
 * @param {number} chapterIdx - Chapter index (-1 for overview)
 * @param {string} sectionId - The section element's id
 */
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
        scrollToElSmooth(headingEl, () => flashHeading(headingEl));
        const hash = formatLocationHash(sectionId, item.id);
        if (location.hash !== hash) history.replaceState(null, "", hash);
      }
    });
    tocContainer.appendChild(btn);
  }
}

/**
 * Get the TOC container for the currently active chapter.
 * @returns {HTMLElement | null}
 */
function getCurrentChapterToc() {
  if (!chapterListEl) return null;
  const selector = `.chapter-item-wrapper[data-chapter-idx="${currentChapterIdx}"] .chapter-toc`;
  return chapterListEl.querySelector(selector);
}

// ---- TOC collapse ----
tocToggleBtn.addEventListener("click", () => {
  tocPane.classList.toggle("collapsed");
  const collapsed = tocPane.classList.contains("collapsed");
  tocToggleBtn.setAttribute(
    "aria-label",
    collapsed ? "Expand contents" : "Collapse contents",
  );
  tocToggleBtn.setAttribute("title", collapsed ? "Expand" : "Collapse");
});

// ---- Scroll spy: highlight current TOC item ----
let scrollSpyTimer = null;

previewPane.addEventListener("scroll", () => {
  if (suppressScrollSpy) return;
  if (scrollSpyTimer) cancelAnimationFrame(scrollSpyTimer);
  scrollSpyTimer = requestAnimationFrame(updateScrollSpy);
});

/**
 * Scroll spy: detect which chapter section is currently in view and update
 * the sidebar (active chapter + active TOC item) accordingly.
 */
function updateScrollSpy() {
  if (!coursebook) return;

  const sections = Array.from(contentEl.querySelectorAll(".coursebook-section"));
  if (sections.length === 0) return;

  // Use rect math consistent with scrollTopForElement: a section is "active"
  // when its top is within SCROLL_OFFSET px of the pane's top (or above it).
  const paneRect = previewPane.getBoundingClientRect();

  // Find the section closest to the top
  let activeSectionIdx = 0;
  for (let i = 0; i < sections.length; i++) {
    const sectionTop = sections[i].getBoundingClientRect().top;
    if (sectionTop - paneRect.top <= SCROLL_OFFSET) {
      activeSectionIdx = i;
    } else {
      break;
    }
  }

  // Map section index to chapter index (-1 for overview, 0..N-1 for chapters)
  const newChapterIdx = activeSectionIdx === 0 ? -1 : activeSectionIdx - 1;
  if (newChapterIdx !== currentChapterIdx) {
    currentChapterIdx = newChapterIdx;
    updateActiveChapter();
    updateChapterNav();
    updateLocationHash();
  }

  // Update active TOC item within the current chapter
  const tocContainer = getCurrentChapterToc();
  if (!tocContainer) return;

  const activeSection = sections[activeSectionIdx];
  const headings = Array.from(activeSection.querySelectorAll("h2, h3"));
  let activeHeadingIdx = -1;
  for (let i = 0; i < headings.length; i++) {
    const headingTop = headings[i].getBoundingClientRect().top;
    if (headingTop - paneRect.top <= SCROLL_OFFSET) {
      activeHeadingIdx = i;
    } else {
      break;
    }
  }

  const items = tocContainer.querySelectorAll(".toc-item");
  items.forEach((item, i) => item.classList.toggle("active", i === activeHeadingIdx));
}

// ---- Editor ----
function setEditMode(on) {
  editMode = on;
  editorPane.classList.toggle("hidden", !on);
  toggleEditLabel.textContent = on ? "Preview" : "Edit";
  if (on) {
    // Load the current chapter's markdown into the editor
    const sectionIdx = currentChapterIdx + 1;
    editorEl.value =
      coursebook && sectionMarkdowns[sectionIdx] !== undefined
        ? sectionMarkdowns[sectionIdx]
        : currentMarkdown;
    editorEl.focus();
  }
}

editorEl.addEventListener("input", () => {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(async () => {
    const markdown = editorEl.value;
    const sectionIdx = currentChapterIdx + 1;
    if (coursebook && sectionMarkdowns[sectionIdx] !== undefined) {
      sectionMarkdowns[sectionIdx] = markdown;
      sectionHeadings[sectionIdx] = extractHeadingsFromMarkdown(markdown);
      sectionNumbers = computeSectionNumbersForSections(sectionHeadings);

      // Re-render just the current section in-place
      const sectionId =
        currentChapterIdx === -1
          ? "overview"
          : chapterSlug(coursebook.chapters[currentChapterIdx].title);
      const section = contentEl.querySelector(`#${CSS.escape(sectionId)}`);
      if (section) {
        const scrollTop = previewPane.scrollTop;
        section.innerHTML = sanitizeHtml(renderMarkdown(markdown));

        // Re-apply section numbers to the updated headings
        const headings = Array.from(section.querySelectorAll("h1, h2, h3"));
        const numbers = sectionNumbers[sectionIdx] ?? computeSectionNumbers(headings);
        // Collect IDs from other sections to avoid duplicates
        const otherIds = new Set();
        contentEl
          .querySelectorAll(`.coursebook-section:not(#${CSS.escape(sectionId)}) [id]`)
          .forEach((el) => otherIds.add(el.id));
        for (let i = 0; i < headings.length; i++) {
          if (!headings[i].id || otherIds.has(headings[i].id)) {
            let baseId = headings[i].id || slugifyForId(headings[i].textContent);
            let uniqueId = baseId;
            let suffix = 1;
            while (otherIds.has(uniqueId)) {
              uniqueId = `${baseId}-${suffix++}`;
            }
            headings[i].id = uniqueId;
          }
          applyHeadingNumber(headings[i], numbers[i]);
        }

        // Rebuild the current chapter's TOC
        buildChapterToc(currentChapterIdx, sectionId);

        // Re-enhance the updated section
        await ContentEnhancer.enhance(section);
        previewPane.scrollTop = scrollTop;
      }
    } else {
      // Standalone mode
      currentMarkdown = markdown;
      await renderSingleMarkdown(markdown);
    }
  }, 300);
});

toggleEditBtn.addEventListener("click", () => setEditMode(!editMode));
menuToggleEditBtn.addEventListener("click", () => {
  setEditMode(!editMode);
  closeMenu();
});

// ---- Menu dropdown ----
function toggleMenu() {
  const isHidden = menuDropdown.classList.contains("hidden");
  closeMenu();
  if (isHidden) {
    menuDropdown.classList.remove("hidden");
    menuBtn.setAttribute("aria-expanded", "true");
  }
}

function closeMenu() {
  menuDropdown.classList.add("hidden");
  menuBtn.setAttribute("aria-expanded", "false");
}

menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMenu();
});

document.addEventListener("click", (e) => {
  if (!menuDropdown.classList.contains("hidden")) {
    if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
      closeMenu();
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!settingsModal.classList.contains("hidden")) {
      closeSettings();
    } else if (!menuDropdown.classList.contains("hidden")) {
      closeMenu();
    }
  }
});

// ---- Presentation mode ----
function enterPresent() {
  document.body.classList.add("presenting");
  if (navigator?.spotlight) document.body.classList.add("spotlight");

  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }

  // Wait for layout to settle (fullscreen + CSS transitions) before scrolling.
  // Without this, scrollIntoView fires against the old layout and the heading
  // ends up out of view.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      navigator?.navigateTo(0, { instant: true });
    });
  });
}

function exitPresent() {
  document.body.classList.remove("presenting", "spotlight");
  navigator?.clearHighlight();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

presentBtn.addEventListener("click", enterPresent);
toggleFullscreenBtn.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});

document.addEventListener("keydown", (e) => {
  // Don't intercept when typing in the editor
  if (e.target === editorEl) return;

  if (!document.body.classList.contains("presenting")) {
    if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      enterPresent();
    } else if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      setEditMode(!editMode);
    } else if (e.key === "d" || e.key === "D") {
      e.preventDefault();
      ThemeManager.toggleTheme();
      onThemeChange();
    }
    return;
  }

  switch (e.key) {
    case "ArrowRight":
    case " ":
    case "PageDown":
      e.preventDefault();
      navigator?.next();
      break;
    case "ArrowLeft":
    case "PageUp":
      e.preventDefault();
      navigator?.prev();
      break;
    case "Home":
      e.preventDefault();
      navigator?.first();
      break;
    case "End":
      e.preventDefault();
      navigator?.last();
      break;
    case "s":
    case "S":
      e.preventDefault();
      navigator?.toggleSpotlight();
      break;
    case "Escape":
      e.preventDefault();
      exitPresent();
      break;
  }
});

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && document.body.classList.contains("presenting")) {
    exitPresent();
  }
});

// ---- File operations ----
function openFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".md,.markdown,.txt";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    editorEl.value = text;
    await renderSingleMarkdown(text);
    chapterTitleEl.textContent = file.name;
    // Clear chapter context when opening a standalone file
    coursebook = null;
    currentChapterIdx = -1;
    chapterListEl.innerHTML = "";
    chapterPaneTitle.textContent = "Chapters";
    chapterNav.classList.add("hidden");
  };
  input.click();
}

async function exportHtml() {
  let html;
  let filename;
  if (coursebook) {
    html = await exportCoursebookHtml(coursebook);
    filename = coursebook.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".html";
  } else {
    // Use editor value directly when in edit mode to capture latest edits
    const markdown = editMode ? editorEl.value : currentMarkdown;
    html = await exportSingleHtml(chapterTitleEl.textContent, markdown);
    filename = "chapter.html";
  }
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

menuOpenFileBtn.addEventListener("click", () => {
  openFile();
  closeMenu();
});

menuExportHtmlBtn.addEventListener("click", async () => {
  await exportHtml();
  closeMenu();
});

menuSettingsBtn.addEventListener("click", () => {
  closeMenu();
  openSettings();
});

// ---- Initial load ----
initCoursebook();

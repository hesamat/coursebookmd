/**
 * app.js — Application entry point.
 * Wires together coursebook loading, theme management, icon hydration,
 * menu dropdowns, the editor, renderer, navigator, and presentation mode.
 */
import { renderMarkdown } from "./renderer/markdown-renderer.js";
import { ContentEnhancer } from "./renderer/content-enhancer.js";
import { SectionNavigator } from "./navigator/section-navigator.js";
import { ThemeManager, PALETTES } from "./core/theme-manager.js";
import { hydrateIcons } from "./core/icon.js";
import { computeSectionNumbers } from "./core/section-numbering.js";
import {
  loadCoursebook,
  loadChapter,
  getChapterTitle,
} from "./core/coursebook-loader.js";
import {
  exportCoursebookHtml,
  exportSingleHtml,
} from "./renderer/coursebook-exporter.js";
import DOMPurify from "dompurify";

const DEFAULT_CONTENT = `# Welcome to coursebookmd

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
const menuNewBtn = document.getElementById("menuNewBtn");
const menuToggleEditBtn = document.getElementById("menuToggleEditBtn");
const menuSaveBtn = document.getElementById("menuSaveBtn");
const menuReloadBtn = document.getElementById("menuReloadBtn");
const menuExportHtmlBtn = document.getElementById("menuExportHtmlBtn");
const menuSettingsBtn = document.getElementById("menuSettingsBtn");
const overlayCurrent = document.getElementById("overlayCurrent");
const overlayNext = document.getElementById("overlayNext");
const overlayProgress = document.getElementById("overlayProgress");
const tocEl = document.getElementById("toc");
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

/** @type {import("./core/coursebook-loader.js").Coursebook | null} */
let coursebook = null;
let currentChapterIdx = -1; // -1 means parent/landing page

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
async function renderAndEnhance(markdown) {
  currentMarkdown = markdown;
  const html = renderMarkdown(markdown);
  contentEl.innerHTML = DOMPurify.sanitize(html);

  navigator = new SectionNavigator(contentEl);
  navigator.onNavigate = updateOverlay;
  navigator.setup();

  buildTOC();

  await ContentEnhancer.enhance(contentEl);

  // Scroll to top on new content
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
    coursebook = await loadCoursebook("content/coursebook.md");
    chapterPaneTitle.textContent = coursebook.title;
    chapterTitleEl.textContent = coursebook.title;
    buildChapterList();
    // Load the parent landing page by default
    await showLandingPage();
  } catch (e) {
    // No coursebook.md found — fall back to standalone mode
    console.warn("Coursebook not loaded, using standalone mode:", e.message);
    coursebook = null;
    chapterListEl.innerHTML = "";
    chapterPaneTitle.textContent = "Chapters";
    chapterTitleEl.textContent = "coursebookmd";
    chapterNav.classList.add("hidden");
    await renderAndEnhance(DEFAULT_CONTENT);
  }
}

function buildChapterList() {
  if (!coursebook || !chapterListEl) return;
  chapterListEl.innerHTML = "";

  // Add a "home" item for the landing page
  const homeItem = document.createElement("button");
  homeItem.type = "button";
  homeItem.className = "chapter-item";
  const homeText = document.createElement("span");
  homeText.className = "chapter-item__text";
  homeText.textContent = "Course Overview";
  homeItem.appendChild(homeText);
  homeItem.addEventListener("click", () => showLandingPage());
  chapterListEl.appendChild(homeItem);

  coursebook.chapters.forEach((chapter, idx) => {
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

    item.addEventListener("click", () => loadChapterByIdx(idx));
    chapterListEl.appendChild(item);
  });
}

function updateActiveChapter() {
  const items = chapterListEl.querySelectorAll(".chapter-item");
  items.forEach((item, i) => {
    // i=0 is the "home" item, chapters start at i=1
    const isActive = i === 0 ? currentChapterIdx === -1 : i - 1 === currentChapterIdx;
    item.classList.toggle("active", isActive);
  });
}

async function showLandingPage() {
  if (!coursebook) return;
  currentChapterIdx = -1;
  chapterTitleEl.textContent = coursebook.title;
  updateActiveChapter();
  updateChapterNav();
  await renderAndEnhance(coursebook.markdown);
}

async function loadChapterByIdx(idx) {
  if (!coursebook || idx < 0 || idx >= coursebook.chapters.length) return;
  if (currentChapterIdx === idx) return; // already loaded

  const chapter = coursebook.chapters[idx];

  // Disable nav buttons during load to prevent race conditions
  prevChapterBtn.disabled = true;
  nextChapterBtn.disabled = true;

  try {
    const markdown = await loadChapter(chapter.resolvedPath);
    currentChapterIdx = idx;
    const title = getChapterTitle(markdown, chapter.title);
    chapterTitleEl.textContent = `${coursebook.title} — ${title}`;
    updateActiveChapter();
    updateChapterNav();
    await renderAndEnhance(markdown);
  } catch (e) {
    console.error("Failed to load chapter:", e);
    chapterTitleEl.textContent = "Failed to load chapter";
  }
}

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
    showLandingPage();
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
function buildTOC() {
  if (!tocEl || !navigator) return;
  tocEl.innerHTML = "";

  const headings = Array.from(contentEl.querySelectorAll("h1, h2, h3"));
  if (headings.length === 0) return;

  // Clean up any existing heading-number spans from previous builds
  for (const heading of headings) {
    const existingNum = heading.querySelector(".heading-number");
    if (existingNum) existingNum.remove();
    delete heading.dataset.numbered;
  }

  // Compute section numbers for all headings
  const numbers = computeSectionNumbers(headings);

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const num = numbers[i];

    // Ensure each heading has an id for anchor navigation
    if (!heading.id) {
      heading.id = heading.textContent
        .trim()
        .toLowerCase()
        .replace(/[^\w]+/g, "-")
        .replace(/^-+|-+$/g, "");
    }

    // Prepend number to the heading text in the content
    if (num && !heading.dataset.numbered) {
      const numSpan = document.createElement("span");
      numSpan.className = "heading-number";
      numSpan.textContent = num + " ";
      heading.insertBefore(numSpan, heading.firstChild);
      heading.dataset.numbered = "true";
    }

    // Extract heading text without the number span for the TOC
    const numSpanEl = heading.querySelector(".heading-number");
    const headingText = numSpanEl
      ? heading.textContent.replace(numSpanEl.textContent, "").trim()
      : heading.textContent.trim();

    // Build TOC item with matching number
    const level = heading.tagName.toLowerCase();
    const item = document.createElement("button");
    item.type = "button";
    item.className = `toc-item toc-item--${level}`;
    item.setAttribute("data-target", heading.id);

    if (num) {
      const tocNumSpan = document.createElement("span");
      tocNumSpan.className = "toc-number";
      tocNumSpan.textContent = num;
      item.appendChild(tocNumSpan);
      item.appendChild(document.createTextNode(" " + headingText));
    } else {
      item.textContent = headingText;
    }

    item.addEventListener("click", () => {
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    tocEl.appendChild(item);
  }
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
  if (scrollSpyTimer) cancelAnimationFrame(scrollSpyTimer);
  scrollSpyTimer = requestAnimationFrame(updateActiveTOCItem);
});

function updateActiveTOCItem() {
  if (!tocEl || !navigator) return;
  const headings = Array.from(contentEl.querySelectorAll("h1, h2, h3"));
  if (headings.length === 0) return;

  // Find the heading closest to the top of the viewport
  const scrollTop = previewPane.scrollTop;
  const offset = 80; // account for topbar
  let activeIdx = 0;

  for (let i = 0; i < headings.length; i++) {
    if (headings[i].offsetTop - offset <= scrollTop) {
      activeIdx = i;
    } else {
      break;
    }
  }

  const items = tocEl.querySelectorAll(".toc-item");
  items.forEach((item, i) => item.classList.toggle("active", i === activeIdx));
}

// ---- Editor ----
function setEditMode(on) {
  editMode = on;
  editorPane.classList.toggle("hidden", !on);
  toggleEditLabel.textContent = on ? "Preview" : "Edit";
  if (on) {
    editorEl.value = currentMarkdown;
    editorEl.focus();
  }
}

editorEl.addEventListener("input", () => {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderAndEnhance(editorEl.value), 300);
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
    await renderAndEnhance(text);
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

function saveFile() {
  const blob = new Blob([currentMarkdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "chapter.md";
  a.click();
  URL.revokeObjectURL(url);
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

menuNewBtn.addEventListener("click", () => {
  editorEl.value = DEFAULT_CONTENT;
  renderAndEnhance(DEFAULT_CONTENT);
  chapterTitleEl.textContent = "coursebookmd";
  coursebook = null;
  currentChapterIdx = -1;
  chapterListEl.innerHTML = "";
  chapterPaneTitle.textContent = "Chapters";
  chapterNav.classList.add("hidden");
  closeMenu();
});

menuSaveBtn.addEventListener("click", () => {
  saveFile();
  closeMenu();
});

menuReloadBtn.addEventListener("click", () => {
  if (coursebook && currentChapterIdx >= 0) {
    loadChapterByIdx(currentChapterIdx);
  } else if (coursebook && currentChapterIdx === -1) {
    showLandingPage();
  } else {
    renderAndEnhance(currentMarkdown);
  }
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

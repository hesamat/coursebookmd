/**
 * menu-controller.js — Sidebar chapter list, chapter nav, and menu dropdown
 * behavior, composed by app.js via injected dependencies. Controllers never
 * import each other; cross-controller calls are routed through deps.
 */
import { isMacPlatform, slugifyForId } from "../core/utils.js";
import { loadCollapsedGroups, createGroupElement } from "../core/nav-groups.js";

export function createMenuController(deps) {
  const { state, navigate } = deps;

  function buildChapterList() {
    if (!state.coursebook || !state.chapterListEl) return;
    state.chapterListEl.innerHTML = "";

    const collapsedGroups = loadCollapsedGroups();

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
    homeItem.addEventListener("click", () => navigate.showLandingPage());
    homeWrapper.appendChild(homeItem);

    const homeToc = document.createElement("nav");
    homeToc.className = "chapter-toc";
    homeWrapper.appendChild(homeToc);

    state.chapterListEl.appendChild(homeWrapper);

    // Render the navigation structure: unnumbered group labels (e.g. weeks)
    // followed by their chapters. Falls back to all chapters in order.
    const navEntries = state.coursebook.nav?.length
      ? state.coursebook.nav
      : state.coursebook.chapters.map((_, idx) => ({ type: "chapter", index: idx }));

    let currentGroup = null;
    let groupIdx = 0;
    for (const entry of navEntries) {
      if (entry.type === "group") {
        const groupKey = `${slugifyForId(entry.title)}-${groupIdx}`;
        groupIdx++;
        const group = createGroupElement(entry.title, collapsedGroups, groupKey);
        state.chapterListEl.appendChild(group);
        currentGroup = group;
        continue;
      }

      const idx = entry.index;
      const chapter = state.coursebook.chapters[idx];
      if (!chapter) continue;

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

      item.addEventListener("click", () => navigate.loadChapterByIdx(idx));
      wrapper.appendChild(item);

      const toc = document.createElement("nav");
      toc.className = "chapter-toc";
      wrapper.appendChild(toc);

      if (currentGroup) {
        currentGroup.appendChild(wrapper);
      } else {
        state.chapterListEl.appendChild(wrapper);
      }
    }

    // General index entry (trailing section, outside the chapter numbering).
    const indexItem = document.createElement("button");
    indexItem.type = "button";
    indexItem.className = "chapter-item index-nav-item";
    const indexText = document.createElement("span");
    indexText.className = "chapter-item__text";
    indexText.textContent = "Index";
    indexItem.appendChild(indexText);
    indexItem.addEventListener("click", () => navigate.showIndexPage());
    state.chapterListEl.appendChild(indexItem);
  }

  /**
   * Keep the sidebar's Index entry in sync with the generated index section:
   * shown only when the coursebook actually contains indexed terms. Runs
   * after rebuildIndexSection (inside renderAllChapters), so the DOM truth
   * about term anchors exists — buildChapterList runs before rendering and
   * cannot know.
   */
  function syncIndexNavItem() {
    state.chapterListEl.querySelector(".index-nav-item")?.remove();
    const indexSection = state.contentEl.querySelector("#index");
    if (!indexSection || !indexSection.querySelector(".idx-link")) return;

    const indexItem = document.createElement("button");
    indexItem.type = "button";
    indexItem.className = "chapter-item index-nav-item";
    const indexText = document.createElement("span");
    indexText.className = "chapter-item__text";
    indexText.textContent = "Index";
    indexItem.appendChild(indexText);
    indexItem.addEventListener("click", () => navigate.showIndexPage());
    state.chapterListEl.appendChild(indexItem);
  }

  function updateActiveChapter() {
    const wrappers = state.chapterListEl.querySelectorAll(".chapter-item-wrapper");
    wrappers.forEach((wrapper) => {
      const idx = parseInt(wrapper.dataset.chapterIdx, 10);
      const isActive = idx === state.currentChapterIdx;
      const item = wrapper.querySelector(".chapter-item");
      const toc = wrapper.querySelector(".chapter-toc");
      if (item) item.classList.toggle("active", isActive);
      if (toc) toc.classList.toggle("is-open", isActive);
    });
  }

  function updateChapterNav() {
    if (!state.coursebook || state.coursebook.chapters.length === 0) {
      state.chapterNav.classList.add("hidden");
      return;
    }
    state.chapterNav.classList.remove("hidden");

    const hasPrev = state.currentChapterIdx >= 0;
    const hasNext =
      state.currentChapterIdx >= -1 &&
      state.currentChapterIdx < state.coursebook.chapters.length - 1;

    state.prevChapterBtn.disabled = !hasPrev;
    state.nextChapterBtn.disabled = !hasNext;

    // Update tooltips only — the visible label is always a short
    // "← Previous" / "Next →" so it doesn't compete with the chapter content.
    if (hasPrev) {
      const prevIdx = state.currentChapterIdx - 1;
      const prevLabel =
        prevIdx >= 0 ? state.coursebook.chapters[prevIdx].title : "Overview";
      state.prevChapterBtn.title = `Previous: ${prevLabel}`;
      state.prevChapterBtn.setAttribute("aria-label", `Previous chapter: ${prevLabel}`);
    } else {
      state.prevChapterBtn.title = "No previous chapter";
      state.prevChapterBtn.setAttribute("aria-label", "No previous chapter");
    }

    if (hasNext) {
      const nextIdx = state.currentChapterIdx + 1;
      const nextLabel = state.coursebook.chapters[nextIdx].title;
      state.nextChapterBtn.title = `Next: ${nextLabel}`;
      state.nextChapterBtn.setAttribute("aria-label", `Next chapter: ${nextLabel}`);
    } else {
      state.nextChapterBtn.title = "No next chapter";
      state.nextChapterBtn.setAttribute("aria-label", "No next chapter");
    }
  }

  function goPrevChapter() {
    if (state.currentChapterIdx > 0) {
      navigate.loadChapterByIdx(state.currentChapterIdx - 1);
    } else if (state.currentChapterIdx === 0) {
      navigate.showLandingPage();
    }
  }

  function goNextChapter() {
    if (state.currentChapterIdx === -1) {
      navigate.loadChapterByIdx(0);
    } else if (state.currentChapterIdx < state.coursebook.chapters.length - 1) {
      navigate.loadChapterByIdx(state.currentChapterIdx + 1);
    }
  }

  function toggleMenu() {
    const isHidden = state.menuDropdown.classList.contains("hidden");
    closeMenu();
    if (isHidden) {
      state.menuDropdown.classList.remove("hidden");
      state.menuBtn.setAttribute("aria-expanded", "true");
    }
  }

  function closeMenu() {
    state.menuDropdown.classList.add("hidden");
    state.menuBtn.setAttribute("aria-expanded", "false");
  }

  function updateShortcutTooltips() {
    const mod = isMacPlatform ? "⌘+⌃" : "Ctrl+Alt";
    if (state.presentBtn) state.presentBtn.title = `Present (${mod}+P)`;
    if (state.toggleEditBtn) state.toggleEditBtn.title = `Toggle Editor (${mod}+E)`;
    if (state.themeToggleBtn) state.themeToggleBtn.title = `Toggle Dark Mode (${mod}+I)`;
    if (state.settingsThemeToggle)
      state.settingsThemeToggle.title = `Toggle Dark Mode (${mod}+I)`;
    const menuEditHint = document.getElementById("menuEditHint");
    if (menuEditHint) menuEditHint.textContent = `${mod}+E`;
    if (state.menuSaveHint)
      state.menuSaveHint.textContent = isMacPlatform ? "⌘+S" : "Ctrl+S";
  }

  return {
    buildChapterList,
    syncIndexNavItem,
    updateActiveChapter,
    updateChapterNav,
    goPrevChapter,
    goNextChapter,
    toggleMenu,
    closeMenu,
    updateShortcutTooltips,
  };
}

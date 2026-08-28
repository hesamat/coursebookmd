import { describe, it, expect, beforeEach } from "vitest";
import { SectionNavigator } from "../navigator/section-navigator.js";

describe("SectionNavigator", () => {
  let contentEl;

  beforeEach(() => {
    contentEl = document.createElement("div");
    document.body.classList.remove("presenting");
    // jsdom does not implement scrollIntoView.
    if (!window.HTMLElement.prototype.scrollIntoView) {
      window.HTMLElement.prototype.scrollIntoView = () => {};
    }
  });

  function buildSection(active = false) {
    const section = document.createElement("section");
    section.className = "coursebook-section" + (active ? " active" : "");
    section.id = "chapter-one";
    const h1 = document.createElement("h1");
    h1.textContent = "Chapter One";
    const h2 = document.createElement("h2");
    h2.textContent = "Section A";
    section.appendChild(h1);
    section.appendChild(h2);
    contentEl.appendChild(section);
    return section;
  }

  it("resets currentIdx to 0 after setup in presentation mode", () => {
    buildSection(true);
    document.body.classList.add("presenting");

    const navigator = new SectionNavigator(contentEl, contentEl);
    navigator.currentIdx = 5;
    navigator.setup();

    expect(navigator.currentIdx).toBe(0);
    expect(navigator.current).toBe(navigator.headings[0]);
  });

  it("resets currentIdx to 0 after setup even outside presentation mode", () => {
    buildSection(true);

    const navigator = new SectionNavigator(contentEl, contentEl);
    navigator.currentIdx = 5;
    navigator.setup();

    expect(navigator.currentIdx).toBe(0);
  });

  it("next() does not get stuck after setup() when the previous currentIdx was out of range", () => {
    buildSection(true);
    document.body.classList.add("presenting");

    const navigator = new SectionNavigator(contentEl, contentEl);
    navigator.currentIdx = 99;
    navigator.setup();

    // After reset, next should move from h1 to the first h2.
    const before = navigator.currentIdx;
    navigator.next({ syncVisual: false });
    expect(navigator.currentIdx).toBe(before + 1);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { addGoUpLinks, addReadingAids } from "../core/reading-aids.js";
import { extractTocItems } from "../core/toc-data.js";
import { applyHeadingNumber } from "../core/section-numbering.js";
import { SectionNavigator } from "../navigator/section-navigator.js";

function buildSection() {
  const section = document.createElement("section");
  section.className = "coursebook-section";
  section.id = "chapter-one";
  section.innerHTML = `
    <h1 id="chapter-one-title">Chapter One</h1>
    <p>Intro</p>
    <h2 id="first-topic">First Topic</h2>
    <p>First body</p>
    <h3 id="first-sub">Subsection</h3>
    <h2 id="mandatory-topic" class="mandatory">Mandatory Topic</h2>
    <p>Second body</p>
  `;
  // Numbers as the pipelines apply them before injecting reading aids.
  applyHeadingNumber(section.querySelector("h1"), "1");
  applyHeadingNumber(section.querySelector("#first-topic"), "1.1");
  applyHeadingNumber(section.querySelector("#first-sub"), "1.1.1");
  applyHeadingNumber(section.querySelector("#mandatory-topic"), "1.2");
  return section;
}

describe("reading aids — go-up links", () => {
  let section;

  beforeEach(() => {
    section = buildSection();
  });

  it("inserts a link after each H2 without touching heading text", () => {
    addGoUpLinks(section);
    const h2s = section.querySelectorAll("h2");
    expect(h2s.length).toBe(2);
    for (const h2 of h2s) {
      const btn = h2.nextElementSibling;
      expect(btn).not.toBeNull();
      expect(btn.classList.contains("go-up-link")).toBe(true);
      expect(btn.getAttribute("aria-label")).toBe("Back to chapter top");
      expect(btn.textContent).toBe("▲");
      expect(btn.getAttribute("type")).toBe("button");
    }
    expect(section.querySelector("#first-topic").textContent).toBe("1.1 First Topic");
    expect(section.querySelector("#first-topic").classList.contains("mandatory")).toBe(
      false,
    );
    expect(
      section.querySelector("#mandatory-topic").classList.contains("mandatory"),
    ).toBe(true);
  });

  it("does not duplicate links on a second call", () => {
    addGoUpLinks(section);
    addGoUpLinks(section);
    expect(section.querySelectorAll(".go-up-link").length).toBe(2);
  });
});

describe("reading aids — integration with existing pipelines", () => {
  let section;

  beforeEach(() => {
    section = buildSection();
    if (!window.HTMLElement.prototype.scrollIntoView) {
      window.HTMLElement.prototype.scrollIntoView = () => {};
    }
  });

  it("does not change scroll-spy heading sets or extractTocItems", () => {
    const headingsBefore = Array.from(section.querySelectorAll("h2, h3"));
    const tocBefore = extractTocItems(section);
    addReadingAids(section);
    const headingsAfter = Array.from(section.querySelectorAll("h2, h3"));
    expect(headingsAfter).toEqual(headingsBefore);
    expect(extractTocItems(section)).toEqual(tocBefore);
  });

  it("keeps SectionNavigator wrapping and waypoints working", () => {
    const contentEl = document.createElement("div");
    contentEl.appendChild(section);
    addReadingAids(section);

    const navigator = new SectionNavigator(contentEl, contentEl);
    navigator.setup();

    // Waypoints are still exactly the h1 + h2s; the aids add none.
    expect(navigator.headings.map((h) => h.tagName)).toEqual(["H1", "H2", "H2"]);
    // The links did not trip the already-wrapped guard: h2 subsections exist.
    expect(section.querySelectorAll(":scope > section").length).toBe(3);
    // The links ride along with their H2 into the subsections.
    expect(section.querySelectorAll(".go-up-link").length).toBe(2);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { addInChapterToc, addGoUpLinks, addReadingAids } from "../core/reading-aids.js";
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

describe("reading aids — in-chapter TOC box", () => {
  let section;

  beforeEach(() => {
    section = buildSection();
  });

  it("creates a nav box as the section's first child", () => {
    const box = addInChapterToc(section);
    expect(box).not.toBeNull();
    expect(box.tagName).toBe("NAV");
    expect(box.getAttribute("aria-label")).toBe("In this chapter");
    expect(section.firstElementChild).toBe(box);
    expect(box.querySelector(".in-chapter-toc__title").textContent).toBe(
      "In this Chapter",
    );
  });

  it("lists only the H2s, with number and data-target", () => {
    const box = addInChapterToc(section);
    const items = box.querySelectorAll(".in-chapter-toc__item");
    expect(items.length).toBe(2);
    expect(items[0].getAttribute("data-target")).toBe("first-topic");
    expect(items[0].querySelector(".in-chapter-toc__number").textContent).toBe("1.1");
    expect(items[0].textContent).toBe("1.1 First Topic");
    // Mandatory H2s are listed like any other.
    expect(items[1].getAttribute("data-target")).toBe("mandatory-topic");
    expect(items[1].querySelector(".in-chapter-toc__number").textContent).toBe("1.2");
    expect(items[1].textContent).toBe("1.2 Mandatory Topic");
  });

  it("has no heading descendants and is not a <section>", () => {
    const box = addInChapterToc(section);
    expect(box.tagName).not.toBe("SECTION");
    expect(box.querySelectorAll("h1, h2, h3").length).toBe(0);
  });

  it("is remove-and-recreate: rebuild reflects changed numbers", () => {
    addInChapterToc(section);
    applyHeadingNumber(section.querySelector("#first-topic"), "9.9");
    const box = addInChapterToc(section);
    const boxes = section.querySelectorAll(".in-chapter-toc");
    expect(boxes.length).toBe(1);
    expect(boxes[0]).toBe(box);
    expect(box.querySelector(".in-chapter-toc__number").textContent).toBe("9.9");
  });

  it("skips the box when the section has no H2s", () => {
    const plain = document.createElement("section");
    plain.innerHTML = "<h1>Only a title</h1><p>Body</p>";
    expect(addInChapterToc(plain)).toBeNull();
    expect(plain.querySelector(".in-chapter-toc")).toBeNull();
  });

  it("omits the number span for unnumbered H2s (no leading space)", () => {
    const landing = document.createElement("section");
    landing.innerHTML = '<h2 id="intro-h2">How to use this guide</h2>';
    const box = addInChapterToc(landing);
    const item = box.querySelector(".in-chapter-toc__item");
    expect(item.querySelector(".in-chapter-toc__number")).toBeNull();
    expect(item.textContent).toBe("How to use this guide");
  });

  it("leaves heading ids untouched so box targets resolve", () => {
    const box = addInChapterToc(section);
    for (const item of box.querySelectorAll(".in-chapter-toc__item")) {
      const target = section.querySelector(`#${CSS.escape(item.dataset.target)}`);
      expect(target).not.toBeNull();
      expect(target.tagName).toBe("H2");
    }
  });
});

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
    // The box itself contributes no H2 entries.
    expect(extractTocItems(section).filter((i) => i.level === "h2").length).toBe(2);
  });

  it("keeps SectionNavigator wrapping and waypoints working", () => {
    const contentEl = document.createElement("div");
    contentEl.appendChild(section);
    addReadingAids(section);

    const navigator = new SectionNavigator(contentEl, contentEl);
    navigator.setup();

    // Waypoints are still exactly the h1 + h2s; the aids add none.
    expect(navigator.headings.map((h) => h.tagName)).toEqual(["H1", "H2", "H2"]);
    // The box did not trip the already-wrapped guard: h2 subsections exist.
    expect(section.querySelectorAll(":scope > section").length).toBe(3);
    // The box ends up inside the intro subsection, still first in document order.
    expect(section.querySelector(".in-chapter-toc")).not.toBeNull();
  });
});

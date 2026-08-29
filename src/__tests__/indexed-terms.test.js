import { describe, it, expect } from "vitest";
import { renderMarkdown, sanitizeHtml } from "../renderer/markdown-renderer.js";
import {
  buildIndexSection,
  collectIndexedTerms,
  flashIndexedTerm,
  rebuildIndexSection,
} from "../core/indexed-terms.js";

describe("==term== parsing (markdown-it inline rule)", () => {
  const render = (md) => renderMarkdown(md);

  it("wraps a simple term in span.idx", () => {
    expect(render("This is ==indexed terms== in text.")).toBe(
      '<p>This is <span class="idx">indexed terms</span> in text.</p>\n',
    );
  });

  it("supports multi-word terms and adjacent punctuation", () => {
    expect(render("call ==foo()== now, ==a,b== ok")).toContain(
      '<span class="idx">foo()</span>',
    );
    expect(render("call ==foo()== now, ==a,b== ok")).toContain(
      '<span class="idx">a,b</span>',
    );
  });

  it("renders inline markup inside a term", () => {
    expect(render("==**bold term**==")).toContain(
      '<span class="idx"><strong>bold term</strong></span>',
    );
    expect(render("==`code` and **b**==")).toContain("<code>code</code>");
  });

  it("rejects empty ==== and terms with padding whitespace", () => {
    expect(render("====")).not.toContain("span");
    expect(render("== spaced ==")).not.toContain('<span class="idx"');
    expect(render("== ==")).not.toContain('<span class="idx"');
  });

  it("leaves unbalanced and triple equals as literal text", () => {
    expect(render("this == is not a term")).not.toContain('<span class="idx"');
    expect(render("===term===")).toBe("<p>===term===</p>\n");
    expect(render("x ==== y")).not.toContain('<span class="idx"');
  });

  it("matches tight ==a==b==c style terms like markdown-it-ins", () => {
    expect(render("a==b==c")).toContain('<span class="idx">b</span>');
  });

  it("rejects terms spanning a newline", () => {
    expect(render("==first\nline==")).not.toContain('<span class="idx"');
  });

  it("never parses == inside code spans or fences", () => {
    expect(render("use `a ==b== c` inline")).toContain("<code>a ==b== c</code>");
    expect(render("use `a ==b== c` inline")).not.toContain('<span class="idx"');
    expect(render("```\n==x==\n```")).toContain("<pre><code>==x==\n</code></pre>");
    expect(render("```\n==x==\n```")).not.toContain('<span class="idx"');
  });

  it("does not affect existing emphasis and links", () => {
    expect(render("**bold** and *it*")).toContain("<strong>bold</strong>");
    expect(render("**bold** and *it*")).toContain("<em>it</em>");
    expect(render("[text](https://x.com)")).toContain('href="https://x.com"');
  });
});

describe("sanitizer allows .idx markup", () => {
  it("keeps span.idx through sanitizeHtml", () => {
    const html = sanitizeHtml('<p><span class="idx">term</span></p>');
    expect(html).toContain('<span class="idx">');
    expect(html).toContain("term");
  });
});

function buildSections() {
  const a = document.createElement("section");
  a.className = "coursebook-section";
  a.id = "chapter-a";
  a.innerHTML = `
    <h1 id="chapter-a-title">A</h1>
    <p><span class="idx">Zebra</span> then <span class="idx">apple pie</span></p>
  `;
  const b = document.createElement("section");
  b.className = "coursebook-section";
  b.id = "chapter-b";
  b.innerHTML = `
    <h1 id="chapter-b-title">B</h1>
    <p><span class="idx">zebra</span> again, <span class="idx">mango</span></p>
  `;
  // Numbers as the pipelines apply them before the index is built.
  a.querySelector("h1").prepend(numberSpan("1"));
  b.querySelector("h1").prepend(numberSpan("2"));
  return [a, b];
}

function numberSpan(text) {
  const span = document.createElement("span");
  span.className = "heading-number";
  span.textContent = `${text} `;
  return span;
}

describe("collectIndexedTerms", () => {
  it("collects, dedupes case-insensitively, and sorts alphabetically", () => {
    const [a, b] = buildSections();
    const entries = collectIndexedTerms([
      { root: a, label: "chapter-a" },
      { root: b, label: "chapter-b" },
    ]);
    // First-seen casing wins ("Zebra"); grouping is case-insensitive.
    expect(entries.map((e) => e.term)).toEqual(["apple pie", "mango", "Zebra"]);
  });

  it("anchors every occurrence and labels it by its section", () => {
    const [a, b] = buildSections();
    const entries = collectIndexedTerms([
      { root: a, label: "chapter-a" },
      { root: b, label: "chapter-b" },
    ]);
    const zebra = entries.find((e) => e.term === "Zebra");
    expect(zebra.occurrences).toEqual([
      { id: "idx-zebra", label: "1" },
      { id: "idx-zebra-2", label: "2" },
    ]);
    expect(a.querySelector(".idx").id).toBe("idx-zebra");
    const spans = b.querySelectorAll(".idx");
    expect(spans[0].id).toBe("idx-zebra-2");
    expect(spans[1].id).toBe("idx-mango");
  });

  it("uses the heading title as label when the heading is unnumbered", () => {
    const a = document.createElement("section");
    a.innerHTML =
      '<h2 id="intro">How to use this guide</h2><p><span class="idx">Zebra</span></p>';
    const entries = collectIndexedTerms([{ root: a, label: "overview" }]);
    expect(entries[0].occurrences[0].label).toBe("How to use this guide");
  });

  it("avoids ids taken by headings or sections", () => {
    const [a] = buildSections();
    const entries = collectIndexedTerms(
      [{ root: a, label: "chapter-a" }],
      new Set(["idx-zebra", "idx-apple-pie"]),
    );
    // Suffixes start at -2 (the base id is the "-1" slot), so taken base
    // ids push every occurrence to the next free suffix.
    expect(entries.map((e) => e.occurrences[0].id)).toEqual([
      "idx-apple-pie-2",
      "idx-zebra-2",
    ]);
  });

  it("does not accumulate suffixes across rebuilds", () => {
    const content = document.createElement("div");
    content.appendChild(buildSections()[0]);
    content.appendChild(buildSections()[1]);
    rebuildIndexSection(content);
    rebuildIndexSection(content);
    rebuildIndexSection(content);
    const ids = [...content.querySelectorAll(".idx")].map((s) => s.id);
    expect(ids).toEqual(["idx-zebra", "idx-apple-pie", "idx-zebra-2", "idx-mango"]);
    expect(ids.filter((id) => id.startsWith("idx-zebra-2-")).length).toBe(0);
  });

  it("clears leftover highlight flashes on rebuild", () => {
    const content = document.createElement("div");
    const [a] = buildSections();
    content.appendChild(a);
    rebuildIndexSection(content);
    a.querySelector(".idx").classList.add("idx-highlight");
    rebuildIndexSection(content);
    expect(content.querySelectorAll(".idx-highlight").length).toBe(0);
  });
});

describe("buildIndexSection", () => {
  it("builds a trailing coursebook section with occurrence links", () => {
    const section = buildIndexSection([
      {
        term: "apple pie",
        occurrences: [
          { id: "idx-apple-pie", label: "1.1" },
          { id: "idx-apple-pie-2", label: "1.3" },
        ],
      },
      { term: "zebra", occurrences: [{ id: "idx-zebra", label: "2" }] },
    ]);
    expect(section.id).toBe("index");
    expect(section.className).toBe("coursebook-section index-section");
    expect(section.querySelector("h2").textContent).toBe("Index");

    const items = section.querySelectorAll(".index-item");
    expect(items.length).toBe(2);
    expect(items[0].querySelector(".index-term").textContent).toBe("apple pie");

    const links = items[0].querySelectorAll(".idx-link");
    expect(links.length).toBe(2);
    expect(links[0].textContent).toBe("1.1");
    expect(links[0].getAttribute("href")).toBe("#idx-apple-pie");
    expect(links[0].getAttribute("data-target")).toBe("idx-apple-pie");
    expect(links[1].textContent).toBe("1.3");
  });

  it("shows an empty-state message when there are no terms", () => {
    const section = buildIndexSection([]);
    expect(section.querySelector(".index-list")).toBeNull();
    expect(section.querySelector(".index-empty").textContent).toContain(
      "No indexed terms",
    );
  });
});

describe("flashIndexedTerm", () => {
  it("adds and removes the highlight class via animationend", () => {
    const [a] = buildSections();
    const span = a.querySelector(".idx");
    flashIndexedTerm(span);
    expect(span.classList.contains("idx-highlight")).toBe(true);

    const event = new window.Event("animationend", { bubbles: true });
    span.dispatchEvent(event);
    expect(span.classList.contains("idx-highlight")).toBe(false);
  });

  it("restarts cleanly when flashed twice", () => {
    const [a] = buildSections();
    const span = a.querySelector(".idx");
    flashIndexedTerm(span);
    span.dispatchEvent(new window.Event("animationend", { bubbles: true }));
    flashIndexedTerm(span);
    expect(span.classList.contains("idx-highlight")).toBe(true);
    span.dispatchEvent(new window.Event("animationend", { bubbles: true }));
    expect(span.classList.contains("idx-highlight")).toBe(false);
  });
});

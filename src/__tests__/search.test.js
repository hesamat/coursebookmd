import { describe, it, expect } from "vitest";
import {
  collectSearchEntries,
  searchEntries,
  buildSearchSnippet,
  SEARCH_BLOCK_SELECTOR,
} from "../core/search.js";

function section(html) {
  const root = document.createElement("section");
  root.innerHTML = html;
  return root;
}

describe("collectSearchEntries", () => {
  it("indexes leaf text blocks with normalized text and labels", () => {
    const sec = section(
      "<h2>Getting Started</h2><p>Open  the\nfile</p><ul><li>first item</li></ul>",
    );
    const entries = collectSearchEntries([sec], () => "Chapter 1");
    const texts = entries.map((e) => e.text);
    // Headings are TOC territory, not search results.
    expect(texts).not.toContain("Getting Started");
    // Runs of whitespace collapse, but the newline survives so code
    // blocks can snippet one coherent line.
    expect(texts).toContain("Open the\nfile");
    expect(texts).toContain("first item");
    expect(entries.every((e) => e.label === "Chapter 1")).toBe(true);
  });

  it("skips blocks that contain other blocks so text is not indexed twice", () => {
    const sec = section(
      "<blockquote><p>nested prose</p></blockquote><table><tr><td>cell</td></tr></table>",
    );
    const entries = collectSearchEntries([sec], () => "L");
    // Table cells are not search targets, so only the quote's prose lands.
    expect(entries.map((e) => e.text)).toEqual(["nested prose"]);
  });

  it("strips wrapped code and tables from an indexed block's text", () => {
    const sec = section(
      "<li>Run this:<pre><code>print(1)</code></pre>then read the table:</li>" +
        "<table><tr><td>ignored cell</td></tr></table>",
    );
    const entries = collectSearchEntries([sec], () => "L");
    expect(entries.map((e) => e.text)).toEqual(["Run this: then read the table:"]);
  });

  it("skips blocks whose text is shorter than three characters", () => {
    const sec = section("<p>ab</p><p>abc</p>");
    expect(collectSearchEntries([sec], () => "L").map((e) => e.text)).toEqual(["abc"]);
  });

  it("uses the section-specific label from getLabel", () => {
    const withLabel = section("<p>alpha</p>");
    withLabel.dataset.label = "Overview";
    const plain = section("<p>beta</p>");
    const entries = collectSearchEntries(
      [withLabel, plain],
      (sec) => sec.dataset.label ?? "fallback",
    );
    expect(entries[0].label).toBe("Overview");
    expect(entries[1].label).toBe("fallback");
  });

  it("excludes ignored subtrees like KaTeX's hidden MathML source", () => {
    const sec = section(
      '<p>Area is <span class="katex">' +
        '<span class="katex-mathml"><math>A = \\pi r^2</math></span>' +
        '<span class="katex-html" aria-hidden="true">A = \u03c0r\u00b2</span>' +
        "</span> square units.</p>",
    );
    const [entry] = collectSearchEntries([sec], () => "L");
    expect(entry.text).toBe("Area is A = \u03c0r\u00b2 square units.");
  });
});

describe("searchEntries", () => {
  function build() {
    return collectSearchEntries(
      [section("<p>The quick brown fox</p>"), section("<p>Quick quick brown</p>")],
      () => "L",
    );
  }

  it("matches case-insensitively and reports every occurrence", () => {
    const hits = searchEntries(build(), "QUICK");
    expect(hits).toHaveLength(2);
    expect(hits[0].matches).toEqual([{ idx: 4, len: 5 }]);
    expect(hits[1].matches).toEqual([
      { idx: 0, len: 5 },
      { idx: 6, len: 5 },
    ]);
  });

  it("returns [] for queries shorter than the minimum length", () => {
    expect(searchEntries(build(), "q")).toEqual([]);
    expect(searchEntries(build(), "  ")).toEqual([]);
  });

  it("caps results at maxResults", () => {
    const entries = collectSearchEntries(
      Array.from({ length: 10 }, (_, i) => section(`<p>needle ${i}</p>`)),
      () => "L",
    );
    expect(searchEntries(entries, "needle")).toHaveLength(10);
    expect(searchEntries(entries, "needle", { maxResults: 3 })).toHaveLength(3);
  });

  it("returns every match when maxResults is Infinity", () => {
    const entries = collectSearchEntries(
      Array.from({ length: 250 }, (_, i) => section(`<p>needle ${i}</p>`)),
      () => "L",
    );
    expect(searchEntries(entries, "needle", { maxResults: Infinity })).toHaveLength(250);
  });

  it("trims the query before matching", () => {
    expect(searchEntries(build(), "  brown  ")).toHaveLength(2);
  });

  it("matches a spaced query across a newline in the block", () => {
    const entries = collectSearchEntries(
      [section("<p>average /= 2\n# floor division of 10</p>")],
      () => "L",
    );
    const [hit] = searchEntries(entries, "floor division");
    expect(hit.matches).toHaveLength(1);
    // The reported offset points at the raw text, newline included.
    expect(hit.text.slice(hit.matches[0].idx, hit.matches[0].idx + 5)).toBe("floor");
  });

  it("keeps a phrase matched across a newline inside the snippet", () => {
    const text = "is floor\ndivision here";
    const { parts } = buildSearchSnippet(text, [{ idx: 3, len: 14 }]);
    // The window runs from the line start through the end of the phrase;
    // text after the phrase on the second line stays out.
    expect(parts.map((p) => p.text).join("")).toBe("is floor\ndivision");
    expect(parts[1].match).toBe(true);
  });

  it("preserves host-added entry fields in hits", () => {
    const entries = collectSearchEntries([section("<p>target text</p>")], () => "L").map(
      (entry) => ({ ...entry, sectionId: "my-chapter" }),
    );
    const [hit] = searchEntries(entries, "target");
    expect(hit.sectionId).toBe("my-chapter");
    expect(hit.matches[0].len).toBe(6);
  });
});

describe("buildSearchSnippet", () => {
  it("marks every occurrence inside the window and ellipsizes the clipped ends", () => {
    const text = "0123456789".repeat(30); // 300 chars
    const matches = [
      { idx: 90, len: 4 },
      { idx: 110, len: 4 },
      { idx: 260, len: 4 },
    ];
    const { parts } = buildSearchSnippet(text, matches);
    // Window: [30, 224]; the third occurrence falls outside and is not marked.
    expect(parts).toEqual([
      { text: "…" + text.slice(30, 90), match: false },
      { text: "0123", match: true },
      { text: text.slice(94, 110), match: false },
      { text: "0123", match: true },
      { text: text.slice(114, 224) + "…", match: false },
    ]);
  });

  it("omits ellipses when the text fits entirely", () => {
    const { parts } = buildSearchSnippet("hello world", [{ idx: 0, len: 5 }]);
    expect(parts).toEqual([
      { text: "hello", match: true },
      { text: " world", match: false },
    ]);
  });

  it("clips at the text boundaries", () => {
    const { parts } = buildSearchSnippet("abc", [{ idx: 1, len: 2 }]);
    expect(parts).toEqual([
      { text: "a", match: false },
      { text: "bc", match: true },
    ]);
  });

  it("frames a multi-line block within the line holding the match", () => {
    const text = "average /= 2\nslices //= 2  # floor division\nremainder %= 4";
    const first = text.indexOf("floor");
    const { parts } = buildSearchSnippet(text, [{ idx: first, len: 5 }]);
    expect(parts.map((p) => p.text).join("")).not.toContain("\n");
    expect(parts).toEqual([
      { text: "slices //= 2  # ", match: false },
      { text: "floor", match: true },
      { text: " division", match: false },
    ]);
  });

  it("selector covers prose and excludes code, tables, and headings", () => {
    for (const tag of ["p", "li", "blockquote"]) {
      expect(SEARCH_BLOCK_SELECTOR).toContain(tag);
    }
    for (const tag of ["pre", "td", "th", "h2"]) {
      expect(SEARCH_BLOCK_SELECTOR).not.toContain(tag);
    }
  });
});

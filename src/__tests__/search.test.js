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
    expect(texts).toContain("Getting Started");
    expect(texts).toContain("Open the file");
    expect(texts).toContain("first item");
    expect(entries.every((e) => e.label === "Chapter 1")).toBe(true);
  });

  it("skips blocks that contain other blocks so text is not indexed twice", () => {
    const sec = section(
      "<blockquote><p>nested prose</p></blockquote><table><tr><td>cell</td></tr></table>",
    );
    const entries = collectSearchEntries([sec], () => "L");
    expect(entries.map((e) => e.text)).toEqual(["nested prose", "cell"]);
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

  it("selector covers the block elements the runtime relies on", () => {
    for (const tag of ["p", "li", "pre", "td", "blockquote", "h2"]) {
      expect(SEARCH_BLOCK_SELECTOR).toContain(tag);
    }
  });
});

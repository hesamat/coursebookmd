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
});

describe("searchEntries", () => {
  function build() {
    return collectSearchEntries(
      [section("<p>The quick brown fox</p>"), section("<p>Quick quick brown</p>")],
      (sec, i) => `Chapter ${i}`,
    );
  }

  it("matches case-insensitively and reports match position/length", () => {
    const hits = searchEntries(build(), "QUICK");
    expect(hits).toHaveLength(2);
    expect(hits[0].matchIdx).toBe(4);
    expect(hits[0].matchLen).toBe(5);
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

  it("trims the query before matching", () => {
    expect(searchEntries(build(), "  brown  ")).toHaveLength(2);
  });

  it("preserves host-added entry fields in hits", () => {
    const entries = collectSearchEntries(
      [section("<p>target text</p>")],
      () => "L",
    ).map((entry) => ({ ...entry, sectionId: "my-chapter" }));
    const [hit] = searchEntries(entries, "target");
    expect(hit.sectionId).toBe("my-chapter");
    expect(hit.matchLen).toBe(6);
  });
});

describe("buildSearchSnippet", () => {
  const text = "0123456789".repeat(20); // 200 chars

  it("returns the match plus surrounding context", () => {
    const { prefix, match, suffix } = buildSearchSnippet(text, 90, 4);
    expect(match).toBe("0123");
    expect(prefix).toBe("…" + text.slice(60, 90));
    expect(suffix).toBe(text.slice(94, 144) + "…");
  });

  it("omits ellipses when the text fits entirely", () => {
    const { prefix, match, suffix } = buildSearchSnippet("hello world", 0, 5);
    expect(prefix).toBe("");
    expect(match).toBe("hello");
    expect(suffix).toBe(" world");
  });

  it("clips at the text boundaries", () => {
    const { match, suffix } = buildSearchSnippet("abc", 1, 2);
    expect(match).toBe("bc");
    expect(suffix).toBe("");
  });

  it("selector covers the block elements the runtime relies on", () => {
    for (const tag of ["p", "li", "pre", "td", "blockquote", "h2"]) {
      expect(SEARCH_BLOCK_SELECTOR).toContain(tag);
    }
  });
});

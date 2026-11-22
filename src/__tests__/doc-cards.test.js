import { describe, it, expect, afterEach } from "vitest";
import {
  buildRegistry,
  normalizeEntry,
  matchDocCard,
  setActiveDocCards,
  getActiveDocCards,
  resetDocCardsForTests,
} from "../core/doc-cards.js";
import { PYTHON_DOCS_URL } from "../core/python-builtins.js";

describe("buildRegistry", () => {
  afterEach(() => resetDocCardsForTests());

  it("normalizes the python pack with namespaced ids and urls", () => {
    const registry = buildRegistry();
    expect(registry.errors).toEqual([]);
    const len = registry.exactMap.get("len");
    expect(len.id).toBe("python:len");
    expect(len.url).toBe(`${PYTHON_DOCS_URL}#len`);
    expect(len.kind).toBe("docs");
    expect(len.group).toBe("python");
    expect(registry.callNames.get("len")).toBe(len);
    expect(registry.urlMap.get(`${PYTHON_DOCS_URL}#len`)).toBe(len);
    // Sorted ids keep chip emission and export bytes deterministic.
    const ids = registry.entries.map((e) => e.id);
    expect(ids).toEqual([...ids].sort());
    expect(registry.entries.length).toBeGreaterThan(60);
  });

  it("builds term-kind entries when signatures are absent", () => {
    const { entry, error } = normalizeEntry(
      {
        name: "SELECT",
        url: "https://www.postgresql.org/docs/current/sql-select.html",
        summary: "Retrieves rows from the database.",
      },
      { group: "book" },
    );
    expect(error).toBeUndefined();
    expect(entry.kind).toBe("term");
    expect(entry.id).toBe("book:select");
    expect(entry.matches).toEqual(["SELECT"]);
    expect(entry.example).toBeUndefined();
  });

  it("lets a book entry override a pack match per match string", () => {
    const registry = buildRegistry({
      bookEntries: [
        { name: "len", url: "https://example.com/len", summary: "Course-specific len." },
      ],
    });
    expect(registry.errors).toEqual([]);
    expect(registry.exactMap.get("len").id).toBe("book:len");
    expect(registry.callNames.get("len").id).toBe("book:len");
    // The pack entry survives for its own url and other match strings.
    expect(registry.entries.map((e) => e.id)).toContain("python:len");

    setActiveDocCards(registry);
    expect(matchDocCard("len")?.id).toBe("book:len");
    expect(matchDocCard("len(x)")?.id).toBe("book:len");
  });

  it("errors on duplicate book ids (same slug)", () => {
    const registry = buildRegistry({
      bookEntries: [
        { name: "COUNT", url: "https://example.com/count", summary: "One." },
        { name: "count", url: "https://example.com/count2", summary: "Two." },
      ],
    });
    expect(registry.errors.some((e) => e.includes("duplicate doc card id"))).toBe(true);
  });

  it("errors when two book entries claim the same match string", () => {
    const registry = buildRegistry({
      bookEntries: [
        {
          name: "COUNT",
          url: "https://example.com/a",
          summary: "A.",
          matches: ["count"],
        },
        {
          name: "Compte",
          url: "https://example.com/b",
          summary: "B.",
          matches: ["count"],
        },
      ],
    });
    expect(
      registry.errors.some((e) => e.includes('"count"') && e.includes("claimed by both")),
    ).toBe(true);
  });

  it("rejects bad url schemes and missing required fields", () => {
    expect(
      normalizeEntry(
        { name: "x", url: "javascript:alert(1)", summary: "s" },
        { group: "book" },
      ).error,
    ).toContain("scheme");
    expect(
      normalizeEntry({ name: "x", url: "notaurl", summary: "s" }, { group: "book" })
        .error,
    ).toContain("absolute URL");
    expect(
      normalizeEntry(
        { name: "  ", url: "https://e.com", summary: "s" },
        { group: "book" },
      ).error,
    ).toContain("missing name");
    expect(
      normalizeEntry({ name: "x", url: "https://e.com" }, { group: "book" }).error,
    ).toContain("missing summary");
    expect(
      normalizeEntry({ name: "x", url: "https://e.com", summary: "s" }, { group: "book" })
        .entry.url,
    ).toBe("https://e.com");
  });

  it("warns when two entries share a url", () => {
    const registry = buildRegistry({
      bookEntries: [
        { name: "COUNT", url: "https://example.com/agg", summary: "A." },
        { name: "SUM", url: "https://example.com/agg", summary: "B." },
      ],
    });
    expect(registry.warnings.some((w) => w.includes("shared by"))).toBe(true);
    expect(registry.urlMap.get("https://example.com/agg").id).toBe("book:count");
  });
});

describe("matchDocCard", () => {
  afterEach(() => resetDocCardsForTests());

  it("matches bare names and whole calls from the python pack", () => {
    expect(matchDocCard("len")?.id).toBe("python:len");
    expect(matchDocCard(" len ")?.id).toBe("python:len");
    expect(matchDocCard("len()")?.id).toBe("python:len");
    expect(matchDocCard("len(name)")?.id).toBe("python:len");
    expect(matchDocCard("len (x)")?.id).toBe("python:len");
    expect(matchDocCard("len(f(x))")?.id).toBe("python:len");
    expect(matchDocCard('print("hi", end="")')?.id).toBe("python:print");
    expect(matchDocCard("dict(zip(a, b))")?.id).toBe("python:dict");
    expect(matchDocCard("__import__")?.id).toBe("python:__import__");
    expect(matchDocCard("range")?.id).toBe("python:range");
  });

  it("fails closed on trailing content, unbalanced calls, and non-mentions", () => {
    expect(matchDocCard("len(x) + len(y)")).toBeNull();
    expect(matchDocCard("len(x).someMethod()")).toBeNull();
    expect(matchDocCard("len(unclosed")).toBeNull();
    expect(matchDocCard("len(a))")).toBeNull();
    expect(matchDocCard("lenx")).toBeNull();
    expect(matchDocCard("my_len()")).toBeNull();
    expect(matchDocCard("for")).toBeNull();
    expect(matchDocCard("")).toBeNull();
    expect(matchDocCard("   ")).toBeNull();
    expect(matchDocCard("len(x) > 0")).toBeNull();
    expect(matchDocCard("len is handy")).toBeNull();
  });

  it("respects quoted parens inside a call", () => {
    expect(matchDocCard('len("a(b)")')?.id).toBe("python:len");
    expect(matchDocCard("len('a)')")?.id).toBe("python:len");
  });

  it("does not generate call forms for non-identifier names", () => {
    setActiveDocCards(
      buildRegistry({
        bookEntries: [{ name: "COUNT(*)", url: "https://example.com/c", summary: "C." }],
      }),
    );
    expect(matchDocCard("COUNT(*)")?.id).toBe("book:count");
    expect(matchDocCard("COUNT(*)(x)")).toBeNull();
    expect(matchDocCard("COUNT")).toBeNull();
  });

  it("resets between registries", () => {
    setActiveDocCards(
      buildRegistry({
        bookEntries: [{ name: "len", url: "https://example.com/len", summary: "L." }],
      }),
    );
    expect(matchDocCard("len")?.id).toBe("book:len");
    resetDocCardsForTests();
    expect(matchDocCard("len")?.id).toBe("python:len");
  });

  it("lazy-defaults to the python pack when nothing is set", () => {
    expect(getActiveDocCards().entries.length).toBeGreaterThan(60);
    expect(matchDocCard("len")?.id).toBe("python:len");
  });
});

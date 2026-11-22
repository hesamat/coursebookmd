import { describe, it, expect, afterEach } from "vitest";
import {
  parseGlossary,
  resolveGlossaryEntries,
  buildGlossaryRegistry,
  renderDocCardSummary,
} from "../core/doc-cards-glossary.js";
import {
  matchDocCard,
  setActiveDocCards,
  resetDocCardsForTests,
} from "../core/doc-cards.js";

describe("parseGlossary", () => {
  it("parses a full entry: url, matches, signatures, summary, example", () => {
    const { entries, errors, warnings, packs } = parseGlossary(
      [
        "## COUNT",
        "https://www.postgresql.org/docs/current/functions-aggregate.html",
        "Matches: `COUNT`, `COUNT(*)`, `count(*)`",
        "",
        "Signatures:",
        "",
        "```",
        "COUNT(*)",
        "COUNT(expression)",
        "```",
        "",
        "Counts rows, or non-null values.",
        "",
        "Example:",
        "",
        "```sql",
        "SELECT COUNT(*) FROM orders;",
        "```",
      ].join("\n"),
      { sourcePath: "doc-cards.md" },
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(packs).toBeNull();
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("COUNT");
    expect(entries[0].url).toBe(
      "https://www.postgresql.org/docs/current/functions-aggregate.html",
    );
    expect(entries[0].matches).toEqual(["COUNT", "COUNT(*)", "count(*)"]);
    expect(entries[0].signatures).toEqual(["COUNT(*)", "COUNT(expression)"]);
    expect(entries[0].summary).toBe("Counts rows, or non-null values.");
    expect(entries[0].example).toBe("SELECT COUNT(*) FROM orders;");
    expect(entries[0].source).toEqual({ path: "doc-cards.md", line: 0 });
  });

  it("raw entries carry no kind; the registry normalization derives it", () => {
    const withSigs = parseGlossary(
      "## fn\nhttps://example.com\n\nSignatures:\n\n```\nfn()\n```\n\nDoes things.",
    );
    expect(withSigs.entries[0].kind).toBeUndefined(); // raw entries; normalization sets kind
    const withoutSigs = parseGlossary("## TERM\nhttps://example.com\n\nJust a pointer.");
    expect(withoutSigs.entries[0].signatures).toEqual([]);
  });

  it("keeps raw markdown in summaries so emphasis and code survive", () => {
    const { entries } = parseGlossary(
      "## COUNT\nhttps://example.com\n\nCounts `rows`, *fast* and __well__.",
    );
    expect(entries[0].summary).toBe("Counts `rows`, *fast* and __well__.");
    const html = renderDocCardSummary(entries[0].summary);
    expect(html).toContain("<code>rows</code>");
    expect(html).toContain("<em>fast</em>");
    expect(html).toContain("<strong>well</strong>");
  });

  it("never produces links or images in rendered summaries", () => {
    expect(renderDocCardSummary("<https://x.com>")).not.toContain("<a ");
    expect(renderDocCardSummary("[text](https://x.com)")).not.toContain("<a ");
    expect(renderDocCardSummary("![](x.png)")).not.toContain("<img");
    expect(renderDocCardSummary("<script>alert(1)</script>")).not.toContain("<script");
  });

  it("summarizes multi-paragraph prose and tolerates an example with backticks", () => {
    const { entries, warnings } = parseGlossary(
      [
        "## map",
        "https://example.com/map",
        "",
        "Applies a function to every item.",
        "",
        "Often paired with a list comprehension instead.",
        "",
        "Example:",
        "",
        "````",
        "```python",
        "list(map(str, [1, 2]))",
        "```",
        "````",
      ].join("\n"),
    );
    expect(warnings).toEqual([]);
    expect(entries[0].summary).toBe(
      "Applies a function to every item.\n\nOften paired with a list comprehension instead.",
    );
    expect(entries[0].example).toContain("```python");
  });

  it("warns on unlabeled fences and keeps prose paragraphs as summary", () => {
    const { entries, warnings } = parseGlossary(
      [
        "## COUNT",
        "https://example.com",
        "Pitfalls: many.",
        "",
        "```",
        "stray",
        "```",
        "",
        "Counts rows.",
      ].join("\n"),
    );
    expect(warnings.some((w) => w.includes("unlabeled code fence"))).toBe(true);
    expect(entries[0].summary).toContain("Pitfalls: many.");
    expect(entries[0].summary).toContain("Counts rows.");
  });

  it("warns when a label has no following fence", () => {
    const { warnings, entries } = parseGlossary(
      "## COUNT\nhttps://example.com\n\nSignatures:\n\nCounts rows.",
    );
    expect(warnings.some((w) => w.includes("must be followed by a code fence"))).toBe(
      true,
    );
    expect(entries[0].signatures).toEqual([]);
    expect(entries[0].summary).toBe("Counts rows.");
  });

  it("errors on duplicate entry names with line numbers", () => {
    const { errors } = parseGlossary(
      "## COUNT\nhttps://example.com\n\n## COUNT\nhttps://example.com/2",
      { sourcePath: "doc-cards.md" },
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^doc-cards\.md:4: duplicate glossary entry "COUNT"$/);
  });

  it("keeps original line numbers when a config comment precedes the body", () => {
    // The config comment line becomes a blank line so token.map offsets stay
    // aligned with the original file.
    const { errors } = parseGlossary(
      "<!-- doc-cards: packs=none -->\n\n## COUNT\nhttps://example.com\n\n## COUNT\nhttps://example.com/2",
      { sourcePath: "doc-cards.md" },
    );
    expect(errors[0]).toMatch(/^doc-cards\.md:6: duplicate glossary entry "COUNT"$/);
  });

  it("does not mistake prose slashes for URLs", () => {
    const { entries } = parseGlossary(
      [
        "## Notes",
        "https://example.com",
        "",
        "Read it and/or skim 24/7 over TCP/IP and C/C++ stacks.",
      ].join("\n"),
    );
    expect(entries[0].url).toBe("https://example.com");
    expect(entries[0].summary).toContain(
      "and/or skim 24/7 over TCP/IP and C/C++ stacks.",
    );
  });

  it("accepts relative and anchor URL lines with real paths", () => {
    const { entries, warnings } = parseGlossary(
      "## helpers\n./api/reference.html\n\n## term\n#section-anchor",
    );
    // Summary-less entries parse fine; the parser only warns.
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("has no summary");
    expect(entries[0].url).toBe("./api/reference.html");
    expect(entries[1].url).toBe("#section-anchor");
  });

  it("reads the packs config from the leading comment", () => {
    expect(parseGlossary("<!-- doc-cards: packs=none -->\n\n## COUNT").packs).toEqual([]);
    expect(
      parseGlossary("<!-- doc-cards: packs=python, custom -->\n\n## COUNT").packs,
    ).toEqual(["python", "custom"]);
    expect(parseGlossary("<!-- doc-cards: packs=[python] -->\n\n## COUNT").packs).toEqual(
      ["python"],
    );
    expect(parseGlossary("## COUNT").packs).toBeNull();
  });

  it("warns on malformed config and keeps the comment out of the body", () => {
    const { packs, warnings, entries } = parseGlossary(
      "<!-- doc-cards: mode=strict -->\n\n## COUNT\nhttps://example.com",
    );
    expect(packs).toBeNull();
    expect(warnings.some((w) => w.includes("doc-cards config must look like"))).toBe(
      true,
    );
    expect(entries[0].name).toBe("COUNT");
  });

  it("ignores prose paragraphs that are not URLs", () => {
    const { entries } = parseGlossary("## COUNT\n\nCounting is a universal operation.");
    expect(entries[0].url).toBeNull();
    expect(entries[0].summary).toContain("Counting is a universal operation.");
  });
});

describe("resolveGlossaryEntries", () => {
  const raw = (over = {}) => ({
    name: "COUNT",
    url: null,
    matches: ["COUNT"],
    signatures: [],
    summary: "Counts.",
    example: null,
    source: { path: "doc-cards.md", line: 0 },
    ...over,
  });

  it("anchors URL-less entries to the glossary chapter slug", () => {
    const { entries, errors } = resolveGlossaryEntries([raw()], {
      sourcePath: "doc-cards.md",
      glossaryChapterSlug: "function-reference",
      baseDir: "docs",
    });
    expect(errors).toEqual([]);
    expect(entries[0].url).toBe("#function-reference");
  });

  it("errors and omits URL-less entries when the glossary is not a chapter", () => {
    const { entries, errors } = resolveGlossaryEntries([raw()], {
      sourcePath: "doc-cards.md",
      glossaryChapterSlug: null,
      baseDir: "docs",
    });
    expect(entries).toEqual([]);
    expect(errors[0]).toContain("doc-cards.md is not a chapter");
    expect(errors[0]).toContain("doc-cards.md:1");
  });

  it("resolves relative URLs against the glossary directory", () => {
    const { entries, errors } = resolveGlossaryEntries(
      [raw({ url: "./api/reference.html" })],
      { sourcePath: "docs/doc-cards.md", glossaryChapterSlug: null, baseDir: "docs" },
    );
    expect(errors).toEqual([]);
    expect(entries[0].url).toBe("docs/api/reference.html");
  });

  it("errors on relative URLs escaping the coursebook root", () => {
    const { entries, errors } = resolveGlossaryEntries(
      [raw({ url: "../../outside.html" })],
      { sourcePath: "docs/doc-cards.md", glossaryChapterSlug: null, baseDir: "docs" },
    );
    expect(entries).toEqual([]);
    expect(errors[0]).toContain("escapes the coursebook root");
  });
});

describe("buildGlossaryRegistry", () => {
  afterEach(() => resetDocCardsForTests());

  const glossary = [
    "<!-- doc-cards: packs=none -->",
    "",
    "## COUNT",
    "https://www.postgresql.org/docs/current/functions-aggregate.html",
    "",
    "Signatures:",
    "",
    "```",
    "COUNT(*)",
    "```",
    "",
    "Counts rows.",
  ].join("\n");

  it("builds a registry with kind, rendered summaries, and normalized matches", () => {
    const { registry, problems } = buildGlossaryRegistry({ markdown: glossary });
    expect(problems.errors).toEqual([]);
    const count = registry.exactMap.get("COUNT");
    expect(count.id).toBe("book:count");
    expect(count.kind).toBe("docs");
    expect(count.group).toBe("book");
    setActiveDocCards(registry);
    expect(matchDocCard("COUNT(*)")?.id).toBe("book:count");
    // Python pack disabled by the config comment: `len` stays plain.
    expect(matchDocCard("len")).toBeNull();
  });

  it("renders summaries as inline HTML without links or images", () => {
    const summary = renderDocCardSummary("Counts `rows`, *fast* and [evil](https://x).");
    expect(summary).toContain("<code>rows</code>");
    expect(summary).toContain("<em>fast</em>");
    expect(summary).not.toContain("<a ");
    expect(summary).not.toContain("<img");
    const html = renderDocCardSummary('<script>alert(1)</script> <img src="x">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });

  it("surfaces malformed entries as problems without dropping the pack", () => {
    const { registry, problems } = buildGlossaryRegistry({
      markdown: "## COUNT\n\nno url at all",
    });
    expect(problems.errors.length).toBeGreaterThan(0);
    // The python pack is still active so builtin chips keep working.
    expect(registry.exactMap.get("len")?.id).toBe("python:len");
    expect(registry.exactMap.get("COUNT")).toBeUndefined();
  });

  it("keeps the python pack alongside book entries by default", () => {
    const { registry, problems } = buildGlossaryRegistry({
      markdown: "## COUNT\nhttps://example.com\n\nCounts rows.",
    });
    expect(problems.errors).toEqual([]);
    expect(registry.exactMap.get("COUNT")?.group).toBe("book");
    expect(registry.exactMap.get("len")?.id).toBe("python:len");
  });
});

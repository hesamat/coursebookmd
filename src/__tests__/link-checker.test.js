import { describe, it, expect } from "vitest";
import { extractAllMdLinks, findBrokenLinks } from "../core/link-checker.js";

const CHAPTERS = [
  "docs/coursebook.md",
  "chapters/01-intro.md",
  "docs/chapters/01-intro.md",
];

const existsFor = (present) => (p) => present.has(p);

describe("extractAllMdLinks", () => {
  it("extracts links with line numbers", () => {
    const md = "text\n\n[Intro](chapters/01-intro.md)\n![img](assets/x.png)";
    expect(extractAllMdLinks(md)).toEqual([
      { target: "chapters/01-intro.md", isImage: false, line: 3 },
      { target: "assets/x.png", isImage: true, line: 4 },
    ]);
  });

  it("skips code fences", () => {
    const md = [
      "before [a](x.md)",
      "```markdown",
      "- [ignored](missing.md)",
      "![also ignored](missing.png)",
      "```",
      "after [b](y.md)",
    ].join("\n");
    const targets = extractAllMdLinks(md).map((l) => l.target);
    expect(targets).toEqual(["x.md", "y.md"]);
  });

  it("handles empty markdown", () => {
    expect(extractAllMdLinks("")).toEqual([]);
  });
});

describe("findBrokenLinks", () => {
  const base = {
    sourcePath: "docs/chapters/01-intro.md",
    knownChapterPaths: CHAPTERS,
    exists: existsFor(new Set(["docs/assets/img.png"])),
  };

  it("accepts chapter links that resolve to known chapters", async () => {
    const md = "[Parent](../coursebook.md)\n[Intro](01-intro.md)";
    expect(await findBrokenLinks({ ...base, markdown: md })).toEqual([]);
  });

  it("flags .md links that are not known chapters", async () => {
    const md = "[Ghost](missing.md)";
    const issues = await findBrokenLinks({ ...base, markdown: md });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "chapter",
      target: "missing.md",
      line: 1,
    });
  });

  it("flags relative paths that do not exist", async () => {
    const md = "![diagram](assets/absent.png)";
    const issues = await findBrokenLinks({ ...base, markdown: md });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "path", target: "assets/absent.png" });
  });

  it("accepts relative paths that exist", async () => {
    const md = "![diagram](../assets/img.png)";
    expect(await findBrokenLinks({ ...base, markdown: md })).toEqual([]);
  });

  it("retries bare paths at the coursebook root like resolveLocalImages", async () => {
    const md = "![diagram](assets/img.png)";
    const issues = await findBrokenLinks({
      ...base,
      markdown: md,
      coursebookRoot: "docs",
    });
    expect(issues).toEqual([]);
  });

  it("flags #hash links that match no heading slug", async () => {
    const md = "[jump](#nope)";
    const issues = await findBrokenLinks({
      ...base,
      markdown: md,
      headingSlugs: new Set(["real-heading"]),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "hash", target: "#nope" });
  });

  it("accepts #hash links that match a heading slug", async () => {
    const md = "[jump](#real-heading)";
    const issues = await findBrokenLinks({
      ...base,
      markdown: md,
      headingSlugs: new Set(["real-heading"]),
    });
    expect(issues).toEqual([]);
  });

  it("skips hash checks when no heading slugs are supplied", async () => {
    const md = "[jump](#nope)";
    expect(await findBrokenLinks({ ...base, markdown: md })).toEqual([]);
  });

  it("ignores external URLs and root-absolute paths", async () => {
    const md = [
      "[site](https://example.com)",
      "[proto](http://example.com)",
      "[scheme-relative](//example.com)",
      "[absolute](/docs/assets/absent.png)",
      "[mail](mailto:a@b.c)",
    ].join("\n");
    expect(await findBrokenLinks({ ...base, markdown: md })).toEqual([]);
  });

  it("ignores links inside code fences and validates after them", async () => {
    const md = [
      "```",
      "[broken](ghost.md)",
      "![broken](absent.png)",
      "```",
      "[real](01-intro.md)",
    ].join("\n");
    expect(await findBrokenLinks({ ...base, markdown: md })).toEqual([]);
  });

  it("skips .md links resolving outside the coursebook root", async () => {
    const md = "[outside](../../elsewhere.md)";
    const issues = await findBrokenLinks({
      ...base,
      markdown: md,
      coursebookRoot: "docs",
    });
    expect(issues).toEqual([]);
  });

  it("supports #fragment targets on chapter links", async () => {
    const md = "[Intro](01-intro.md#section)";
    const issues = await findBrokenLinks({ ...base, markdown: md });
    expect(issues).toEqual([]);
  });

  it("returns no issues for empty markdown", async () => {
    expect(await findBrokenLinks({ ...base, markdown: "" })).toEqual([]);
  });

  it("does not flag path targets when exists is omitted", async () => {
    const md = "![img](assets/unknown.png)";
    expect(
      await findBrokenLinks({
        markdown: md,
        sourcePath: base.sourcePath,
        knownChapterPaths: base.knownChapterPaths,
      }),
    ).toEqual([]);
  });
});

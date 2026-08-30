import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseCoursebook,
  loadCoursebook,
  loadChapter,
  getChapterTitle,
} from "../core/coursebook-loader.js";

describe("coursebook-loader", () => {
  describe("parseCoursebook", () => {
    it("extracts the title from the first H1", () => {
      const md = "# My Course\n\nSome intro text.";
      const result = parseCoursebook(md);
      expect(result.title).toBe("My Course");
    });

    it("falls back to 'Coursebook' when no H1 is present", () => {
      const md = "Just some text without a heading.";
      const result = parseCoursebook(md);
      expect(result.title).toBe("Coursebook");
    });

    it("preserves the original markdown content", () => {
      const md = "# My Course\n\nSome intro text.";
      const result = parseCoursebook(md);
      expect(result.markdown).toBe(md);
    });

    it("extracts chapters from bullet list links", () => {
      const md = [
        "# My Course",
        "",
        "- [Introduction](chapters/01-introduction.md)",
        "- [Variables](chapters/02-variables.md)",
        "- [Control Flow](chapters/03-control-flow.md)",
      ].join("\n");
      const result = parseCoursebook(md, "docs/coursebook.md");
      expect(result.chapters).toHaveLength(3);
      expect(result.chapters[0]).toEqual({
        title: "Introduction",
        path: "chapters/01-introduction.md",
        resolvedPath: "docs/chapters/01-introduction.md",
      });
      expect(result.chapters[1]).toEqual({
        title: "Variables",
        path: "chapters/02-variables.md",
        resolvedPath: "docs/chapters/02-variables.md",
      });
      expect(result.chapters[2]).toEqual({
        title: "Control Flow",
        path: "chapters/03-control-flow.md",
        resolvedPath: "docs/chapters/03-control-flow.md",
      });
    });

    it("resolves chapter paths relative to parent directory", () => {
      const md = "# Course\n\n- [Intro](chapters/01.md)";
      const result = parseCoursebook(md, "docs/coursebook.md");
      expect(result.chapters[0].path).toBe("chapters/01.md");
      expect(result.chapters[0].resolvedPath).toBe("docs/chapters/01.md");
    });

    it("resolves chapter paths when parent is in root", () => {
      const md = "# Course\n\n- [Intro](chapters/01.md)";
      const result = parseCoursebook(md, "coursebook.md");
      expect(result.chapters[0].path).toBe("chapters/01.md");
      expect(result.chapters[0].resolvedPath).toBe("chapters/01.md");
    });

    it("resolves chapter paths with nested parent directory", () => {
      const md = "# Course\n\n- [Intro](chapters/01.md)";
      const result = parseCoursebook(md, "deep/nested/coursebook.md");
      expect(result.chapters[0].resolvedPath).toBe("deep/nested/chapters/01.md");
    });

    it("extracts chapters from numbered list links", () => {
      const md = [
        "# My Course",
        "",
        "1. [Introduction](chapters/01.md)",
        "2. [Variables](chapters/02.md)",
      ].join("\n");
      const result = parseCoursebook(md);
      expect(result.chapters).toHaveLength(2);
      expect(result.chapters[0].title).toBe("Introduction");
      expect(result.chapters[1].title).toBe("Variables");
    });

    it("extracts chapters from asterisk bullet lists", () => {
      const md = [
        "# Course",
        "",
        "* [Chapter A](chapters/a.md)",
        "* [Chapter B](chapters/b.md)",
      ].join("\n");
      const result = parseCoursebook(md);
      expect(result.chapters).toHaveLength(2);
      expect(result.chapters[0].title).toBe("Chapter A");
    });

    it("extracts chapters from plus bullet lists", () => {
      const md = "# Course\n\n+ [Chapter A](a.md)";
      const result = parseCoursebook(md);
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].title).toBe("Chapter A");
    });

    it("returns empty chapters array when no links are present", () => {
      const md = "# My Course\n\nNo chapters listed here.";
      const result = parseCoursebook(md);
      expect(result.chapters).toEqual([]);
    });

    it("ignores links that do not point to .md files", () => {
      const md = [
        "# Course",
        "",
        "- [HTML Page](page.html)",
        "- [PDF Doc](doc.pdf)",
        "- [Real Chapter](chapters/01.md)",
      ].join("\n");
      const result = parseCoursebook(md);
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].path).toBe("chapters/01.md");
    });

    it("ignores regular markdown links that are not in a list", () => {
      const md = ["# Course", "", "See [this link](chapters/01.md) for more."].join("\n");
      const result = parseCoursebook(md);
      expect(result.chapters).toEqual([]);
    });

    it("preserves chapter order as they appear in the file", () => {
      const md = [
        "# Course",
        "",
        "- [Chapter C](c.md)",
        "- [Chapter A](a.md)",
        "- [Chapter B](b.md)",
      ].join("\n");
      const result = parseCoursebook(md);
      expect(result.chapters.map((c) => c.title)).toEqual([
        "Chapter C",
        "Chapter A",
        "Chapter B",
      ]);
    });

    it("handles titles with special characters", () => {
      const md = "# Course: A & B\n\n- [Chapter (Special)](special.md)";
      const result = parseCoursebook(md);
      expect(result.title).toBe("Course: A & B");
      expect(result.chapters[0].title).toBe("Chapter (Special)");
    });

    it("handles indented bullet lists", () => {
      const md = ["# Course", "", "  - [Indented Chapter](chapters/01.md)"].join("\n");
      const result = parseCoursebook(md);
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].title).toBe("Indented Chapter");
    });

    it("rejects absolute paths", () => {
      const md = "# Course\n\n- [Bad](/etc/passwd.md)\n- [Good](chapters/01.md)";
      const result = parseCoursebook(md);
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].path).toBe("chapters/01.md");
    });

    it("rejects parent directory references", () => {
      const md = "# Course\n\n- [Bad](../secret.md)\n- [Good](chapters/01.md)";
      const result = parseCoursebook(md);
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].path).toBe("chapters/01.md");
    });

    it("rejects http/https URLs", () => {
      const md =
        "# Course\n\n- [Bad](http://evil.com/chapter.md)\n- [Good](chapters/01.md)";
      const result = parseCoursebook(md);
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].path).toBe("chapters/01.md");
    });

    it("builds a flat nav when there are no group headings", () => {
      const md = "# Course\n\n- [Intro](chapters/01.md)\n- [More](chapters/02.md)";
      const result = parseCoursebook(md);
      expect(result.nav).toEqual([
        { type: "chapter", index: 0 },
        { type: "chapter", index: 1 },
      ]);
    });

    it("treats a 'Chapters' heading as boilerplate, not a group label", () => {
      const md = "# Course\n\n## Chapters\n\n- [Intro](chapters/01.md)";
      const result = parseCoursebook(md);
      expect(result.nav).toEqual([{ type: "chapter", index: 0 }]);
    });

    it("groups chapters under week headings as unnumbered labels", () => {
      const md = [
        "# Course",
        "",
        "## Week 1",
        "",
        "- [Intro](chapters/01.md)",
        "- [Variables](chapters/02.md)",
        "",
        "## Week 2",
        "",
        "- [Advanced](chapters/03.md)",
      ].join("\n");
      const result = parseCoursebook(md);
      expect(result.nav).toEqual([
        { type: "group", title: "Week 1" },
        { type: "chapter", index: 0 },
        { type: "chapter", index: 1 },
        { type: "group", title: "Week 2" },
        { type: "chapter", index: 2 },
      ]);
    });

    it("emits a group label only once per heading", () => {
      const md = [
        "# Course",
        "",
        "## Module A",
        "",
        "- [One](chapters/01.md)",
        "- [Two](chapters/02.md)",
        "- [Three](chapters/03.md)",
      ].join("\n");
      const result = parseCoursebook(md);
      expect(result.nav).toEqual([
        { type: "group", title: "Module A" },
        { type: "chapter", index: 0 },
        { type: "chapter", index: 1 },
        { type: "chapter", index: 2 },
      ]);
    });

    it("ignores headings and links inside code fences", () => {
      const md = [
        "# Course",
        "",
        "```md",
        "## Week 1",
        "",
        "- [Fake Chapter](chapters/fake.md)",
        "```",
        "",
        "## Week 2",
        "",
        "- [Real Chapter](chapters/real.md)",
      ].join("\n");
      const result = parseCoursebook(md);
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].path).toBe("chapters/real.md");
      expect(result.nav).toEqual([
        { type: "group", title: "Week 2" },
        { type: "chapter", index: 0 },
      ]);
    });

    it("continues chapter numbering across groups", () => {
      const md = [
        "# Course",
        "",
        "## Week 1",
        "",
        "- [Intro](chapters/01.md)",
        "",
        "## Week 2",
        "",
        "- [Advanced](chapters/02.md)",
      ].join("\n");
      const result = parseCoursebook(md);
      expect(result.chapters).toHaveLength(2);
      expect(result.nav).toEqual([
        { type: "group", title: "Week 1" },
        { type: "chapter", index: 0 },
        { type: "group", title: "Week 2" },
        { type: "chapter", index: 1 },
      ]);
    });
  });

  describe("getChapterTitle", () => {
    it("extracts the title from the first H1", () => {
      const md = "# Introduction\n\nSome content.";
      expect(getChapterTitle(md)).toBe("Introduction");
    });

    it("uses the fallback when no H1 is present", () => {
      const md = "Just some text.";
      expect(getChapterTitle(md, "Fallback Title")).toBe("Fallback Title");
    });

    it("defaults to 'Untitled' when no H1 and no fallback", () => {
      const md = "Just some text.";
      expect(getChapterTitle(md)).toBe("Untitled");
    });

    it("handles empty markdown", () => {
      expect(getChapterTitle("")).toBe("Untitled");
    });

    it("handles null/undefined markdown gracefully", () => {
      expect(getChapterTitle(null)).toBe("Untitled");
    });

    it("only matches the first H1", () => {
      const md = "# First Title\n\n## Subsection\n\n# Second Title";
      expect(getChapterTitle(md)).toBe("First Title");
    });
  });

  describe("loadCoursebook", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url) =>
          Promise.resolve({
            ok: true,
            status: 200,
            statusText: "OK",
            text: () =>
              Promise.resolve(
                url === "docs/coursebook.md"
                  ? "# Test Course\n\n- [Chapter 1](chapters/01.md)"
                  : "# Chapter 1\n\nContent.",
              ),
          }),
        ),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("fetches and parses the coursebook file", async () => {
      const result = await loadCoursebook("docs/coursebook.md");
      expect(fetch).toHaveBeenCalledWith("docs/coursebook.md");
      expect(result.title).toBe("Test Course");
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].resolvedPath).toBe("docs/chapters/01.md");
    });

    it("discovers and loads non-bullet .md links as supplements", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url) =>
          Promise.resolve({
            ok: true,
            status: 200,
            statusText: "OK",
            text: () =>
              Promise.resolve(
                url === "docs/coursebook.md"
                  ? "# Course\n\n- [Intro](chapters/01.md)\n\nSee [Extra](extra.md) for more."
                  : url === "docs/chapters/01.md"
                    ? "# Intro\n\nIntro content."
                    : "# Extra\n\nExtra content.",
              ),
          }),
        ),
      );
      const result = await loadCoursebook("docs/coursebook.md");
      expect(result.chapters).toHaveLength(2);
      expect(result.chapters[0].title).toBe("Intro");
      expect(result.chapters[1].title).toBe("Extra");
      expect(result.chapters[1].resolvedPath).toBe("docs/extra.md");
      expect(result.nav).toEqual([
        { type: "chapter", index: 0 },
        { type: "group", title: "Supplements" },
        { type: "chapter", index: 1 },
      ]);
    });

    it("does not treat image markdown links as supplements", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url) =>
          Promise.resolve({
            ok: true,
            status: 200,
            statusText: "OK",
            text: () =>
              Promise.resolve(
                url === "docs/coursebook.md"
                  ? "# Course\n\n- [Intro](chapters/01.md)\n\nSee ![diagram](chapters/02.md) for details."
                  : "# Chapter\n\nContent.",
              ),
          }),
        ),
      );
      const result = await loadCoursebook("docs/coursebook.md");
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].title).toBe("Chapter");
    });

    it("stops recursive .md link discovery at 5 levels", async () => {
      const contents = {
        "docs/coursebook.md": "# Course\n\n- [A](a.md)",
        "docs/a.md": "[B](b.md)",
        "docs/b.md": "[C](c.md)",
        "docs/c.md": "[D](d.md)",
        "docs/d.md": "[E](e.md)",
        "docs/e.md": "[F](f.md)",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url) =>
          Promise.resolve({
            ok: true,
            status: 200,
            statusText: "OK",
            text: () => Promise.resolve(contents[url] ?? "# X\n\n"),
          }),
        ),
      );
      const result = await loadCoursebook("docs/coursebook.md");
      expect(result.chapters).toHaveLength(5);
      expect(result.chapters.map((c) => c.resolvedPath)).toEqual([
        "docs/a.md",
        "docs/b.md",
        "docs/c.md",
        "docs/d.md",
        "docs/e.md",
      ]);
    });

    it("defaults to docs/coursebook.md path", async () => {
      await loadCoursebook();
      expect(fetch).toHaveBeenCalledWith("docs/coursebook.md");
    });

    it("assigns document-wide unique section slugs", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url) =>
          Promise.resolve({
            ok: true,
            status: 200,
            statusText: "OK",
            text: () =>
              Promise.resolve(
                url === "docs/coursebook.md"
                  ? "# Course\n\n- [First Intro](chapters/a.md)\n- [Second Intro](chapters/b.md)\n- [Overview](chapters/c.md)\n"
                  : url === "docs/chapters/a.md"
                    ? "# Intro"
                    : url === "docs/chapters/b.md"
                      ? "# Intro"
                      : "# Overview",
              ),
          }),
        ),
      );

      const coursebook = await loadCoursebook("docs/coursebook.md");

      // Two chapters share the h1 "Intro" and one collides with the reserved
      // landing id — slugs must stay unique for navigation.
      expect(coursebook.chapters.map((chapter) => chapter.slug)).toEqual([
        "intro",
        "intro-1",
        "overview-1",
      ]);
    });

    it("throws on fetch failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: "Not Found",
        }),
      );
      await expect(loadCoursebook()).rejects.toThrow("Failed to load coursebook");
    });
  });

  describe("loadChapter", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("fetches and returns chapter markdown content", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve("# Chapter Title\n\nContent."),
        }),
      );
      const result = await loadChapter("chapters/01.md");
      expect(fetch).toHaveBeenCalledWith("chapters/01.md");
      expect(result).toBe("# Chapter Title\n\nContent.");
    });

    it("throws on fetch failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        }),
      );
      await expect(loadChapter("chapters/01.md")).rejects.toThrow(
        "Failed to load chapter",
      );
    });
  });
});

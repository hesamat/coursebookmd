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
      const result = parseCoursebook(md);
      expect(result.chapters).toHaveLength(3);
      expect(result.chapters[0]).toEqual({
        title: "Introduction",
        path: "chapters/01-introduction.md",
      });
      expect(result.chapters[1]).toEqual({
        title: "Variables",
        path: "chapters/02-variables.md",
      });
      expect(result.chapters[2]).toEqual({
        title: "Control Flow",
        path: "chapters/03-control-flow.md",
      });
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
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve("# Test Course\n\n- [Chapter 1](chapters/01.md)"),
        }),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("fetches and parses the coursebook file", async () => {
      const result = await loadCoursebook("coursebook.md");
      expect(fetch).toHaveBeenCalledWith("coursebook.md");
      expect(result.title).toBe("Test Course");
      expect(result.chapters).toHaveLength(1);
    });

    it("defaults to coursebook.md path", async () => {
      await loadCoursebook();
      expect(fetch).toHaveBeenCalledWith("coursebook.md");
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

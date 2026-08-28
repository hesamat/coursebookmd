import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the renderer dependencies before importing the module under test
vi.mock("../renderer/markdown-renderer.js", () => ({
  renderMarkdown: vi.fn((md) => {
    const title = md.split("\n")[0].replace("# ", "");
    return `<h1>${title}</h1><p>rendered</p>`;
  }),
  sanitizeHtml: (html) => html,
}));

vi.mock("../renderer/content-enhancer.js", () => ({
  ContentEnhancer: {
    enhance: vi.fn(async (el) => {
      const pres = el.querySelectorAll("pre");
      for (const pre of pres) {
        pre.classList.add("has-copy-button");
      }
      return Promise.resolve();
    }),
    rehighlight: vi.fn(async () => {}),
    ensureStylesLoaded: vi.fn(async () => {}),
  },
}));

vi.mock("../core/coursebook-loader.js", () => ({
  loadChapter: vi.fn(async (path) => `# Chapter ${path}\n\nContent for ${path}`),
  getChapterTitle: (md, fallback) => {
    const match = md.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : fallback;
  },
}));

vi.mock("../core/theme-manager.js", () => ({
  ThemeManager: {
    getCurrentTheme: () => "dark",
    getPalette: () => "warm-graphite",
  },
}));

import { renderMarkdown } from "../renderer/markdown-renderer.js";
import {
  exportCoursebookHtml,
  exportSingleHtml,
} from "../renderer/coursebook-exporter.js";

describe("coursebook-exporter", () => {
  beforeEach(() => {
    // Inject a minimal stylesheet that looks like base.css so
    // extractCssFromDocument has something to find
    const style = document.createElement("style");
    style.dataset.viteDevId = "base.css";
    style.textContent = "body { color: red; }";
    document.head.appendChild(style);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.head.innerHTML = "";
  });

  describe("exportSingleHtml", () => {
    it("produces a valid HTML document string", async () => {
      const html = await exportSingleHtml("My Document", "# My Document\n\nHello.");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("</html>");
    });

    it("sets the title in the <title> tag", async () => {
      const html = await exportSingleHtml("My Document", "# My Document");
      expect(html).toContain("<title>My Document</title>");
    });

    it("includes data-theme and data-palette on the html element", async () => {
      const html = await exportSingleHtml("Test", "# Test");
      expect(html).toContain('data-theme="dark"');
      expect(html).toContain('data-palette="warm-graphite"');
    });

    it("includes the rendered content", async () => {
      const html = await exportSingleHtml("Test", "# Test");
      expect(html).toContain("rendered");
    });

    it("includes CSS extracted from the document", async () => {
      const html = await exportSingleHtml("Test", "# Test");
      expect(html).toContain("color: red");
    });

    it("uses app shell CSS overrides", async () => {
      const html = await exportSingleHtml("Test", "# Test");
      expect(html).toContain("body.is-export");
      expect(html).toContain(".coursebook-section");
    });

    it("inlines the export runtime bundle", async () => {
      const html = await exportSingleHtml("Test", "# Test");
      expect(html).toContain("coursebook-data");
      expect(html).toContain("CoursebookExport");
      expect(html).toContain("code-copy-button");
      expect(html).toContain("writeText");
    });

    it("escapes HTML in the title", async () => {
      const html = await exportSingleHtml("Test & <script>", "# Test");
      expect(html).toContain("&amp;");
      expect(html).toContain("&lt;script&gt;");
    });

    it("wraps content in #content div for scoped styles", async () => {
      const html = await exportSingleHtml("Test", "# Test");
      expect(html).toContain('id="content"');
    });
  });

  describe("exportCoursebookHtml", () => {
    const mockCoursebook = {
      title: "Test Course",
      markdown:
        "# Test Course\n\nWelcome.\n\n- [Intro](chapters/01.md)\n- [Vars](chapters/02.md)",
      chapters: [
        { title: "Intro", path: "chapters/01.md" },
        { title: "Vars", path: "chapters/02.md" },
      ],
    };

    it("produces a valid HTML document string", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("</html>");
    });

    it("sets the coursebook title in the <title> tag", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain("<title>Test Course</title>");
    });

    it("includes an overview section", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain('id="overview"');
      expect(html).toContain("Course Overview");
    });

    it("includes a section for each chapter", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain('id="intro"');
      expect(html).toContain('id="vars"');
      expect(html).toContain('class="coursebook-section"');
    });

    it("uses app chapter sections instead of export dividers", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).not.toContain('class="export-divider"');
      expect(html).toContain('class="coursebook-section"');
    });

    it("includes the app navigation shell", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain('class="toc-pane"');
      expect(html).toContain('id="chapterList"');
      expect(html).toContain('id="overview"');
      expect(html).toContain('id="intro"');
      expect(html).toContain('id="vars"');
    });

    it("numbers chapter headings in the content", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      // The mock loadChapter returns "# Chapter chapters/01.md", so the
      // extracted title is "Chapter chapters/01.md" and section numbering
      // prefixes it with the chapter number.
      expect(html).toContain(
        '<span class="heading-number">1 </span>Chapter chapters/01.md',
      );
      expect(html).toContain(
        '<span class="heading-number">2 </span>Chapter chapters/02.md',
      );
    });

    it("inlines the export runtime bundle", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain("coursebook-data");
      expect(html).toContain("CoursebookExport");
      expect(html).toContain("coursebook-section");
    });

    it("handles a coursebook with no chapters", async () => {
      const emptyCoursebook = {
        title: "Empty Course",
        markdown: "# Empty Course\n\nNo chapters.",
        chapters: [],
      };
      const html = await exportCoursebookHtml(emptyCoursebook);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain('id="overview"');
      expect(html).toContain("Course Overview");
    });

    it("escapes HTML in chapter titles", async () => {
      const coursebook = {
        title: "Test & Course",
        markdown: "# Test & Course",
        chapters: [{ title: "Chapter <b>", path: "chapters/01.md" }],
      };
      const html = await exportCoursebookHtml(coursebook);
      expect(html).toContain("Test &amp; Course");
    });

    it("rewrites in-content .md chapter links to hash slugs", async () => {
      const coursebook = {
        title: "Course",
        markdown: "# Course\n\n- [Intro](chapters/01.md)\n- [Advanced](chapters/02.md)",
        parentPath: "docs/coursebook.md",
        chapters: [
          {
            title: "Intro",
            path: "chapters/01.md",
            resolvedPath: "docs/chapters/01.md",
          },
          {
            title: "Advanced",
            path: "chapters/02.md",
            resolvedPath: "docs/chapters/02.md",
            markdown: "See [Intro](../chapters/01.md) for background.",
          },
        ],
      };
      renderMarkdown.mockImplementation((md) => {
        const lines = md.split("\n");
        const title = lines[0].replace(/^#\s*/, "");
        const rest = lines.slice(1).join("\n").trim();
        const linkMatch = rest.match(/\[([^\]]+)\]\(([^)]+)\)/);
        const extra = linkMatch ? `<a href="${linkMatch[2]}">${linkMatch[1]}</a>` : "";
        const body = rest.replace(/\[([^\]]+)\]\(([^)]+)\)\s*/, "");
        return `<h1>${title}</h1><p>${body}${extra}</p>`;
      });
      const html = await exportCoursebookHtml(coursebook);
      expect(html).toContain('href="#intro"');
      expect(html).not.toContain('href="../chapters/01.md"');
      expect(html).not.toContain('href="docs/chapters/01.md"');
    });
  });
});

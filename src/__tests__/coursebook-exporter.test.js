import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the renderer dependencies before importing the module under test
vi.mock("../renderer/markdown-renderer.js", () => ({
  renderMarkdown: (md) =>
    `<h1>${md.split("\n")[0].replace("# ", "")}</h1><p>rendered</p>`,
}));

vi.mock("../renderer/content-enhancer.js", () => ({
  ContentEnhancer: {
    enhance: vi.fn(async (el) => {
      // Simulate enhancement by adding a class to code blocks
      const pres = el.querySelectorAll("pre");
      for (const pre of pres) {
        pre.classList.add("has-copy-button");
      }
      return Promise.resolve();
    }),
    rehighlight: vi.fn(async () => {}),
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

import {
  exportCoursebookHtml,
  exportSingleHtml,
} from "../renderer/coursebook-exporter.js";

describe("coursebook-exporter", () => {
  beforeEach(() => {
    // Inject a minimal stylesheet so extractCssFromDocument has something to find
    const style = document.createElement("style");
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

    it("includes the export layout CSS", async () => {
      const html = await exportSingleHtml("Test", "# Test");
      expect(html).toContain(".export-layout");
      expect(html).toContain(".export-sidebar");
    });

    it("includes the copy button script", async () => {
      const html = await exportSingleHtml("Test", "# Test");
      expect(html).toContain("code-copy-button");
      expect(html).toContain("navigator.clipboard.writeText");
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
      expect(html).toContain("Overview");
    });

    it("includes a section for each chapter", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain('id="chapter-1"');
      expect(html).toContain('id="chapter-2"');
    });

    it("includes chapter dividers between sections", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain('class="export-divider"');
    });

    it("includes sidebar navigation with all chapters", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain(".export-sidebar");
      expect(html).toContain("#overview");
      expect(html).toContain("#chapter-1");
      expect(html).toContain("#chapter-2");
    });

    it("numbers chapters in the nav", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      // The mock loadChapter returns "# Chapter chapters/01.md", so the
      // extracted title is "Chapter chapters/01.md"
      expect(html).toContain("1. Chapter chapters/01.md");
      expect(html).toContain("2. Chapter chapters/02.md");
    });

    it("includes the scroll-spy script", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain("updateActive");
      expect(html).toContain("export-section");
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
      // Should still have the overview nav item
      expect(html).toContain("#overview");
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
  });
});

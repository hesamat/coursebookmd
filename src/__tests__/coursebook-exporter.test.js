import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the renderer dependencies before importing the module under test
vi.mock("../renderer/markdown-renderer.js", () => ({
  renderMarkdown: vi.fn((md) => {
    const title = md.split("\n")[0].replace("# ", "");
    const term = md.includes("==Zebra==") ? ' <span class="idx">Zebra</span>' : "";
    return `<h1>${title}</h1><p>rendered${term}</p>`;
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

vi.mock("../core/coursebook-loader.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadChapter: vi.fn(async (path) => `# Chapter ${path}\n\nContent for ${path}`),
    getChapterTitle: (md, fallback) => {
      const match = md.match(/^#\s+(.+)$/m);
      return match ? match[1].trim() : fallback;
    },
  };
});

vi.mock("../core/theme-manager.js", () => ({
  ThemeManager: {
    getCurrentTheme: () => "dark",
    getPalette: () => "warm-graphite",
  },
}));

import { renderMarkdown } from "../renderer/markdown-renderer.js";
import { ContentEnhancer } from "../renderer/content-enhancer.js";
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

    // The export clones the app's presentation chrome (overlay + shortcuts
    // sheet) from the live document; stub them the way index.html has them.
    const overlay = document.createElement("div");
    overlay.id = "overlay";
    overlay.className = "overlay";
    overlay.innerHTML =
      '<div class="overlay__current" id="overlayCurrent"></div><div class="overlay__progress" id="overlayProgress"></div>';
    document.body.appendChild(overlay);

    const sheet = document.createElement("div");
    sheet.id = "shortcutsSheet";
    sheet.className = "shortcuts-sheet";
    sheet.innerHTML =
      '<div class="shortcuts-sheet__grid" id="shortcutsSheetPresent">' +
      '<div class="shortcuts-sheet__row" data-app-only><span>Edit mode</span></div>' +
      '<div class="shortcuts-sheet__row"><span>Esc exit</span></div>' +
      "</div>";
    document.body.appendChild(sheet);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
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

    it("appends a general index section for ==term== occurrences", async () => {
      renderMarkdown.mockImplementation((md) => {
        const title = md.split("\n")[0].replace(/^#\s*/, "");
        const term = md.includes("==Zebra==") ? ' <span class="idx">Zebra</span>' : "";
        return `<h1>${title}</h1><p>rendered${term}</p>`;
      });
      const coursebook = {
        title: "Course",
        markdown: "# Course\n\nWelcome ==Zebra==.",
        chapters: [{ title: "Intro", path: "chapters/01.md" }],
      };
      const html = await exportCoursebookHtml(coursebook);
      expect(html).toContain('id="index"');
      expect(html).toContain('class="coursebook-section index-section"');
      expect(html).toContain('class="idx-link"');
      expect(html).toContain('data-target="idx-zebra"');
      expect(html).toContain('id="idx-zebra"');
    });

    it("keeps the index section out of the runtime section config", async () => {
      renderMarkdown.mockImplementation((md) => {
        const title = md.split("\n")[0].replace(/^#\s*/, "");
        const term = md.includes("==Zebra==") ? ' <span class="idx">Zebra</span>' : "";
        return `<h1>${title}</h1><p>rendered${term}</p>`;
      });
      const coursebook = {
        title: "Course",
        markdown: "# Course\n\nWelcome ==Zebra==.",
        chapters: [{ title: "Intro", path: "chapters/01.md" }],
      };
      const html = await exportCoursebookHtml(coursebook);
      const config = JSON.parse(
        html.match(
          /<script id="coursebook-data" type="application\/json">([\s\S]*?)<\/script>/,
        )[1],
      );
      const ids = config.sections.map((s) => s.id);
      expect(ids).toEqual(["overview", "intro"]);
      expect(ids).not.toContain("index");
    });

    it("omits the index section when there are no terms", async () => {
      renderMarkdown.mockImplementation((md) => {
        const title = md.split("\n")[0].replace(/^#\s*/, "");
        return `<h1>${title}</h1><p>rendered</p>`;
      });
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).not.toContain('id="index"');
      expect(html).not.toContain('class="coursebook-section index-section"');
    });
  });

  describe("doc-site export shell", () => {
    const mockCoursebook = {
      title: "Test Course",
      markdown: "# Test Course\n\nWelcome.",
      chapters: [{ title: "Intro", path: "chapters/01.md" }],
    };

    it("renders a header with the title, a sidebar toggle, and search", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      const header = html.match(/<header class="export-header">([\s\S]*?)<\/header>/)[1];
      expect(header).toContain('<span class="export-header__title">Test Course</span>');
      expect(header).toContain('id="sidebarToggleBtn"');
      expect(header).toContain('id="searchBox"');
      expect(header).toContain('id="searchInput"');
      expect(header).toContain('id="searchResults"');
      // The sidebar keeps only its title; the toggle moved to the header.
      const tocHeader = html.match(/<div class="toc-pane__header">([\s\S]*?)<\/div>/)[1];
      expect(tocHeader).toContain("Contents");
      expect(tocHeader).not.toContain("sidebarToggleBtn");
      // The old in-pane collapse toggle is gone.
      expect(html).not.toContain('id="tocToggleBtn"');
    });

    it("hides the search box and sidebar toggle for no-JS readers", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)[1];
      expect(noscript).toContain("#sidebarToggleBtn");
      expect(noscript).toContain("#searchBox");
    });

    it("neutralizes the app's peek-out chevron for the closed sidebar", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      // The toggle stays in the header when the sidebar closes; layout.css's
      // fixed peek-out handle rules must be overridden.
      expect(html).toContain(
        "body.is-export.sidebar-closed #sidebarToggleBtn {\n      position: static;",
      );
    });

    it("renders the floating present/theme actions", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain('class="action-cluster"');
      expect(html).toContain('id="presentBtn"');
      expect(html).toContain('id="themeToggleBtn"');
      expect(html).not.toContain("theme-toggle-float");
      // The cluster styles are the app's own (controls.css), not export-local.
      expect(html).not.toContain(".export-actions");
    });

    it("clones the overlay and shortcuts sheet from the app markup", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain('id="overlay"');
      expect(html).toContain('id="overlayCurrent"');
      expect(html).toContain('id="shortcutsSheet"');
      // App-only rows (edit mode) are stripped from the clone…
      expect(html).not.toContain("data-app-only");
      expect(html).not.toContain("Edit mode");
      // …and the sheet is cloned closed even if the app had it open.
      const sheet = html.match(/<div[\s\S]*?id="shortcutsSheet"[^>]*>/)[0];
      expect(sheet).toContain("hidden");
    });

    it("marks only the overview section active for no-JS readability", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain(
        '<section id="overview" class="coursebook-section landing active">',
      );
      expect(html).toContain('<section id="intro" class="coursebook-section">');
    });

    it("includes a noscript fallback that reveals every section", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain("<noscript>");
      const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)[1];
      expect(noscript).toContain(".coursebook-section");
      expect(noscript).toContain("display: block");
    });

    it("includes meta description, favicon, and generator tags", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      expect(html).toContain('name="description" content="rendered"');
      expect(html).toContain('name="generator" content="CoursebookMD"');
      expect(html).toMatch(/<link rel="icon" href="data:image\/png;base64,/);
    });

    it("truncates long meta descriptions", async () => {
      renderMarkdown.mockImplementation((md) => {
        const title = md.split("\n")[0].replace(/^#\s*/, "");
        const longText = "This overview paragraph keeps going and going "
          .repeat(6)
          .trim();
        return `<h1>${title}</h1><p>${longText}</p>`;
      });
      const html = await exportCoursebookHtml({
        title: "Long",
        markdown: "# Long",
        chapters: [],
      });
      const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
      expect(description.length).toBeLessThanOrEqual(160);
      expect(description.endsWith("…")).toBe(true);
    });

    it("strips data-src-line source-map attributes from serialized content", async () => {
      renderMarkdown.mockImplementation((md) => {
        const title = md.split("\n")[0].replace(/^#\s*/, "");
        return `<h1 data-src-line="1">${title}</h1><p data-src-line="3">rendered</p>`;
      });
      const html = await exportCoursebookHtml(mockCoursebook);
      // The inlined runtime bundle mentions the attribute name (it comes from
      // a shared module); the serialized content must carry no instances.
      expect(html).not.toContain('data-src-line="1"');
      expect(html).not.toContain('data-src-line="3"');
    });

    it("skips KaTeX CSS loading for math-free books", async () => {
      ContentEnhancer.ensureStylesLoaded.mockClear();
      await exportCoursebookHtml(mockCoursebook);
      expect(ContentEnhancer.ensureStylesLoaded).not.toHaveBeenCalled();
    });

    it("loads KaTeX CSS when the book contains rendered math", async () => {
      ContentEnhancer.ensureStylesLoaded.mockClear();
      renderMarkdown.mockImplementation((md) => {
        const title = md.split("\n")[0].replace(/^#\s*/, "");
        return `<h1>${title}</h1><p><span class="katex">$x$</span></p>`;
      });
      await exportCoursebookHtml(mockCoursebook);
      expect(ContentEnhancer.ensureStylesLoaded).toHaveBeenCalledTimes(1);
    });

    it("includes the dark-mode code override in the export CSS", async () => {
      const html = await exportCoursebookHtml(mockCoursebook);
      // All blocks — terminal fences included — follow the theme, matching
      // the app's highlighting behavior.
      expect(html).toMatch(/\[data-theme="dark"\] #content pre\.shiki span/);
      expect(html).not.toContain("pre.shiki:not(.command)");
    });
  });
});

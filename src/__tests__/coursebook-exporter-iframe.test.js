import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../renderer/content-enhancer.js", () => ({
  ContentEnhancer: {
    enhance: vi.fn(async () => {}),
    rehighlight: vi.fn(async () => {}),
    ensureStylesLoaded: vi.fn(async () => {}),
  },
}));

vi.mock("../core/theme-manager.js", () => ({
  ThemeManager: {
    getCurrentTheme: () => "dark",
    getPalette: () => "warm-graphite",
  },
}));

vi.mock("../core/coursebook-loader.js", () => ({
  loadChapter: vi.fn((path) =>
    Promise.resolve(readFileSync(resolve(`docs/${path}`), "utf-8")),
  ),
  getChapterTitle: (md, fallback) => {
    const match = md.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : fallback;
  },
}));

import { exportCoursebookHtml } from "../renderer/coursebook-exporter.js";

function readDoc(name) {
  return readFileSync(resolve(`docs/${name}`), "utf-8");
}

describe("coursebook-exporter integration", () => {
  beforeEach(() => {
    const style = document.createElement("style");
    style.dataset.viteDevId = "base.css";
    style.textContent = "body { color: red; }";
    document.head.appendChild(style);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const match = url.match(/\/docs\/assets\/([^?#]+)$/);
        if (match) {
          const file = readFileSync(resolve(`docs/assets/${match[1]}`));
          return {
            ok: true,
            status: 200,
            headers: {
              get: (key) =>
                key.toLowerCase() === "content-type" ? "image/svg+xml" : null,
            },
            arrayBuffer: async () => new Uint8Array(file).buffer,
          };
        }
        return {
          ok: false,
          status: 404,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves iframes and inlines local images in the exported HTML", async () => {
    const coursebook = {
      title: "CoursebookMD — User Guide",
      markdown: readDoc("coursebook.md"),
      chapters: [
        { title: "Getting Started", path: "chapters/01-getting-started.md" },
        { title: "Writing Content", path: "chapters/02-writing-content.md" },
        { title: "Rich Content", path: "chapters/03-rich-content.md" },
        { title: "Present and Export", path: "chapters/04-present-and-export.md" },
      ],
    };

    const html = await exportCoursebookHtml(coursebook);
    expect(html).toContain("httpbin.org/html");
    expect(html).toContain("youtube.com/embed/8mAITcNt710");
    // Security: srcdoc iframes are sandboxed (preserved, but with sandbox=""
    // so they run in a unique origin). YouTube/src iframes are left alone.
    expect(html).toContain("srcdoc=");
    expect(html).not.toContain(
      'sandbox="" src="https://www.youtube.com/embed/M7lc1UVf-VE"',
    );

    // Local SVG images are inlined as data URIs.
    expect(html).toContain("data:image/svg+xml;base64,");
    expect(html).not.toContain('/docs/assets/coursebook-structure.svg"');

    // Write the HTML to /tmp so we can inspect it manually
    const fs = await import("node:fs");
    fs.writeFileSync("/tmp/coursebookmd-export.html", html);
  });
});

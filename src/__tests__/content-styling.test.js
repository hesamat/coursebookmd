import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../renderer/markdown-renderer.js";
import { __test } from "../renderer/content-enhancer.js";

const { enhanceBlockquotes, addFigureCaptions } = __test;

function container(html) {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("content styling — markdown rendering", () => {
  describe("mandatory headings", () => {
    it("tags ## Mandatory: Title with class mandatory", () => {
      const html = renderMarkdown("## Mandatory: Submit your lab");
      expect(html).toContain('<h2 class="mandatory" data-src-line="1">');
    });

    it("preserves the full title text", () => {
      const html = renderMarkdown("## Mandatory: Submit your lab");
      expect(html).toContain("Mandatory: Submit your lab");
    });

    it("does not tag regular headings", () => {
      const html = renderMarkdown("## Optional reading");
      expect(html).not.toContain('class="mandatory"');
    });
  });

  describe("fences", () => {
    it("does not treat `command` as a special fence language", () => {
      const html = renderMarkdown("```command\nnpm install\n```");
      expect(html).not.toContain('class="command"');
      expect(html).toContain("language-command");
    });
  });
});

describe("content styling — DOM enhancers", () => {
  describe("enhanceBlockquotes", () => {
    it("tags a Warning blockquote", () => {
      const el = container(
        "<blockquote><p><strong>Warning:</strong> hot surface</p></blockquote>",
      );
      enhanceBlockquotes(el);
      const bq = el.querySelector("blockquote");
      expect(bq.classList.contains("admonition")).toBe(true);
      expect(bq.classList.contains("admonition-warning")).toBe(true);
      expect(bq.querySelector(".admonition-label")).not.toBeNull();
    });

    it("tags a Note blockquote without trailing colon", () => {
      const el = container(
        "<blockquote><p><strong>Note</strong> see also</p></blockquote>",
      );
      enhanceBlockquotes(el);
      expect(el.querySelector("blockquote").classList.contains("admonition-note")).toBe(
        true,
      );
    });

    it("ignores plain blockquotes", () => {
      const el = container("<blockquote><p>just a quote</p></blockquote>");
      enhanceBlockquotes(el);
      expect(el.querySelector("blockquote").classList.contains("admonition")).toBe(false);
    });

    it("is idempotent", () => {
      const el = container("<blockquote><p><strong>Tip:</strong> x</p></blockquote>");
      enhanceBlockquotes(el);
      enhanceBlockquotes(el);
      const labels = el.querySelectorAll(".admonition-label");
      expect(labels.length).toBe(1);
    });
  });

  describe("addFigureCaptions", () => {
    it("wraps a standalone image with alt in a figure and numbers it", () => {
      const el = container('<p><img alt="Diagram" src="a.png"></p>');
      addFigureCaptions(el);
      const fig = el.querySelector("figure.figure");
      expect(fig).not.toBeNull();
      const cap = el.querySelector(".figure-caption");
      expect(cap.textContent).toBe("Figure 1. Diagram");
    });

    it("numbers figures sequentially across the root", () => {
      const el = container(
        '<p><img alt="First" src="a.png"></p><p><img alt="Second" src="b.png"></p>',
      );
      addFigureCaptions(el);
      const caps = el.querySelectorAll(".figure-caption");
      expect(caps[0].textContent).toBe("Figure 1. First");
      expect(caps[1].textContent).toBe("Figure 2. Second");
    });

    it("leaves inline images (mixed with text) alone", () => {
      const el = container('<p>See <img alt="x" src="a.png"> here.</p>');
      addFigureCaptions(el);
      expect(el.querySelector("figure")).toBeNull();
    });

    it("ignores images with empty alt", () => {
      const el = container('<p><img alt="" src="a.png"></p>');
      addFigureCaptions(el);
      expect(el.querySelector("figure")).toBeNull();
    });
  });
});

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

    it("preserves character references in fence metadata", () => {
      const html = renderMarkdown('```d2 caption="Fish &quot; chips"\nx -> y\n```');
      expect(html).toContain('data-info="d2 caption=&quot;Fish &amp;quot; chips&quot;"');
    });
  });

  describe("tables", () => {
    const table = "| a | b |\n| --- | --- |\n| 1 | 2 |";

    it("wraps a table in a horizontal scroll container", () => {
      const el = container(renderMarkdown(table));
      const wrapper = el.querySelector(".table-scroll");
      expect(wrapper).not.toBeNull();
      expect(wrapper.querySelector("table")).not.toBeNull();
      // The wrapper is the top-level block, so the editor's in-place
      // reconciliation sees the same shape as a fresh render.
      expect(el.firstElementChild.classList.contains("table-scroll")).toBe(true);
    });

    it("keeps the source line on the table itself", () => {
      const el = container(renderMarkdown(table));
      expect(el.querySelector("table").getAttribute("data-src-line")).toBe("1");
    });

    it("does not double-wrap a table", () => {
      const el = container(renderMarkdown(table));
      expect(el.querySelectorAll(".table-scroll")).toHaveLength(1);
      expect(el.querySelector(".table-scroll .table-scroll")).toBeNull();
    });
  });
});

describe("content styling — DOM enhancers", () => {
  describe("enhanceBlockquotes", () => {
    it("tags a Warning blockquote with an icon title row", () => {
      const el = container(
        "<blockquote><p><strong>Warning:</strong> hot surface</p></blockquote>",
      );
      enhanceBlockquotes(el);
      const bq = el.querySelector("blockquote");
      expect(bq.classList.contains("admonition")).toBe(true);
      expect(bq.classList.contains("admonition-warning")).toBe(true);
      const title = bq.querySelector(".admonition-title");
      expect(title).not.toBeNull();
      expect(title.querySelector("svg")).not.toBeNull();
      expect(title.querySelector(".admonition-title-text").textContent).toBe("Warning");
      // The strong label is consumed by the title; body text stays below it.
      expect(bq.querySelector("p").textContent).toBe(" hot surface");
    });

    it("tags a Note blockquote without trailing colon", () => {
      const el = container(
        "<blockquote><p><strong>Note</strong> see also</p></blockquote>",
      );
      enhanceBlockquotes(el);
      const bq = el.querySelector("blockquote");
      expect(bq.classList.contains("admonition-note")).toBe(true);
      expect(bq.querySelector(".admonition-title-text").textContent).toBe("Note");
    });

    it("drops the first paragraph when the label is all it held", () => {
      const el = container("<blockquote><p><strong>Note:</strong></p></blockquote>");
      enhanceBlockquotes(el);
      const bq = el.querySelector("blockquote");
      expect(bq.querySelector("p")).toBeNull();
      expect(bq.querySelector(".admonition-title")).not.toBeNull();
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
      const titles = el.querySelectorAll(".admonition-title");
      expect(titles.length).toBe(1);
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

describe("classifyTableImages", () => {
  function tableImg(width, height) {
    const el = container('<table><tr><td><img src="photo.png" alt=""></td></tr></table>');
    const img = el.querySelector("img");
    Object.defineProperty(img, "naturalWidth", {
      configurable: true,
      value: width,
    });
    Object.defineProperty(img, "naturalHeight", {
      configurable: true,
      value: height,
    });
    Object.defineProperty(img, "complete", {
      configurable: true,
      value: true,
    });
    return { el, img };
  }

  it("tags small cell images as symbols for natural-size rendering", () => {
    const { el, img } = tableImg(200, 120);
    __test.classifyTableImages(el);
    expect(img.classList.contains("table-img-symbol")).toBe(true);
  });

  it("leaves photo-sized cell images on the thumbnail treatment", () => {
    const { el, img } = tableImg(1600, 900);
    __test.classifyTableImages(el);
    expect(img.classList.contains("table-img-symbol")).toBe(false);
  });

  it("does not classify unloaded images", () => {
    const { el, img } = tableImg(200, 120);
    Object.defineProperty(img, "complete", {
      configurable: true,
      value: false,
    });
    __test.classifyTableImages(el);
    expect(img.classList.contains("table-img-symbol")).toBe(false);
  });

  it("tags svg sources as symbols regardless of natural size", () => {
    const el = container(
      '<table><tr><td><img src="../assets/flow-line.svg" alt=""></td></tr></table>',
    );
    const img = el.querySelector("img");
    Object.defineProperty(img, "naturalWidth", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(img, "naturalHeight", {
      configurable: true,
      value: 480,
    });
    Object.defineProperty(img, "complete", {
      configurable: true,
      value: true,
    });
    __test.classifyTableImages(el);
    expect(img.classList.contains("table-img-symbol")).toBe(true);
  });

  it("classifies blob-rewritten images through the preserved source path", () => {
    const el = container(
      '<table><tr><td><img src="blob:http://localhost/uuid" alt=""></td></tr></table>',
    );
    const img = el.querySelector("img");
    img.dataset.localAsset = "../assets/flow-io.svg";
    Object.defineProperty(img, "naturalWidth", {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(img, "naturalHeight", {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(img, "complete", {
      configurable: true,
      value: true,
    });
    __test.classifyTableImages(el);
    expect(img.classList.contains("table-img-symbol")).toBe(true);
  });

  it("tags inlined svg data URIs as symbols regardless of natural size", () => {
    const el = container(
      '<table><tr><td><img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4" alt=""></td></tr></table>',
    );
    const img = el.querySelector("img");
    Object.defineProperty(img, "naturalWidth", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(img, "naturalHeight", {
      configurable: true,
      value: 480,
    });
    Object.defineProperty(img, "complete", {
      configurable: true,
      value: true,
    });
    __test.classifyTableImages(el);
    expect(img.classList.contains("table-img-symbol")).toBe(true);
  });
});

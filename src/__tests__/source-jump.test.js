import { describe, it, expect } from "vitest";
import { renderMarkdown, sanitizeHtml } from "../renderer/markdown-renderer.js";
import { __test as __testEnhancer } from "../renderer/content-enhancer.js";
import {
  annotatedLine,
  resolveSourceLine,
  SOURCE_TARGET_SELECTOR,
} from "../core/source-jump.js";

/** Render markdown, sanitize it, and return the parsed container element. */
function renderToBody(markdown) {
  const container = document.createElement("div");
  container.innerHTML = sanitizeHtml(renderMarkdown(markdown));
  return container;
}

describe("renderer source annotations", () => {
  it("tags a heading with its 1-based source line", () => {
    const container = renderToBody("intro\n\n# Heading\n");
    const h1 = container.querySelector("h1");
    expect(h1.getAttribute("data-src-line")).toBe("3");
  });

  it("tags paragraphs with their source line", () => {
    const container = renderToBody("para one\n\npara two\n");
    const [first, second] = container.querySelectorAll("p");
    expect(first.getAttribute("data-src-line")).toBe("1");
    expect(second.getAttribute("data-src-line")).toBe("3");
  });

  it("tags a fenced code block with the fence line", () => {
    const container = renderToBody("text\n\n```js\nlet a = 1;\n```\n");
    const pre = container.querySelector("pre");
    expect(pre.getAttribute("data-src-line")).toBe("3");
  });

  it("tags lists and items with their own source lines", () => {
    const container = renderToBody("- one\n- two\n- three\n");
    const ul = container.querySelector("ul");
    const items = container.querySelectorAll("li");
    expect(ul.getAttribute("data-src-line")).toBe("1");
    expect(items[0].getAttribute("data-src-line")).toBe("1");
    expect(items[1].getAttribute("data-src-line")).toBe("2");
    expect(items[2].getAttribute("data-src-line")).toBe("3");
  });

  it("tags blockquotes and headings inside them with absolute lines", () => {
    const container = renderToBody("> ## Inner\n>\n> after\n");
    const bq = container.querySelector("blockquote");
    const h2 = container.querySelector("h2");
    const p = container.querySelector("blockquote p");
    expect(bq.getAttribute("data-src-line")).toBe("1");
    expect(h2.getAttribute("data-src-line")).toBe("1");
    expect(p.getAttribute("data-src-line")).toBe("3");
  });

  it("tags tables with the header row line", () => {
    const container = renderToBody("| a | b |\n| - | - |\n| 1 | 2 |\n");
    expect(container.querySelector("table").getAttribute("data-src-line")).toBe("1");
  });

  it("figure captions keep the wrapped paragraph's source line", () => {
    const { addFigureCaptions } = __testEnhancer;
    const container = renderToBody("![logo](x.png)\n");
    addFigureCaptions(container);
    const figure = container.querySelector("figure");
    expect(figure.getAttribute("data-src-line")).toBe("1");
    expect(resolveSourceLine(figure.querySelector("figcaption"), container)).toBe(1);
  });

  it("sanitizer keeps data-src-line on rendered output", () => {
    const clean = sanitizeHtml(renderMarkdown("text\n\n## Head\n"));
    expect(clean).toContain('data-src-line="3"');
  });

  it("sanitizer keeps data-src-line on pre elements", () => {
    const result = sanitizeHtml('<pre data-src-line="9"><code>x</code></pre>');
    expect(result).toContain('data-src-line="9"');
  });
});

describe("resolveSourceLine", () => {
  function section(html) {
    const el = document.createElement("section");
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }

  it("returns the element's own annotation", () => {
    const scope = section('<h2 data-src-line="3">H</h2>');
    const target = scope.querySelector("h2");
    expect(resolveSourceLine(target, scope)).toBe(3);
    scope.remove();
  });

  it("falls back to the nearest annotated ancestor", () => {
    const scope = section('<p data-src-line="7">text <span>span</span></p>');
    const target = scope.querySelector("span");
    expect(resolveSourceLine(target, scope)).toBe(7);
    scope.remove();
  });

  it("falls back to the closest preceding annotated element", () => {
    const scope = section(
      '<h2 data-src-line="5">Head</h2><figure><img src="x"><figcaption>cap</figcaption></figure>',
    );
    const target = scope.querySelector("figcaption");
    expect(resolveSourceLine(target, scope)).toBe(5);
    scope.remove();
  });

  it("never falls forward to later annotations", () => {
    const scope = section(
      '<p data-src-line="3">before</p><p>unannotated target</p><p data-src-line="9">later</p>',
    );
    const target = scope.querySelectorAll("p")[1];
    expect(resolveSourceLine(target, scope)).toBe(3);
    scope.remove();
  });

  it("returns null when nothing in scope maps to a source line", () => {
    const scope = section("<p>unannotated</p>");
    const target = scope.querySelector("p");
    expect(resolveSourceLine(target, scope)).toBe(null);
    scope.remove();
  });

  it("ignores annotations outside the scope", () => {
    const outer = document.createElement("div");
    outer.innerHTML =
      '<section id="a"><p data-src-line="1">annotated</p></section>' +
      '<section id="b"><p>target in second section</p></section>';
    document.body.appendChild(outer);
    const scope = outer.querySelector("#a + section") ?? outer.lastElementChild;
    const target = scope.querySelector("p");
    expect(resolveSourceLine(target, scope)).toBe(null);
    outer.remove();
  });

  it("rejects malformed line attributes", () => {
    expect(annotatedLine(element("p", "0"))).toBeNull();
    expect(annotatedLine(element("p", "abc"))).toBeNull();
    expect(annotatedLine(element("p", "-2"))).toBeNull();
    expect(annotatedLine(element("p"))).toBeNull();
  });

  function element(tag, line) {
    const el = document.createElement(tag);
    if (line !== undefined) el.setAttribute("data-src-line", line);
    return el;
  }

  it("exposes a selector covering jumpable preview elements", () => {
    const scope = section('<h2 data-src-line="1">H</h2><p data-src-line="3">P</p>');
    const target = scope.querySelector("p");
    expect(target.matches(SOURCE_TARGET_SELECTOR)).toBe(true);
    scope.remove();
  });
});

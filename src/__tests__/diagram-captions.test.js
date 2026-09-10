import { describe, it, expect } from "vitest";
import { __test } from "../renderer/content-enhancer.js";

const { addDiagramCaptions, addFigureCaptions } = __test;

function container(html) {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("addDiagramCaptions", () => {
  it("wraps a captioned diagram in a numbered figure", () => {
    const el = container(
      '<div class="d2-diagram" data-source="x -&gt; y" data-caption="My diagram"></div>',
    );
    addDiagramCaptions(el);

    const fig = el.querySelector("figure.figure");
    expect(fig).not.toBeNull();
    const cap = fig.querySelector("figcaption.figure-caption");
    expect(cap).not.toBeNull();
    expect(cap.textContent).toBe("Figure 1. My diagram");
    // Diagram stays inside the figure
    expect(fig.querySelector(".d2-diagram")).not.toBeNull();
  });

  it("numbers diagrams sequentially across the root", () => {
    const el = container(
      '<div class="d2-diagram" data-source="a" data-caption="First"></div>' +
        '<div class="svg-diagram" data-source="b" data-caption="Second"></div>',
    );
    addDiagramCaptions(el);

    const caps = el.querySelectorAll(".figure-caption");
    expect(caps[0].textContent).toBe("Figure 1. First");
    expect(caps[1].textContent).toBe("Figure 2. Second");
  });

  it("numbers image and diagram captions together in document order", () => {
    const el = container(
      '<div class="d2-diagram" data-source="a" data-caption="Diagram"></div>' +
        '<p><img alt="Image" src="image.png"></p>',
    );
    addFigureCaptions(el);
    addDiagramCaptions(el);

    const caps = el.querySelectorAll(".figure-caption");
    expect(caps[0].textContent).toBe("Figure 1. Diagram");
    expect(caps[1].textContent).toBe("Figure 2. Image");
  });

  it("restarts figure numbering in each chapter", () => {
    const el = container(
      '<section class="coursebook-section">' +
        '<p><img alt="First image" src="first.png"></p>' +
        '<div class="d2-diagram" data-source="a" data-caption="First diagram"></div>' +
        "</section>" +
        '<section class="coursebook-section">' +
        '<div class="svg-diagram" data-source="b" data-caption="Second diagram"></div>' +
        "</section>",
    );
    addFigureCaptions(el);
    addDiagramCaptions(el);

    const caps = el.querySelectorAll(".figure-caption");
    expect(Array.from(caps, (caption) => caption.textContent)).toEqual([
      "Figure 1. First image",
      "Figure 2. First diagram",
      "Figure 1. Second diagram",
    ]);
  });

  it("is idempotent", () => {
    const el = container(
      '<div class="d2-diagram" data-source="a" data-caption="Diagram"></div>',
    );
    addDiagramCaptions(el);
    addDiagramCaptions(el);

    expect(el.querySelectorAll("figure.figure")).toHaveLength(1);
    expect(el.querySelector(".figure-caption").textContent).toBe("Figure 1. Diagram");
  });

  it("skips diagrams without a caption", () => {
    const el = container('<div class="d2-diagram" data-source="x"></div>');
    addDiagramCaptions(el);

    expect(el.querySelector("figure")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { __test } from "../renderer/content-enhancer.js";

const { convertDiagramCodeBlocks, normalizeDiagramHeight } = __test;

function convert(info) {
  const root = document.createElement("div");
  const escaped = info.replace(/"/g, "&quot;");
  root.innerHTML = `<pre data-info="${escaped}"><code class="language-d2">x -&gt; y</code></pre>`;
  convertDiagramCodeBlocks(root);
  return root.querySelector(".d2-diagram");
}

function capOf(div) {
  return div.style.getPropertyValue("--diagram-max-height");
}

describe("normalizeDiagramHeight", () => {
  it("converts bare numbers to pixels", () => {
    expect(normalizeDiagramHeight("300")).toBe("300px");
    expect(normalizeDiagramHeight("12.5")).toBe("12.5px");
  });

  it("passes CSS lengths and none through", () => {
    expect(normalizeDiagramHeight("80vh")).toBe("80vh");
    expect(normalizeDiagramHeight("12em")).toBe("12em");
    expect(normalizeDiagramHeight("50%")).toBe("50%");
    expect(normalizeDiagramHeight("none")).toBe("none");
  });

  it("rejects values that would uncapped the diagram", () => {
    expect(normalizeDiagramHeight("banana")).toBeNull();
    expect(normalizeDiagramHeight("vh")).toBeNull();
    expect(normalizeDiagramHeight("-300")).toBeNull();
    expect(normalizeDiagramHeight("")).toBeNull();
  });
});

describe("convertDiagramCodeBlocks height= option", () => {
  it("sets the cap custom property from a bare number", () => {
    const div = convert("height=300");
    expect(capOf(div)).toBe("300px");
  });

  it("passes CSS length values through", () => {
    expect(capOf(convert("height=80vh"))).toBe("80vh");
  });

  it("strips quotes from the value", () => {
    expect(capOf(convert('height="80vh"'))).toBe("80vh");
    expect(capOf(convert("height='300'"))).toBe("300px");
  });

  it("keeps the default cap for unrecognized values", () => {
    const div = convert("height=banana");
    expect(capOf(div)).toBe("");
  });

  it("leaves fences without height= untouched", () => {
    expect(capOf(convert(""))).toBe("");
    expect(capOf(convert('caption="Flow"'))).toBe("");
  });

  it("combines with caption= in the same info string", () => {
    const div = convert('caption="Flow" height=300');
    expect(div.getAttribute("data-caption")).toBe("Flow");
    expect(capOf(div)).toBe("300px");
  });

  it("does not confuse height= with other options", () => {
    expect(capOf(convert("line-height=300"))).toBe("");
  });
});

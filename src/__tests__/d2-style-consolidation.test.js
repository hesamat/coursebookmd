import { describe, it, expect } from "vitest";
import { consolidateD2Styles } from "../renderer/coursebook-exporter.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Build a rendered-looking D2 diagram container mirroring the real d2 output
 * shape: an svg.d2-svg root carrying the salt class, two direct-child style
 * elements (fonts, then theme rules), and a scoped rule that references a
 * per-diagram defs id via url(#...).
 */
function makeDiagram(salt, { fillN7 = "#FFFFFF", fontData = "AAAA" } = {}) {
  const container = document.createElement("div");
  container.className = "d2-diagram";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `${salt} d2-svg`);

  const fontStyles = document.createElementNS(SVG_NS, "style");
  fontStyles.textContent = [
    `.${salt} .text-bold {`,
    `\tfont-family: "${salt}-font-bold";`,
    "}",
    "@font-face {",
    `\tfont-family: ${salt}-font-bold;`,
    `\tsrc: url("data:application/font-woff;base64,${fontData}");`,
    "}",
  ].join("\n");

  const themeStyles = document.createElementNS(SVG_NS, "style");
  themeStyles.textContent = [
    ".shape {",
    "  shape-rendering: geometricPrecision;",
    "}",
    `.${salt} .fill-N7{fill:${fillN7};}`,
    `.${salt} .stroke-N1{stroke:#0A0F25;}`,
    `.${salt} .streaks{filter:url(#streaks-normal-${salt});}`,
  ].join("\n");

  svg.appendChild(fontStyles);
  svg.appendChild(themeStyles);
  container.appendChild(svg);
  return { container, svg };
}

describe("consolidateD2Styles", () => {
  it("returns empty string when there are no D2 diagrams", () => {
    const container = document.createElement("div");
    expect(consolidateD2Styles([{ container }])).toBe("");
  });

  it("leaves diagrams without style elements or a salt class untouched", () => {
    const bare = document.createElement("div");
    bare.className = "d2-diagram";
    const bareSvg = document.createElementNS(SVG_NS, "svg");
    bareSvg.setAttribute("class", "d2-svg");
    bare.appendChild(bareSvg);

    const unsalted = document.createElement("div");
    unsalted.className = "d2-diagram";
    const unsaltedSvg = document.createElementNS(SVG_NS, "svg");
    unsaltedSvg.setAttribute("class", "d2-svg");
    const orphanStyle = document.createElementNS(SVG_NS, "style");
    orphanStyle.textContent = ".shape { fill: red; }";
    unsaltedSvg.appendChild(orphanStyle);
    unsalted.appendChild(unsaltedSvg);

    const css = consolidateD2Styles([{ container: bare }, { container: unsalted }]);
    expect(css).toBe("");
    expect(bareSvg.querySelector("style")).toBeNull();
    expect(unsaltedSvg.querySelector("style")).not.toBeNull();
    expect(unsaltedSvg.getAttribute("class")).toBe("d2-svg");
  });

  it("merges identical theme rules across diagrams and strips their styles", () => {
    const a = makeDiagram("d2-111");
    const b = makeDiagram("d2-222");

    const css = consolidateD2Styles([
      { container: a.container },
      { container: b.container },
    ]);

    expect(a.svg.querySelector("style")).toBeNull();
    expect(b.svg.querySelector("style")).toBeNull();
    // The roots keep their original classes; sharing works purely through
    // grouped selectors in the hoisted CSS.
    expect(a.svg.getAttribute("class")).toBe("d2-111 d2-svg");
    expect(b.svg.getAttribute("class")).toBe("d2-222 d2-svg");

    // Identical theme rules are emitted once with both salt scopes grouped,
    // compacted back to d2's original density (hex colors, no extra spaces).
    expect(css).toContain(".d2-111 .fill-N7,.d2-222 .fill-N7{fill:#ffffff;}");
    expect(css.match(/\.fill-N7\{/g)).toHaveLength(1);
    expect(css).toContain(".d2-111 .stroke-N1,.d2-222 .stroke-N1{stroke:#0a0f25;}");
    // Unscoped shared rules (no salt anywhere) are emitted once.
    expect(css.match(/\.shape\{/g)).toHaveLength(1);
  });

  it("keeps font rules per diagram so every diagram keeps its own font data", () => {
    const a = makeDiagram("d2-111", { fontData: "AAAA" });
    const b = makeDiagram("d2-222", { fontData: "BBBB" });

    const css = consolidateD2Styles([
      { container: a.container },
      { container: b.container },
    ]);

    // Font faces and the rules referencing their salted family names are
    // diagram-specific (d2 subsets font data per diagram) and stay verbatim.
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain('"d2-111-font-bold"');
    expect(css).toContain('"d2-222-font-bold"');
    expect(css.match(/font-family:"d2-111-font-bold"/g)).toHaveLength(1);
    expect(css.match(/font-family:"d2-222-font-bold"/g)).toHaveLength(1);
  });

  it("emits url(...) id-reference rules per diagram with their own targets", () => {
    const a = makeDiagram("d2-111");
    const b = makeDiagram("d2-222");

    const css = consolidateD2Styles([
      { container: a.container },
      { container: b.container },
    ]);

    expect(css.match(/streaks-normal-d2-111/g)).toHaveLength(1);
    expect(css.match(/streaks-normal-d2-222/g)).toHaveLength(1);
    expect(css).toContain(".d2-111 .streaks");
    expect(css).toContain(".d2-222 .streaks");
  });

  it("does not merge rules whose bodies differ across diagrams", () => {
    const a = makeDiagram("d2-111", { fillN7: "#FFFFFF" });
    const c = makeDiagram("d2-333", { fillN7: "#1A1A1A" });

    const css = consolidateD2Styles([
      { container: a.container },
      { container: c.container },
    ]);

    // Different theme colors stay separate, each scoped only to its own salt,
    // so neither diagram's cascade leaks into the other.
    expect(css.match(/\.d2-111 \.fill-N7\{fill:#ffffff;/g)).toHaveLength(1);
    expect(css.match(/\.d2-333 \.fill-N7\{fill:#1a1a1a;/g)).toHaveLength(1);
    expect(css).not.toContain(".d2-111 .fill-N7,.d2-333 .fill-N7");
    expect(css.match(/@font-face/g)).toHaveLength(2);
  });
});

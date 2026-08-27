import { describe, it, expect } from "vitest";
import { resolveContentRefs } from "../core/utils.js";

describe("resolveContentRefs", () => {
  it("resolves relative img src paths against the source file", () => {
    const container = document.createElement("div");
    container.innerHTML = '<img src="../assets/diagram.png" alt="diagram">';
    resolveContentRefs(container, "docs/chapters/01.md");
    const img = container.querySelector("img");
    expect(img.getAttribute("src")).toBe("docs/assets/diagram.png");
  });

  it("resolves relative a href paths against the source file", () => {
    const container = document.createElement("div");
    container.innerHTML = '<a href="../other/chapter.md">Other</a>';
    resolveContentRefs(container, "docs/chapters/01.md");
    const a = container.querySelector("a");
    expect(a.getAttribute("href")).toBe("docs/other/chapter.md");
  });

  it("leaves protocol, absolute, and anchor links unchanged", () => {
    const container = document.createElement("div");
    container.innerHTML = [
      '<img src="https://example.com/img.png">',
      '<img src="//cdn.example.com/img.png">',
      '<a href="#section">Section</a>',
      '<img src="data:image/png,abc">',
    ].join("");
    resolveContentRefs(container, "docs/chapters/01.md");
    const [img1, img2, a, img3] = container.querySelectorAll("img, a");
    expect(img1.getAttribute("src")).toBe("https://example.com/img.png");
    expect(img2.getAttribute("src")).toBe("//cdn.example.com/img.png");
    expect(a.getAttribute("href")).toBe("#section");
    expect(img3.getAttribute("src")).toBe("data:image/png,abc");
  });

  it("strips a leading slash from root-absolute paths", () => {
    const container = document.createElement("div");
    container.innerHTML = '<img src="/root.png">';
    resolveContentRefs(container, "docs/chapters/01.md");
    const img = container.querySelector("img");
    expect(img.getAttribute("src")).toBe("root.png");
  });
});

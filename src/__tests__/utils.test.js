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

  it("resolves relative .md a href paths against the source file", () => {
    const container = document.createElement("div");
    container.innerHTML = '<a href="../other/chapter.md">Other</a>';
    resolveContentRefs(container, "docs/chapters/01.md");
    const a = container.querySelector("a");
    expect(a.getAttribute("href")).toBe("docs/other/chapter.md");
  });

  it("preserves hash fragments on resolved .md links", () => {
    const container = document.createElement("div");
    container.innerHTML = '<a href="../other/chapter.md#section">Section</a>';
    resolveContentRefs(container, "docs/chapters/01.md");
    const a = container.querySelector("a");
    expect(a.getAttribute("href")).toBe("docs/other/chapter.md#section");
  });

  it("leaves protocol, root-absolute, and anchor links unchanged", () => {
    const container = document.createElement("div");
    container.innerHTML = [
      '<img src="https://example.com/img.png">',
      '<img src="//cdn.example.com/img.png">',
      '<img src="/root.png">',
      '<img src="data:image/png,abc">',
      '<a href="#section">Section</a>',
      '<a href="http://example.com/page.md">External</a>',
      '<a href="/chapter.md">Root absolute</a>',
    ].join("");
    resolveContentRefs(container, "docs/chapters/01.md");
    const [img1, img2, img3, img4, a1, a2, a3] = container.querySelectorAll("img, a");
    expect(img1.getAttribute("src")).toBe("https://example.com/img.png");
    expect(img2.getAttribute("src")).toBe("//cdn.example.com/img.png");
    expect(img3.getAttribute("src")).toBe("/root.png");
    expect(img4.getAttribute("src")).toBe("data:image/png,abc");
    expect(a1.getAttribute("href")).toBe("#section");
    expect(a2.getAttribute("href")).toBe("http://example.com/page.md");
    expect(a3.getAttribute("href")).toBe("/chapter.md");
  });

  it("does not resolve non-.md relative a href paths", () => {
    const container = document.createElement("div");
    container.innerHTML = '<a href="../other/page.html">HTML</a>';
    resolveContentRefs(container, "docs/chapters/01.md");
    const a = container.querySelector("a");
    expect(a.getAttribute("href")).toBe("../other/page.html");
  });
});

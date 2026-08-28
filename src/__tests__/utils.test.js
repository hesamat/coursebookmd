import { describe, it, expect } from "vitest";
import { resolveContentRefs, slugifyForId } from "../core/utils.js";

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

  it("resolves non-.md relative a href paths and preserves hash fragments", () => {
    const container = document.createElement("div");
    container.innerHTML = '<a href="../other/page.html#section">HTML</a>';
    resolveContentRefs(container, "docs/chapters/01.md");
    const a = container.querySelector("a");
    expect(a.getAttribute("href")).toBe("docs/other/page.html#section");
  });

  it("leaves unsafe and malformed a href values unchanged", () => {
    const container = document.createElement("div");
    container.innerHTML = [
      '<a href="javascript:alert(1)">JS</a>',
      '<a href="file:///etc/passwd">File</a>',
      '<a href="">Empty</a>',
      '<a href=":invalid">Malformed</a>',
      '<a href="http://[::1">Invalid URL</a>',
    ].join("");
    resolveContentRefs(container, "docs/chapters/01.md");
    const [a1, a2, a3, a4, a5] = container.querySelectorAll("a");
    expect(a1.getAttribute("href")).toBe("javascript:alert(1)");
    expect(a2.getAttribute("href")).toBe("file:///etc/passwd");
    expect(a3.getAttribute("href")).toBe("");
    expect(a4.getAttribute("href")).toBe(":invalid");
    expect(a5.getAttribute("href")).toBe("http://[::1");
  });
});

describe("slugifyForId", () => {
  it("slugifies headings to URL-safe ids", () => {
    expect(slugifyForId("Getting Started")).toBe("getting-started");
  });

  it("falls back for all-whitespace or special-character-only input", () => {
    const a = slugifyForId("   ");
    const b = slugifyForId("!@#$%");
    expect(a).toMatch(/^heading-\d+$/);
    expect(b).toMatch(/^heading-\d+$/);
    expect(a).not.toBe(b);
  });
});

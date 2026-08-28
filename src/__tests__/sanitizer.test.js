import { describe, it, expect } from "vitest";
import { sanitizeHtml, sanitizeSvg } from "../renderer/markdown-renderer.js";

describe("sanitizeHtml — iframe security", () => {
  it("sandboxes safe srcdoc iframes without stripping their content", () => {
    const html =
      '<iframe srcdoc="<h1>Hello from an iframe</h1><p>This content lives inside an inline frame.</p>" title="test"></iframe>';
    const result = sanitizeHtml(html);
    // srcdoc is preserved and forced into a sandboxed unique origin
    expect(result).toContain("srcdoc");
    expect(result).toContain("Hello from an iframe");
    expect(result).toContain('sandbox=""');
  });

  it("strips dangerous content inside srcdoc", () => {
    const html =
      '<iframe srcdoc="<h1>Hello</h1><script>alert(1)</script>" title="test"></iframe>';
    const result = sanitizeHtml(html);
    // DOMPurify sanitizes the srcdoc value and drops forbidden tags; the
    // iframe survives but srcdoc is removed because its content was unsafe.
    expect(result).not.toContain("<script>");
  });

  it("preserves srcdoc when sandbox is explicitly set", () => {
    const html = '<iframe srcdoc="<h1>Hello</h1>" sandbox="" title="test"></iframe>';
    const result = sanitizeHtml(html);
    expect(result).toContain("srcdoc");
    expect(result).toContain('sandbox=""');
  });

  it("does not force sandbox on src iframes (YouTube, etc.)", () => {
    const html =
      '<iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" allowfullscreen title="test"></iframe>';
    const result = sanitizeHtml(html);
    expect(result).not.toContain('sandbox=""');
    expect(result).toContain('src="https://www.youtube.com/embed/M7lc1UVf-VE"');
    expect(result).toContain("allowfullscreen");
  });

  it("preserves author-specified sandbox on src iframes", () => {
    const html =
      '<iframe src="https://example.com" sandbox="allow-scripts" title="test"></iframe>';
    const result = sanitizeHtml(html);
    expect(result).toContain('sandbox="allow-scripts"');
    expect(result).toContain('src="https://example.com"');
  });

  it("strips dangerous scripts from regular content", () => {
    const html = "<p>hello</p><script>alert(1)</script>";
    const result = sanitizeHtml(html);
    expect(result).toContain("<p>hello</p>");
    expect(result).not.toContain("<script>");
  });
});

describe("sanitizeSvg", () => {
  it("preserves the svg root and basic shapes", () => {
    const svg =
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="var(--accent)" class="foo"/></svg>';
    const result = sanitizeSvg(svg);
    expect(result).toContain("<svg");
    expect(result).toContain('viewBox="0 0 100 100"');
    expect(result).toContain('fill="var(--accent)"');
    expect(result).toContain('class="foo"');
  });

  it("preserves style blocks and css variables", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><style>rect { fill: var(--accent); }</style><rect width="100" height="100"/></svg>';
    const result = sanitizeSvg(svg);
    expect(result).toContain("<style>");
    expect(result).toContain("fill: var(--accent)");
    expect(result).toContain("<rect");
  });

  it("strips scripts and event handlers", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)"/><script>alert(1)</script></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("onclick");
    expect(result).toContain("<rect");
  });

  it("strips dangerous hrefs but keeps safe ones", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="#icon"/><use href="javascript:alert(1)"/><a href="https://example.com"><rect/></a></svg>';
    const result = sanitizeSvg(svg);
    expect(result).toContain('href="#icon"');
    expect(result).toContain('href="https://example.com"');
    expect(result).not.toContain("javascript");
  });

  it("strips xml declaration and doctype", () => {
    const svg =
      '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain("<?xml");
    expect(result).not.toContain("DOCTYPE");
    expect(result).toContain("<svg");
    expect(result).toContain("<rect");
  });
});

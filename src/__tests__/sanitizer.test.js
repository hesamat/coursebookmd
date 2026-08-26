import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "../renderer/markdown-renderer.js";

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

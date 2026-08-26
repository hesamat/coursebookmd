import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "../renderer/markdown-renderer.js";

describe("sanitizeHtml — iframe security", () => {
  it("strips srcdoc from iframes without sandbox", () => {
    const html = '<iframe srcdoc="<script>alert(1)</script>" title="test"></iframe>';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("srcdoc");
    expect(result).not.toContain("<script>");
    expect(result).toContain('sandbox=""');
  });

  it("preserves srcdoc when sandbox is explicitly set", () => {
    const html = '<iframe srcdoc="<h1>Hello</h1>" sandbox="" title="test"></iframe>';
    const result = sanitizeHtml(html);
    expect(result).toContain("srcdoc");
    expect(result).toContain('sandbox=""');
  });

  it("forces sandbox on src iframes without one", () => {
    const html = '<iframe src="https://example.com" title="test"></iframe>';
    const result = sanitizeHtml(html);
    expect(result).toContain('sandbox=""');
    expect(result).toContain('src="https://example.com"');
  });

  it("preserves author-specified sandbox restrictions", () => {
    const html =
      '<iframe src="https://example.com" sandbox="allow-scripts" title="test"></iframe>';
    const result = sanitizeHtml(html);
    expect(result).toContain('sandbox="allow-scripts"');
    expect(result).not.toContain('sandbox=""');
  });

  it("strips dangerous scripts from regular content", () => {
    const html = "<p>hello</p><script>alert(1)</script>";
    const result = sanitizeHtml(html);
    expect(result).toContain("<p>hello</p>");
    expect(result).not.toContain("<script>");
  });
});

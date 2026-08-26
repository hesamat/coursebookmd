/**
 * MarkdownRenderer
 * Renders Markdown to HTML using markdown-it with sensible defaults.
 * External links open in a new tab.
 */
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

// Open external links in a new tab
const defaultLinkRender =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  const href = token.attrGet("href") || "";
  if (!href.startsWith("#") && !href.startsWith("mailto:")) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }
  return defaultLinkRender(tokens, idx, options, env, self);
};

export function renderMarkdown(markdown) {
  return md.render(markdown);
}

/**
 * Sanitize rendered HTML while preserving iframes and their standard
 * attributes so embedded videos, maps, and other external content work.
 *
 * Security: iframes with `srcdoc` are dangerous because DOMPurify cannot
 * sanitize the HTML inside `srcdoc`. We use a DOMPurify hook to:
 * 1. Strip `srcdoc` from any iframe that does not explicitly set a
 *    `sandbox` attribute (which restricts what the embedded content can do).
 * 2. Force a restrictive default `sandbox` on every iframe that lacks one,
 *    so even `src` iframes cannot run scripts or access the parent origin.
 *
 * @param {string} html
 * @returns {string}
 */
export function sanitizeHtml(html) {
  // Register the hook once; DOMPurify keeps a reference and deduplicates
  // hooks by name, so repeated calls are safe.
  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "iframe" || node.tagName !== "IFRAME") return;

    const hasSandbox = node.hasAttribute("sandbox");

    // srcdoc without sandbox is an XSS vector — drop it.
    if (!hasSandbox && node.hasAttribute("srcdoc")) {
      node.removeAttribute("srcdoc");
    }

    // Force a restrictive sandbox on every iframe that doesn't set one.
    // This blocks scripts, top-level navigation, same-origin access, etc.
    // Authors who need more permissions must explicitly set sandbox themselves.
    if (!hasSandbox) {
      node.setAttribute("sandbox", "");
    }
  });

  const clean = DOMPurify.sanitize(html, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: [
      "allow",
      "allowfullscreen",
      "frameborder",
      "height",
      "loading",
      "name",
      "referrerpolicy",
      "sandbox",
      "scrolling",
      "srcdoc",
      "src",
      "width",
    ],
  });

  // Remove the hook so it doesn't affect other DOMPurify calls (e.g. tests).
  DOMPurify.removeHook("uponSanitizeElement");

  return clean;
}

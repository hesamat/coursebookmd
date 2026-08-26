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
  if (/^https?:\/\/|^\/\//.test(href)) {
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
 * sanitize the HTML inside `srcdoc`. A `srcdoc` iframe without `sandbox`
 * runs in the parent origin, so user-authored Markdown containing
 * `<iframe srcdoc="<script>...">` can execute JavaScript in the app.
 *
 * We handle this with a DOMPurify hook:
 * 1. If an iframe has `srcdoc` but no `sandbox`, force `sandbox=""`.
 *    This runs the srcdoc in a unique, locked-down origin instead of the
 *    parent's, which neutralizes the XSS while still allowing the content to
 *    render.
 * 2. We do NOT force sandbox on `src` iframes (YouTube, etc.) because an
 *    empty sandbox blocks the embedded site's scripts, breaking normal embeds.
 *    Authors who want sandboxing on `src` iframes can set it explicitly.
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

    // srcdoc in the parent origin is an XSS vector. Sandbox it so it runs
    // in a unique origin instead of stripping the content entirely.
    if (node.hasAttribute("srcdoc") && !hasSandbox) {
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

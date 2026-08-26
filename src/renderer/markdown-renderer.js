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
 * @param {string} html
 * @returns {string}
 */
export function sanitizeHtml(html) {
  return DOMPurify.sanitize(html, {
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
}

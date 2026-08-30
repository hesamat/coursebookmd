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

// ---- Mandatory headings: `## Mandatory: Title` -> <hN class="mandatory"> ----
// Adds a `mandatory` class to any h1-h6 whose title begins with "Mandatory:".
// The full title text is preserved so TOC/section-numbering stay consistent.
const defaultHeadingOpen =
  md.renderer.rules.heading_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const open = tokens[idx];
  const inline = tokens[idx + 1];
  const title = inline ? extractInlineText(inline) : "";
  if (/^Mandatory:\s*/.test(title)) {
    open.attrSet("class", "mandatory");
  }
  annotateSourceLine(open);
  return defaultHeadingOpen(tokens, idx, options, env, self);
};

// ---- Source jump annotations ----
// Block elements carry the 1-based source line they start on so the preview
// can map a click back to the editor (see core/source-jump.js). DOMPurify
// keeps data-* attributes, and ContentEnhancer preserves <pre> attributes
// across Shiki highlighting, so the annotations survive the render pipeline.

/** Annotate a block token's opening element with its 1-based source line. */
function annotateSourceLine(token) {
  if (token.map) {
    token.attrSet("data-src-line", String(token.map[0] + 1));
  }
}

const SOURCE_BLOCK_TOKENS = [
  "paragraph_open",
  "bullet_list_open",
  "ordered_list_open",
  "list_item_open",
  "blockquote_open",
  "table_open",
];

for (const type of SOURCE_BLOCK_TOKENS) {
  md.renderer.rules[type] = (tokens, idx, options, env, self) => {
    annotateSourceLine(tokens[idx]);
    return self.renderToken(tokens, idx, options);
  };
}

/** Concatenate text content of an inline token's children. */
function extractInlineText(inlineToken) {
  if (!inlineToken || !inlineToken.children) return "";
  let text = "";
  for (const child of inlineToken.children) {
    if (child.type === "text") text += child.content;
  }
  return text;
}

// ---- Indexed terms: `==term==` -> <span class="idx">term</span> ----
// Modeled on markdown-it-ins: opening `==` must not be followed by
// whitespace or another `=`, closing `==` must not be preceded by
// whitespace or followed by another `=`, and the term cannot span lines.
// Registered before "emphasis" so `=` (an emphasis-class terminator for the
// text rule) reaches this rule; code spans/fences are tokenized earlier and
// therefore never contain `.idx` markup.
function indexedTermRule(state, silent) {
  const src = state.src;
  const max = state.posMax;
  const pos = state.pos;

  if (src.charCodeAt(pos) !== 0x3d || src.charCodeAt(pos + 1) !== 0x3d) return false;
  if (src.charCodeAt(pos + 2) === 0x3d) return false;

  let close = -1;
  for (let i = pos + 2; i < max - 1; i++) {
    const ch = src.charCodeAt(i);
    if (ch === 0x0a) break; // terms are inline only
    if (ch !== 0x3d || src.charCodeAt(i + 1) !== 0x3d) continue;
    if (src.charCodeAt(i + 2) === 0x3d) {
      i++; // skip past a `===` run so it is not re-detected as a closer
      continue;
    }
    close = i;
    break;
  }
  if (close < 0) return false;

  const contentStart = pos + 2;
  const contentEnd = close;
  if (contentStart >= contentEnd) return false;
  if (/\s/.test(src[contentStart]) || /\s/.test(src[contentEnd - 1])) return false;

  if (!silent) {
    state.push("indexed_term_open", "span", 1).attrSet("class", "idx");
    const oldPosMax = state.posMax;
    state.pos = contentStart;
    state.posMax = contentEnd;
    state.md.inline.tokenize(state);
    state.pos = close + 2;
    state.posMax = oldPosMax;
    state.push("indexed_term_close", "span", -1);
  } else {
    state.pos = close + 2;
  }
  return true;
}

md.inline.ruler.before("emphasis", "indexed_term", indexedTermRule);

// ---- Fenced code: default renderer ----
// The default fence rule renders token attributes on the inner <code>, but
// ContentEnhancer replaces <code> when highlighting while keeping the <pre>
// attributes — so the line annotation is spliced onto the <pre> itself.
const defaultFenceRender =
  md.renderer.rules.fence ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const open = tokens[idx];
  const html = defaultFenceRender(tokens, idx, options, env, self);
  if (!open.map) return html;
  return html.replace("<pre>", `<pre data-src-line="${open.map[0] + 1}">`);
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

/**
 * Sanitize an SVG string while preserving the structure needed for
 * inline diagrams (CSS variables in attributes, inline styles, etc.).
 *
 * This uses DOMPurify's SVG profile and keeps the output as a string for
 * insertion into the DOM. Event handlers, scripts, `<style>` blocks, and
 * dangerous URLs are stripped, but the SVG shape and safe attributes remain.
 *
 * @param {string} svg
 * @returns {string}
 */
export function sanitizeSvg(svg) {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true },
    ADD_TAGS: ["use"],
    ADD_ATTR: ["xlink:href", "target"],
    FORBID_TAGS: ["style"],
  });
}

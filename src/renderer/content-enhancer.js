/**
 * ContentEnhancer
 * Enhances rendered HTML with Shiki syntax highlighting, KaTeX math,
 * D2 diagrams, and raw SVG diagrams.
 *
 * Shiki produces <pre><code> with inline styles — no theme CSS needed.
 * D2 and SVG code fences are converted to diagram containers before Shiki
 * sees them, then rendered to inline SVG.
 * The theme is chosen based on the active document theme (light/dark).
 */
import { codeToHtml } from "shiki";
import { normalizeCodeLanguage } from "../core/utils.js";
import { icon } from "../core/icon.js";
import { sanitizeSvg } from "./markdown-renderer.js";

const SHIKI_THEMES = {
  light: "github-light",
  dark: "github-dark",
};

// Languages Shiki should load. Shiki uses WASM-based TextMate grammars.
// These are bundled at build time by the shiki package.
const SHIKI_LANGS = [
  "javascript",
  "typescript",
  "python",
  "bash",
  "json",
  "yaml",
  "markdown",
  "html",
  "css",
  "sql",
  "rust",
  "go",
  "java",
  "ruby",
  "php",
  "swift",
  "kotlin",
  "c",
  "cpp",
  "docker",
  "diff",
  "shell",
  "powershell",
];

// Diagram code-fence languages and their container classes.
const DIAGRAM_TYPES = [
  { lang: "d2", className: "d2-diagram" },
  { lang: "svg", className: "svg-diagram" },
];

// D2 theme ID. 0 is the default light "Neutral" theme.
const D2_THEME_LIGHT = 0;

const COPY_BUTTON_TIMEOUT_MS = 2000;

let d2Instance = null;
let d2SaltCounter = 0;

// ---- Shiki ----

/**
 * Get the current document theme (light/dark).
 * @returns {"light"|"dark"}
 */
function getCurrentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

/**
 * Highlight a single code block using Shiki.
 * Returns the highlighted HTML string, or null if highlighting fails.
 * @param {string} code - The raw source code.
 * @param {string} lang - The language identifier.
 * @param {"light"|"dark"} theme - Which Shiki theme to use.
 * @param {object} [opts]
 * @param {boolean} [opts.dualTheme] - Bake both themes as CSS variables so a
 *   `[data-theme="dark"]` CSS override can switch colors without
 *   re-highlighting. Used by the standalone HTML export.
 * @returns {Promise<string|null>}
 */
async function highlightCode(code, lang, theme, { dualTheme = false } = {}) {
  try {
    const normalized = normalizeCodeLanguage(lang);
    // Shiki uses different names for some languages
    const shikiLang = SHIKI_LANGS.includes(normalized) ? normalized : "text";
    if (dualTheme) {
      return await codeToHtml(code, {
        lang: shikiLang,
        themes: { light: SHIKI_THEMES.light, dark: SHIKI_THEMES.dark },
        defaultColor: "light",
      });
    }
    return await codeToHtml(code, {
      lang: shikiLang,
      theme: SHIKI_THEMES[theme],
    });
  } catch {
    return null;
  }
}

/**
 * Replace all <pre><code> blocks in rootEl with Shiki-highlighted HTML.
 * Diagram code blocks are skipped (they were converted to divs earlier).
 *
 * On first pass, the original source and language are stored as
 * data-source / data-lang attributes on the <pre> so that re-highlighting
 * (on theme switch) can recover them without parsing token spans.
 * @param {HTMLElement} rootEl
 * @param {object} [opts]
 * @param {boolean} [opts.dualTheme] - Bake light and dark theme colors as CSS
 *   variables (see highlightCode), so the dark theme re-skins them in CSS.
 */
async function highlightCodeBlocks(rootEl, { dualTheme = false } = {}) {
  const theme = getCurrentTheme();

  // Select all <pre> that contain a <code> child.
  // This catches both raw markdown-it output and already-highlighted Shiki blocks.
  const pres = Array.from(rootEl.querySelectorAll("pre"));

  for (const pre of pres) {
    const codeEl = pre.querySelector(":scope > code");
    if (!codeEl) continue;

    // Skip diagram blocks (they've been converted to divs by now, but guard anyway)
    if (pre.closest(".d2-diagram, .svg-diagram")) continue;

    // Check if this pre was already highlighted by Shiki (has data-source)
    const hasData = pre.hasAttribute("data-source");
    let source, lang;

    if (hasData) {
      // Re-highlight: recover source and lang from data attributes
      source = pre.getAttribute("data-source") || "";
      lang = pre.getAttribute("data-lang") || "text";
    } else {
      // First pass: extract from the raw <code> element
      const className = codeEl.className || "";
      const match = className.match(/(?:lang|language)-(\S+)/);
      lang = match ? match[1] : "text";
      source = codeEl.textContent || "";
    }

    if (source.trim() === "") continue;

    // Terminal-style fences (bash/shell/sh) get the "$" prompt via the
    // command class, but follow the app theme like every other block.
    const normalized = normalizeCodeLanguage(lang);
    const isCommand = normalized === "bash";

    const highlighted = await highlightCode(source, lang, theme, { dualTheme });
    if (!highlighted) continue;

    // Parse the Shiki HTML and replace the <pre>
    const temp = document.createElement("template");
    temp.innerHTML = highlighted;
    const newPre = temp.content.querySelector("pre");
    if (newPre) {
      // Store source and lang for future re-highlighting
      newPre.setAttribute("data-source", source);
      newPre.setAttribute("data-lang", lang);

      // Tag terminal command blocks for CSS prompt styling
      if (isCommand) newPre.classList.add("command");

      // Preserve any data attributes from the original pre (except class)
      for (const attr of Array.from(pre.attributes)) {
        if (
          attr.name === "class" ||
          attr.name === "data-source" ||
          attr.name === "data-lang"
        ) {
          continue;
        }
        if (!newPre.hasAttribute(attr.name)) {
          newPre.setAttribute(attr.name, attr.value);
        }
      }

      // Preserve copy button if one exists
      const existingCopyBtn = pre.querySelector(".code-copy-button");
      pre.replaceWith(newPre);
      if (existingCopyBtn) {
        newPre.classList.add("has-copy-button");
        newPre.appendChild(existingCopyBtn);
      }
    }
  }
}

// ---- Copy button helpers ----

async function copyTextToClipboard(text) {
  if (
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function" &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to execCommand
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
  document.body.appendChild(textarea);
  textarea.select();

  let success = false;
  try {
    success = document.execCommand("copy");
  } catch {
    // non-fatal
  }

  document.body.removeChild(textarea);
  return success;
}

function setCopyButtonIcon(button, iconName) {
  const oldSvg = button.querySelector("svg");
  if (oldSvg) oldSvg.remove();
  const newIcon = icon(iconName, { size: "sm" });
  if (newIcon) button.appendChild(newIcon);
}

function resetCopyButton(button) {
  button.classList.remove("is-copied", "is-copy-failed");
  button.setAttribute("aria-label", "Copy code to clipboard");
  button.setAttribute("title", "Copy");
  setCopyButtonIcon(button, "copy");
}

async function onCopyButtonClick(button, _label, codeEl) {
  const text = codeEl.textContent || "";
  let success;
  try {
    success = await copyTextToClipboard(text);
  } catch {
    success = false;
  }

  if (success) {
    button.classList.add("is-copied");
    button.setAttribute("aria-label", "Copied");
    button.setAttribute("title", "Copied");
    setCopyButtonIcon(button, "clipboard-check");
  } else {
    button.classList.add("is-copy-failed");
    button.setAttribute("aria-label", "Copy failed");
    button.setAttribute("title", "Copy failed");
    setCopyButtonIcon(button, "clipboard-x");
  }

  // Clear any pending reset so rapid clicks don't race each other
  if (button._copyResetTimer) clearTimeout(button._copyResetTimer);
  button._copyResetTimer = setTimeout(
    () => resetCopyButton(button),
    COPY_BUTTON_TIMEOUT_MS,
  );
}

function createCopyButton(codeEl) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-copy-button";
  button.setAttribute("aria-label", "Copy code to clipboard");
  button.setAttribute("title", "Copy");

  const copyIcon = icon("copy", { size: "sm" });
  if (copyIcon) button.appendChild(copyIcon);

  button.addEventListener("click", (e) => {
    e.preventDefault();
    onCopyButtonClick(button, null, codeEl);
  });
  return button;
}

// Pure DOM transforms exported for unit testing.
export const __test = {
  enhanceBlockquotes,
  addFigureCaptions,
  addDiagramCaptions,
  numberFigureCaptions,
};

function addCopyButtonsToCodeBlocks(rootEl) {
  if (!rootEl) return;
  const pres = rootEl.querySelectorAll("pre");
  for (const pre of pres) {
    if (pre.querySelector(".code-copy-button")) continue;
    const codeEl = pre.querySelector(":scope > code");
    if (!codeEl) continue;
    // Skip diagram blocks (they've been converted to divs by now)
    if (pre.closest(".d2-diagram, .svg-diagram")) continue;
    if ((codeEl.textContent || "").trim() === "") continue;
    pre.classList.add("has-copy-button");
    pre.appendChild(createCopyButton(codeEl));
  }
}

// ---- Admonition blockquotes (Warning / Note / Tip / Caution) ----

const ADMONITION_TYPES = ["warning", "note", "tip", "caution"];

/**
 * Detect blockquotes whose first paragraph begins with a leading strong
 * label like `**Warning:**` and tag them with an admonition class so CSS can
 * style the left border and tint. The leading strong node is wrapped in a
 * `.admonition-label` span for consistent badge styling.
 * @param {HTMLElement} rootEl
 */
function enhanceBlockquotes(rootEl) {
  if (!rootEl) return;
  const blockquotes = rootEl.querySelectorAll("blockquote");
  for (const bq of blockquotes) {
    if (bq.dataset.admonition) continue;
    const firstP = bq.querySelector("p");
    if (!firstP) continue;
    const firstChild = firstP.firstChild;
    if (!firstChild || firstChild.nodeName !== "STRONG") continue;
    const text = (firstChild.textContent || "").trim().toLowerCase();
    const match = text.match(/^(\w+):?$/);
    if (!match) continue;
    const type = match[1];
    if (!ADMONITION_TYPES.includes(type)) continue;

    bq.classList.add("admonition", `admonition-${type}`);
    bq.dataset.admonition = type;

    // Wrap the leading strong in a labeled span so CSS can render a badge.
    const label = document.createElement("span");
    label.className = "admonition-label";
    label.appendChild(firstChild);
    firstP.insertBefore(label, firstP.firstChild);
  }
}

// ---- Figure captions ----

/**
 * Wrap standalone block images that have an alt text in <figure> with a
 * numbered <figcaption> ("Figure 1.", "Figure 2.", ...). Numbering is
 * sequential within each chapter and resets at every coursebook section.
 *
 * A "block image" is an <img> that is the sole content of its parent <p>.
 * Inline images (logos, icons, images mixed with text) are left alone.
 * @param {HTMLElement} rootEl
 */
function addFigureCaptions(rootEl) {
  if (!rootEl) return;
  const imgs = rootEl.querySelectorAll("img");
  for (const img of imgs) {
    if (img.closest("figure")) continue; // already wrapped
    const alt = (img.alt || "").trim();
    if (!alt) continue; // no caption text -> not a figure
    const parent = img.parentElement;
    if (!parent || parent.tagName !== "P") continue;
    // Only wrap when the image is the sole non-empty child of the paragraph.
    const siblings = Array.from(parent.childNodes).filter(
      (n) => n.nodeType !== 3 || (n.textContent || "").trim() !== "",
    );
    if (siblings.length !== 1 || siblings[0] !== img) continue;

    const figure = document.createElement("figure");
    figure.className = "figure";
    figure.dataset.generatedCaption = "";
    // The wrapped <p> may carry a data-src-line source annotation (see
    // markdown-renderer.js); move it to the figure so source jumps resolve.
    if (parent.dataset.srcLine !== undefined) {
      figure.setAttribute("data-src-line", parent.dataset.srcLine);
    }
    parent.replaceWith(figure);
    figure.appendChild(img);
    const caption = document.createElement("figcaption");
    caption.className = "figure-caption";
    figure.appendChild(caption);
  }
  numberFigureCaptions(rootEl);
}

// ---- Diagram captions ----

/**
 * Wrap D2 and SVG diagram containers in <figure> with numbered captions.
 * The caption text comes from the `data-caption` attribute on the diagram div.
 * Numbering is shared with image figures and resets for each chapter.
 *
 * @param {HTMLElement} rootEl
 */
function addDiagramCaptions(rootEl) {
  if (!rootEl) return;
  const diagrams = rootEl.querySelectorAll(".d2-diagram, .svg-diagram");
  for (const diagram of diagrams) {
    if (diagram.closest("figure")) continue;
    const caption = diagram.getAttribute("data-caption");
    if (!caption) continue; // no caption text -> skip
    const figure = document.createElement("figure");
    figure.className = "figure";
    figure.dataset.generatedCaption = "";
    diagram.parentNode.insertBefore(figure, diagram);
    diagram.parentNode.removeChild(diagram);
    figure.appendChild(diagram);
    const captionEl = document.createElement("figcaption");
    captionEl.className = "figure-caption";
    figure.appendChild(captionEl);
  }
  numberFigureCaptions(rootEl);
}

function numberFigureCaptions(rootEl) {
  if (!rootEl) return;
  const sections = rootEl.matches?.(".coursebook-section")
    ? [rootEl]
    : Array.from(rootEl.querySelectorAll(".coursebook-section"));
  const scopes = sections.length > 0 ? sections : [rootEl];

  for (const scope of scopes) {
    const figures = scope.querySelectorAll("figure.figure[data-generated-caption]");
    let figureNumber = 0;
    for (const figure of figures) {
      const caption = figure.querySelector(":scope > figcaption.figure-caption");
      const image = figure.querySelector(":scope > img");
      const diagram = figure.querySelector(":scope > .d2-diagram, :scope > .svg-diagram");
      const text = image ? (image.alt || "").trim() : diagram?.dataset.caption;
      if (!caption || !text) continue;
      figureNumber++;
      caption.textContent = `Figure ${figureNumber}. ${text}`;
    }
  }
}

// ---- KaTeX ----

async function ensureKatex() {
  if (window.renderMathInElement) return;
  await import("katex/dist/katex.min.css");
  const katexMod = await import("katex");
  window.katex = katexMod.default || katexMod;
  const autoRender = await import("katex/contrib/auto-render");
  window.renderMathInElement =
    autoRender.renderMathInElement ||
    autoRender.default?.renderMathInElement ||
    autoRender.default;
}

// ---- Diagrams ----

/**
 * Convert D2 and SVG code blocks to diagram containers before Shiki
 * highlighting runs, so they are not rendered as source code.
 * @param {HTMLElement} rootEl
 */
function convertDiagramCodeBlocks(rootEl) {
  for (const { lang, className } of DIAGRAM_TYPES) {
    const nodes = rootEl.querySelectorAll(
      `pre code.language-${lang}, pre code.lang-${lang}`,
    );
    for (const codeEl of nodes) {
      const pre = codeEl.parentElement;
      if (pre?.tagName !== "PRE") continue;
      const source = codeEl.textContent?.trim();
      if (!source) continue;
      // Extract info-string (fence metadata) like caption="...".
      const info = pre.getAttribute("data-info") || "";
      const captionMatch = info.match(/\bcaption\s*=\s*(?:(["'])(.*?)\1|(\S+))/);
      const caption = captionMatch
        ? captionMatch[2] !== undefined
          ? captionMatch[2]
          : captionMatch[3]
        : "";
      const div = document.createElement("div");
      div.className = className;
      div.setAttribute("data-source", source);
      if (caption) div.setAttribute("data-caption", caption);
      pre.replaceWith(div);
    }
  }
}

/**
 * Show a rendering error inside a diagram container.
 * @param {HTMLElement} el
 * @param {Error} error
 */
function showDiagramError(el, error) {
  el.textContent = "";
  const alert = document.createElement("div");
  alert.className = "diagram-error";
  alert.textContent = error.message || "Diagram rendering failed";
  el.appendChild(alert);
}

async function ensureD2() {
  if (d2Instance) return d2Instance;
  const mod = await import("@terrastruct/d2");
  const D2 = mod.D2;
  d2Instance = new D2();
  return d2Instance;
}

async function renderD2Diagrams(rootEl) {
  const blocks = rootEl.querySelectorAll(".d2-diagram");
  if (blocks.length === 0) return;

  const d2 = await ensureD2();
  const isDark = getCurrentTheme() === "dark";

  for (const el of blocks) {
    const source = el.getAttribute("data-source") || "";
    if (!source) continue;

    try {
      // Cache the compiled diagram on the element to avoid re-compiling
      // when the theme changes.
      if (!el._d2Compiled) {
        el._d2Compiled = await d2.compile(source);
      }
      const compiled = el._d2Compiled;
      // Diagrams keep the light theme in both app modes: hand-picked author
      // colors are tuned against a light theme, and light diagrams stay
      // readable on the dark page background. An author can still opt into
      // a dark palette for dark mode with dark-theme-id in the D2 source.
      const requestedTheme = compiled.renderOptions.themeID;
      const requestedDark = compiled.renderOptions.darkThemeID;
      const themeID =
        isDark && requestedDark != null
          ? requestedDark
          : requestedTheme || D2_THEME_LIGHT;
      const renderOptions = {
        ...compiled.renderOptions,
        themeID,
        noXMLTag: true,
        pad: 10,
        salt: `d2-${d2SaltCounter++}`,
      };
      const svg = await d2.render(compiled.diagram, renderOptions);
      // D2 output is trusted compiler-generated SVG. It is not user markup,
      // so we set it directly. See REVIEW.md for the trust boundary.
      el.innerHTML = svg;
      el.setAttribute("data-rendered", "true");
    } catch (e) {
      showDiagramError(el, e);
    }
  }
}

async function renderSvgDiagrams(rootEl) {
  const blocks = rootEl.querySelectorAll(".svg-diagram");
  for (const el of blocks) {
    const source = el.getAttribute("data-source") || "";
    if (!source) continue;

    try {
      const clean = sanitizeSvg(source);
      if (!clean.includes("<svg")) {
        throw new Error("SVG code fence must contain a root <svg> element");
      }
      el.innerHTML = clean;
      el.setAttribute("data-rendered", "true");
    } catch (e) {
      showDiagramError(el, e);
    }
  }
}

// ---- Main enhancer ----

export class ContentEnhancer {
  static renumberFigureCaptions(rootEl) {
    numberFigureCaptions(rootEl);
  }

  /**
   * Enhances rendered content with syntax highlighting, math, and diagrams.
   * @param {HTMLElement} rootEl - The root element containing rendered HTML.
   * @param {object} [opts]
   * @param {boolean} [opts.dualTheme] - Highlight code with light and dark
   *   Shiki themes baked as CSS variables (used by the HTML export).
   */
  static async enhance(rootEl, { dualTheme = false } = {}) {
    if (!rootEl) return;

    // KaTeX's CSS+fonts are ~1.3MB inlined in an export, so only load it when
    // the content can possibly contain math. renderMathInElement only ever
    // fires on $ / \( / \[ delimiters, so their absence means it would be a
    // no-op anyway.
    const hasMath = /\$|\\\(|\\\[/.test(rootEl.textContent || "");
    const katexPromise = hasMath ? ensureKatex() : Promise.resolve();

    // 1. Convert D2 and SVG code blocks to diagram containers (before Shiki)
    convertDiagramCodeBlocks(rootEl);

    // 2. Shiki syntax highlighting (async, replaces <pre> blocks)
    await highlightCodeBlocks(rootEl, { dualTheme });

    // 2b. Add copy buttons to code blocks (after highlighting)
    addCopyButtonsToCodeBlocks(rootEl);

    // 2c. Admonition blockquotes (Warning/Note/Tip/Caution) and figure
    // captions are DOM transforms independent of Shiki.
    enhanceBlockquotes(rootEl);
    addFigureCaptions(rootEl);

    // 3. KaTeX math
    await katexPromise;
    if (hasMath && window.renderMathInElement) {
      try {
        window.renderMathInElement(rootEl, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true },
          ],
          ignoredClasses: ["no-math", "katex-ignore", "d2-diagram", "svg-diagram"],
          throwOnError: false,
        });
      } catch {
        // non-fatal
      }
    }

    // 4. D2 and SVG diagrams (load on demand)
    await renderSvgDiagrams(rootEl);
    await renderD2Diagrams(rootEl);

    // 4b. Wrap captioned diagrams in <figure> with numbered captions.
    addDiagramCaptions(rootEl);
  }

  /**
   * Re-highlight code blocks when the theme changes (light/dark).
   * This is needed because Shiki bakes colors into inline styles.
   * D2 diagrams are also re-rendered with the new theme.
   * @param {HTMLElement} rootEl
   */
  static async rehighlight(rootEl) {
    if (!rootEl) return;
    await highlightCodeBlocks(rootEl);
    addCopyButtonsToCodeBlocks(rootEl);
    await renderD2Diagrams(rootEl);
  }

  /**
   * Ensure dynamically-loaded stylesheets (KaTeX) are present
   * in document.styleSheets. Call before extracting CSS for export.
   */
  static async ensureStylesLoaded() {
    await ensureKatex();
  }
}

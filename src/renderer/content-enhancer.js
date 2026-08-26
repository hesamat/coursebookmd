/**
 * ContentEnhancer
 * Enhances rendered HTML with Shiki syntax highlighting, KaTeX math,
 * and Mermaid diagrams.
 *
 * Shiki produces <pre><code> with inline styles — no theme CSS needed.
 * The theme is chosen based on the active document theme (light/dark).
 */
import { codeToHtml } from "shiki";
import { normalizeCodeLanguage } from "../core/utils.js";
import { icon } from "../core/icon.js";

const MERMAID_INIT_OPTIONS = {
  startOnLoad: false,
  theme: "base",
  securityLevel: "loose",
  flowchart: { curve: "basis", nodeSpacing: 60, rankSpacing: 60, padding: 20 },
  themeVariables: {
    primaryColor: "#ffffff",
    primaryBorderColor: "#1f2937",
    primaryTextColor: "#1f2937",
    textColor: "#1f2937",
    lineColor: "#824cdf",
    secondaryColor: "#f3f4f6",
    secondaryBorderColor: "#374151",
    secondaryTextColor: "#1f2937",
    tertiaryColor: "#e5e7eb",
    tertiaryBorderColor: "#4b5563",
    tertiaryTextColor: "#1f2937",
    noteBkgColor: "#f9fafb",
    noteBorderColor: "#6b7280",
    edgeLabelBackground: "#ffffff",
    clusterBkg: "#f9fafb",
    clusterBorder: "#9ca3af",
    fontFamily: "Segoe UI, Roboto, sans-serif",
    fontSize: "18px",
    mainBkg: "#ffffff",
  },
};

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

let mermaidInitialized = false;

const COPY_BUTTON_TIMEOUT_MS = 2000;

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
 * @returns {Promise<string|null>}
 */
async function highlightCode(code, lang, theme) {
  try {
    const normalized = normalizeCodeLanguage(lang);
    // Shiki uses different names for some languages
    const shikiLang = SHIKI_LANGS.includes(normalized) ? normalized : "text";
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
 * Mermaid blocks are skipped (handled separately).
 *
 * On first pass, the original source and language are stored as
 * data-source / data-lang attributes on the <pre> so that re-highlighting
 * (on theme switch) can recover them without parsing token spans.
 * @param {HTMLElement} rootEl
 */
async function highlightCodeBlocks(rootEl) {
  const theme = getCurrentTheme();

  // Select all <pre> that contain a <code> child.
  // This catches both raw markdown-it output and already-highlighted Shiki blocks.
  const pres = Array.from(rootEl.querySelectorAll("pre"));

  for (const pre of pres) {
    const codeEl = pre.querySelector(":scope > code");
    if (!codeEl) continue;

    // Skip mermaid blocks (they've been converted to divs by now, but guard anyway)
    if (pre.closest(".mermaid")) continue;

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
      if (/(?:^|\s)(?:language|lang)-mermaid(?:\s|$)/.test(className)) continue;
      const match = className.match(/(?:lang|language)-(\S+)/);
      lang = match ? match[1] : "text";
      source = codeEl.textContent || "";
    }

    if (source.trim() === "") continue;

    const highlighted = await highlightCode(source, lang, theme);
    if (!highlighted) continue;

    // Parse the Shiki HTML and replace the <pre>
    const temp = document.createElement("template");
    temp.innerHTML = highlighted;
    const newPre = temp.content.querySelector("pre");
    if (newPre) {
      // Store source and lang for future re-highlighting
      newPre.setAttribute("data-source", source);
      newPre.setAttribute("data-lang", lang);

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

  setTimeout(() => resetCopyButton(button), COPY_BUTTON_TIMEOUT_MS);
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

function addCopyButtonsToCodeBlocks(rootEl) {
  if (!rootEl) return;
  const pres = rootEl.querySelectorAll("pre");
  for (const pre of pres) {
    if (pre.querySelector(".code-copy-button")) continue;
    const codeEl = pre.querySelector(":scope > code");
    if (!codeEl) continue;
    // Skip mermaid blocks (they've been converted to divs by now)
    if (pre.closest(".mermaid")) continue;
    if ((codeEl.textContent || "").trim() === "") continue;
    pre.classList.add("has-copy-button");
    pre.appendChild(createCopyButton(codeEl));
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

// ---- Mermaid ----

async function ensureMermaid() {
  if (window.mermaid && mermaidInitialized) return;
  const mermaidMod = await import("mermaid");
  const mermaid = mermaidMod.default || mermaidMod;
  mermaid.initialize(MERMAID_INIT_OPTIONS);
  window.mermaid = mermaid;
  mermaidInitialized = true;
}

// ---- Main enhancer ----

export class ContentEnhancer {
  /**
   * Enhances rendered content with syntax highlighting, math, and diagrams.
   * @param {HTMLElement} rootEl - The root element containing rendered HTML.
   */
  static async enhance(rootEl) {
    if (!rootEl) return;

    // Load KaTeX in parallel with Shiki highlighting; Mermaid loads on demand
    const katexPromise = ensureKatex();

    // 1. Convert mermaid code blocks to divs (before Shiki sees them)
    const mermaidCodeNodes = rootEl.querySelectorAll(
      "pre code.language-mermaid, pre code.lang-mermaid",
    );
    for (const codeEl of mermaidCodeNodes) {
      const pre = codeEl.parentElement;
      if (pre?.tagName !== "PRE") continue;
      const source = codeEl.textContent?.trim();
      if (!source) continue;
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = source;
      pre.replaceWith(div);
    }

    // 2. Shiki syntax highlighting (async, replaces <pre> blocks)
    await highlightCodeBlocks(rootEl);

    // 2b. Add copy buttons to code blocks (after highlighting)
    addCopyButtonsToCodeBlocks(rootEl);

    // 3. KaTeX math
    await katexPromise;
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(rootEl, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true },
          ],
          ignoredClasses: ["no-math", "katex-ignore", "mermaid"],
          throwOnError: false,
        });
      } catch {
        // non-fatal
      }
    }

    // 4. Mermaid diagrams (load on demand)
    const mermaidBlocks = rootEl.querySelectorAll(".mermaid");
    if (mermaidBlocks.length > 0) {
      await ensureMermaid();
      for (const el of mermaidBlocks) {
        const source = el.textContent?.trim();
        if (!source) continue;
        try {
          const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const out = await window.mermaid.render(id, source);
          const svg = typeof out === "string" ? out : out?.svg;
          if (svg) el.innerHTML = svg;
          if (out?.bindFunctions) out.bindFunctions(el);
        } catch (e) {
          el.textContent = "";
          const alert = document.createElement("div");
          alert.className = "mermaid-error";
          alert.textContent = e.message || "Mermaid rendering failed";
          el.appendChild(alert);
        }
      }
    }
  }

  /**
   * Re-highlight code blocks when the theme changes (light/dark).
   * This is needed because Shiki bakes colors into inline styles.
   * @param {HTMLElement} rootEl
   */
  static async rehighlight(rootEl) {
    if (!rootEl) return;
    await highlightCodeBlocks(rootEl);
    addCopyButtonsToCodeBlocks(rootEl);
  }

  /**
   * Ensure dynamically-loaded stylesheets (KaTeX, Mermaid) are present
   * in document.styleSheets. Call before extracting CSS for export.
   */
  static async ensureStylesLoaded() {
    await ensureKatex();
  }
}

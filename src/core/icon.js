/**
 * Centralized icon helper.
 *
 * Wraps Lucide icons so every icon in the app has a single source of truth
 * with consistent sizing, stroke width, `currentColor`, and accessibility
 * (`aria-hidden`).
 *
 * Usage:
 *   import { icon, ICONS } from "../core/icon.js";
 *   btn.appendChild(icon("close"));                 // default size
 *   btn.appendChild(icon("save", { size: "sm" }));  // 14px
 */

import {
  X,
  Ellipsis,
  Upload,
  SquarePlus,
  Pencil,
  Save,
  RefreshCw,
  Download,
  Settings,
  Sun,
  Moon,
  Maximize,
  ChevronDown,
  Presentation,
  FileText,
  Palette,
} from "lucide";

export const ICON_SIZES = Object.freeze({
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
});

const DEFAULT_SIZE = "md";

export const ICONS = Object.freeze({
  close: X,
  x: X,
  ellipsis: Ellipsis,
  "more-horizontal": Ellipsis,
  upload: Upload,
  open: Upload,
  "square-plus": SquarePlus,
  "plus-square": SquarePlus,
  pencil: Pencil,
  edit: Pencil,
  save: Save,
  reload: RefreshCw,
  "refresh-cw": RefreshCw,
  download: Download,
  export: Download,
  settings: Settings,
  sun: Sun,
  moon: Moon,
  maximize: Maximize,
  "chevron-down": ChevronDown,
  presentation: Presentation,
  "file-text": FileText,
  file: FileText,
  palette: Palette,
});

const BASE_ATTRS = Object.freeze({
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 2,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
  focusable: "false",
});

const SVG_NS = "http://www.w3.org/2000/svg";

function buildNode(node) {
  const [tag, attrs, children] = node;
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, String(value));
  }
  if (children?.length) {
    for (const child of children) {
      el.appendChild(buildNode(child));
    }
  }
  return el;
}

function resolveIcon(name) {
  const node = ICONS[name];
  if (!node) {
    console.warn(`[icon] Unknown icon name: "${name}"`);
    return null;
  }
  return node;
}

/**
 * Create an SVG icon element for the given semantic name.
 * @param {string} name - One of the keys in ICONS.
 * @param {object} [opts]
 * @param {("xs"|"sm"|"md"|"lg"|"xl"|"2xl"|number)} [opts.size="md"]
 * @param {string} [opts.class] - Extra class(es) to add to the <svg>.
 * @param {string} [opts.label] - Accessible label.
 * @param {number} [opts.strokeWidth] - Override stroke-width.
 * @returns {SVGElement|null}
 */
export function icon(name, opts = {}) {
  const node = resolveIcon(name);
  if (!node) return null;

  const sizeToken = opts.size ?? DEFAULT_SIZE;
  const px =
    typeof sizeToken === "number" ? sizeToken : (ICON_SIZES[sizeToken] ?? ICON_SIZES[DEFAULT_SIZE]);

  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries(BASE_ATTRS)) {
    svg.setAttribute(k, v);
  }
  svg.setAttribute("width", String(px));
  svg.setAttribute("height", String(px));

  if (opts.strokeWidth != null) {
    svg.setAttribute("stroke-width", String(opts.strokeWidth));
  }
  if (opts.class) {
    svg.setAttribute("class", opts.class);
  }
  if (opts.label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", opts.label);
    svg.removeAttribute("aria-hidden");
  }

  for (const child of node) {
    svg.appendChild(buildNode(child));
  }
  return svg;
}

/**
 * Replace every `<i data-icon="name">` inside `root` with the corresponding SVG.
 * @param {ParentNode} root - Defaults to `document`.
 * @returns {number} Number of icons hydrated.
 */
export function hydrateIcons(root = document) {
  const placeholders = root.querySelectorAll("[data-icon]");
  let count = 0;
  for (const el of placeholders) {
    const name = el.getAttribute("data-icon");
    if (!name) continue;

    const opts = {};
    const sizeAttr = el.getAttribute("data-size");
    if (sizeAttr) {
      const n = Number(sizeAttr);
      opts.size = Number.isFinite(n) && sizeAttr.trim() !== "" ? n : sizeAttr;
    }
    const strokeWidth = el.getAttribute("data-stroke-width");
    if (strokeWidth) opts.strokeWidth = Number(strokeWidth);
    const label = el.getAttribute("data-label");
    if (label) opts.label = label;

    const svg = icon(name, opts);
    if (!svg) continue;

    for (const attr of Array.from(el.attributes)) {
      if (
        attr.name === "data-icon" ||
        attr.name === "data-size" ||
        attr.name === "data-stroke-width" ||
        attr.name === "data-label"
      ) {
        continue;
      }
      svg.setAttribute(attr.name, attr.value);
    }

    el.replaceWith(svg);
    count++;
  }
  return count;
}

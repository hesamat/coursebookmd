import { md, renderMarkdown, sanitizeHtml } from "./markdown-renderer.js";

const HIDE_DELAY = 200;
const IMAGE_TIMEOUT = 300;
const MIN_IMAGE_SIZE = 80;
const SCROLL_TITLE_OFFSET = 100;

const WP_HOST_REGEX = /^(?!www$)[a-z]{2,}(?:-[a-zA-Z0-9]+)?\.wikipedia\.org$/i;
const WM_IMAGE_HOST = /^https:\/\/upload\.wikimedia\.org\//i;

let popupEl = null;
let activeLink = null;
let activeX = null;
let hideTimeout = null;
let imageTimeout = null;
let globalListenersAttached = false;
let globalPreviews = {};

export function setPreviews(map) {
  globalPreviews = map ?? {};
}

export function extractLinks(markdown) {
  const urls = new Set();
  const tokens = md.parse(markdown || "", {});

  function walk(list) {
    for (const token of list) {
      if (token.type === "link_open") {
        const href = token.attrGet("href") || "";
        if (/^(?:https?:)?\/\//i.test(href)) {
          urls.add(href);
        }
      }
      if (token.children?.length) walk(token.children);
    }
  }

  walk(tokens);
  return [...urls];
}

export class WikipediaProvider {
  canHandle(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") return false;
      if (u.pathname !== "/wiki/" && !u.pathname.startsWith("/wiki/")) return false;
      return WP_HOST_REGEX.test(u.hostname) || u.hostname === "wikipedia.org";
    } catch {
      return false;
    }
  }

  async fetchPreview(url, { signal }) {
    const u = new URL(url);
    let lang = u.hostname.split(".")[0];
    if (lang === "wikipedia") lang = "en";
    if (!lang) lang = "en";

    let title = u.pathname.replace(/^\/wiki\//, "");
    try {
      title = decodeURIComponent(title);
    } catch {
      // leave title as-is
    }

    const apiUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const response = await fetch(apiUrl, { signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const image = data.thumbnail?.source;
    const summary = data.extract ? renderMarkdown(data.extract).trim() : "";

    return {
      title: data.titles?.normalized || data.title || title,
      summary,
      image: image && WM_IMAGE_HOST.test(image) ? image : null,
      url,
      domain: "wikipedia.org",
    };
  }
}

export class JinaReaderProvider {
  canHandle(url) {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  async fetchPreview(url, { signal, apiKey } = {}) {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const headers = { Accept: "text/plain" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(jinaUrl, { signal, headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const data = parseJinaResponse(text, url);
    if (!data) return null;
    const rendered = renderMarkdown(data.summary).trim();
    data.summary = typeof window !== "undefined" ? sanitizeHtml(rendered) : rendered;
    return data;
  }
}

const BLOCKED_TITLE_PATTERN =
  /\b(sign\s*in|log\s*in|login|access\s*denied|forbidden|unauthorized|just\s+a\s*moment|attention\s*required|verify\s*you\s*are\s*human|subscribe|join\s*now|sign\s*up|create\s*account)\b/i;

const BLOCKED_SUMMARY_PATTERN =
  /^(Please\s+(sign\s*in|log\s*in)|Sign\s*in|Log\s*in|Access\s+denied|Forbidden|Unauthorized|You\s+must\s+be\s+logged\s*in|Join\s+.*to\s+continue|Subscribe\s+to\s+continue)/i;

function isSuitableImage(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (/[?&](w|width)=?1(&|$)/.test(lower) || /[?&](h|height)=?1(&|$)/.test(lower))
    return false;
  if (/(^|\/|_)favicon|logo|brand|branding/.test(lower)) return false;
  if (/\.(?:ico|svg)\b/.test(lower) && /(?:logo|brand|branding)/.test(lower))
    return false;
  if (/1x1\.gif|clear\.gif|pixel\.gif|tracking\.gif|spacer\.gif/.test(lower))
    return false;
  return true;
}

function isJinaFailure(title, summary) {
  if (BLOCKED_TITLE_PATTERN.test(title) && title.length < 80) return true;
  if (BLOCKED_SUMMARY_PATTERN.test(summary)) return true;
  if (summary.length < 80 && /\b(sign\s*in|log\s*in|access\s*denied)\b/i.test(summary))
    return true;
  return false;
}

function parseJinaResponse(text, originalUrl) {
  const marker = "Markdown Content:";
  const markerIndex = text.indexOf(marker);
  const header = markerIndex >= 0 ? text.slice(0, markerIndex) : "";
  const markdown =
    markerIndex >= 0 ? text.slice(markerIndex + marker.length).trim() : text.trim();

  let title = "";
  for (const line of header.split("\n")) {
    if (line.startsWith("Title:")) title = line.slice(6).trim();
  }

  const summary = extractJinaSummary(markdown);
  let image = extractJinaHeaderImage(header) || extractJinaImage(markdown);
  if (image && !image.startsWith("http")) {
    try {
      image = new URL(image, originalUrl).href;
    } catch {
      image = null;
    }
  }

  if (image && !isSuitableImage(image)) image = null;

  if (isJinaFailure(title, summary)) return null;

  return {
    title: title || "Untitled",
    summary,
    image,
    url: originalUrl,
    domain: new URL(originalUrl).hostname,
  };
}

const MIN_JINA_SUMMARY_LENGTH = 120;
const MAX_JINA_SUMMARY_LENGTH = 700;

function truncateToSentence(text, max) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const end = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! "),
  );
  if (end > MIN_JINA_SUMMARY_LENGTH) return slice.slice(0, end + 1);
  const space = slice.lastIndexOf(" ");
  if (space > 0) return slice.slice(0, space);
  return slice;
}

function extractJinaSummary(markdown) {
  const cleaned = markdown
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/^\[.*?\]\(.*?\)$/gm, "")
    .replace(/^[\*_]\s+.*$/gm, "");
  const blocks = cleaned.split(/\n\s*\n/);

  let best = "";
  for (const block of blocks) {
    const text = block.trim().replace(/\s+/g, " ");
    if (!text || text.startsWith("---")) continue;
    if (text.length >= MIN_JINA_SUMMARY_LENGTH) {
      return truncateToSentence(text, MAX_JINA_SUMMARY_LENGTH);
    }
    if (text.length > best.length) best = text;
  }
  return best ? truncateToSentence(best, MAX_JINA_SUMMARY_LENGTH) : "";
}

function extractJinaHeaderImage(header) {
  for (const line of header.split("\n")) {
    if (line.startsWith("Image:")) {
      const value = line.slice(6).trim();
      if (value) return value;
    }
  }
  return null;
}

function extractJinaImage(markdown) {
  const m = markdown.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
  return m ? m[1] : null;
}

const providers = [new WikipediaProvider(), new JinaReaderProvider()];

function findProvider(url) {
  return providers.find((p) => p.canHandle(url));
}

const resolveCache = new Map();
const resolvePending = new Map();

export async function resolvePreview(url, { signal, apiKey } = {}) {
  const cached = resolveCache.get(url);
  if (cached !== undefined) return cached;

  const existing = resolvePending.get(url);
  if (existing) return existing;

  const provider = findProvider(url);
  if (!provider) return null;

  const promise = provider.fetchPreview(url, { signal, apiKey }).then(
    (data) => {
      resolveCache.set(url, data ?? null);
      return data ?? null;
    },
    (e) => {
      throw e;
    },
  );
  resolvePending.set(url, promise);
  return promise.finally(() => resolvePending.delete(url));
}

function createPopup() {
  if (popupEl) return popupEl;

  const popup = document.createElement("div");
  popup.className = "link-preview";
  popup.setAttribute("role", "tooltip");
  popup.setAttribute("aria-hidden", "true");

  const imageWrap = document.createElement("div");
  imageWrap.className = "link-preview__image-wrap";
  imageWrap.setAttribute("hidden", "");
  const image = document.createElement("img");
  image.className = "link-preview__image";
  image.alt = "";
  image.decoding = "async";
  imageWrap.appendChild(image);
  popup.appendChild(imageWrap);

  const title = document.createElement("a");
  title.className = "link-preview__title";
  title.target = "_blank";
  title.rel = "noopener noreferrer";
  title.tabIndex = -1;
  popup.appendChild(title);

  const summary = document.createElement("div");
  summary.className = "link-preview__summary";
  popup.appendChild(summary);

  const footer = document.createElement("div");
  footer.className = "link-preview__footer";
  const domain = document.createElement("span");
  domain.className = "link-preview__domain";
  const openIcon = document.createElement("span");
  openIcon.className = "link-preview__open";
  openIcon.textContent = "↗";
  footer.appendChild(domain);
  footer.appendChild(openIcon);
  popup.appendChild(footer);

  document.body.appendChild(popup);
  popup.addEventListener("mouseenter", onPopupEnter);
  popup.addEventListener("mouseleave", onPopupLeave);
  popupEl = popup;
  return popupEl;
}

function positionPopup(link) {
  if (!popupEl) return;
  const popupRect = popupEl.getBoundingClientRect();
  const margin = 10;

  const linkRect = link.getBoundingClientRect();
  const anchorX = activeX != null ? activeX : linkRect.left + linkRect.width / 2;
  const topY = linkRect.top;
  const bottomY = linkRect.bottom;

  let top = bottomY + margin;
  let left = anchorX - popupRect.width / 2;
  const maxLeft = Math.max(margin, window.innerWidth - popupRect.width - margin);
  left = Math.max(margin, Math.min(left, maxLeft));

  const fitsBelow = top + popupRect.height + margin <= window.innerHeight;
  if (!fitsBelow) {
    top = topY - popupRect.height - margin;
    if (top < margin) top = margin;
  }

  popupEl.style.top = `${top}px`;
  popupEl.style.left = `${left}px`;
}

function renderPreview(data) {
  if (!popupEl) return;
  const title = popupEl.querySelector(".link-preview__title");
  title.href = data.url;
  title.target = "_blank";
  title.rel = "noopener noreferrer";
  title.textContent = data.title;

  const summary = popupEl.querySelector(".link-preview__summary");
  summary.innerHTML = sanitizeHtml(data.summary);

  const footer = popupEl.querySelector(".link-preview__domain");
  footer.textContent = data.domain || new URL(data.url).hostname;
}

function finishPopup(link) {
  if (activeLink !== link) return;
  if (!popupEl) return;
  if (popupEl.classList.contains("is-visible")) return;
  positionPopup(link);
  const title = popupEl.querySelector(".link-preview__title");
  if (title) {
    const titleBottom = title.offsetTop + title.offsetHeight;
    popupEl.scrollTop = Math.max(
      0,
      Math.min(
        popupEl.scrollHeight - popupEl.clientHeight,
        titleBottom - popupEl.clientHeight + SCROLL_TITLE_OFFSET,
      ),
    );
  }
  popupEl.classList.add("is-visible");
  popupEl.setAttribute("aria-hidden", "false");
}

function loadPopup(link, data) {
  if (activeLink !== link) return;
  if (!popupEl) return;
  renderPreview(data);

  const imageWrap = popupEl.querySelector(".link-preview__image-wrap");
  const image = popupEl.querySelector(".link-preview__image");
  image.removeAttribute("src");
  image.onload = null;
  image.onerror = null;
  clearTimeout(imageTimeout);
  imageTimeout = null;

  if (data.image) {
    imageWrap.removeAttribute("hidden");

    const finishImage = () => {
      clearTimeout(imageTimeout);
      imageTimeout = null;

      // Hide tiny or broken images (favicons, tracking pixels, empty frames).
      if (
        !image.src ||
        image.naturalWidth < MIN_IMAGE_SIZE ||
        image.naturalHeight < MIN_IMAGE_SIZE
      ) {
        imageWrap.setAttribute("hidden", "");
        image.removeAttribute("src");
      }

      finishPopup(link);
    };

    image.onload = finishImage;
    image.onerror = () => {
      imageWrap.setAttribute("hidden", "");
      finishImage();
    };

    imageTimeout = setTimeout(() => {
      // Image is taking too long; show the popup and let it load in the
      // background. The onload handler will still hide it if it's too small.
      finishImage();
    }, IMAGE_TIMEOUT);

    image.src = data.image;
  } else {
    imageWrap.setAttribute("hidden", "");
    finishPopup(link);
  }
}

function tryParsePreview(link) {
  const raw = link.dataset?.preview;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function showFor(link, x) {
  clearTimeout(hideTimeout);
  hideTimeout = null;

  if (activeLink === link) return;

  const href = link.getAttribute("href");
  const preloaded = tryParsePreview(link) ?? globalPreviews[href];
  if (preloaded) {
    activeLink = link;
    activeX = x;
    createPopup();
    // Force re-positioning when switching from another link.
    if (popupEl) {
      popupEl.classList.remove("is-visible");
      popupEl.setAttribute("aria-hidden", "true");
    }
    loadPopup(link, preloaded);
    return;
  }

  hidePopup();
}

function scheduleHide() {
  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(hidePopup, HIDE_DELAY);
}

function onPopupEnter() {
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }
}

function onPopupLeave() {
  if (activeLink) scheduleHide();
}

function hidePopup() {
  clearTimeout(hideTimeout);
  hideTimeout = null;
  clearTimeout(imageTimeout);
  imageTimeout = null;

  activeLink = null;
  activeX = null;

  if (popupEl) {
    popupEl.classList.remove("is-visible");
    popupEl.setAttribute("aria-hidden", "true");
    const image = popupEl.querySelector(".link-preview__image");
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
    }
  }
}

function onLinkEnter(link, x) {
  if (activeLink === link) {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    return;
  }
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }

  const preloaded = tryParsePreview(link) ?? globalPreviews[link.getAttribute("href")];
  if (preloaded) {
    showFor(link, x);
  } else {
    hidePopup();
  }
}

function onLinkLeave(link) {
  if (activeLink === link) scheduleHide();
}

function getLinkFromEventTarget(target) {
  return target?.closest ? target.closest("a[href]") : null;
}

function ensureExternal(link) {
  const href = link.getAttribute("href");
  if (!/^(?:https?:)?\/\//i.test(href)) return;
  if (link.getAttribute("target") !== "_blank") {
    link.setAttribute("target", "_blank");
  }
  if (link.getAttribute("rel") !== "noopener noreferrer") {
    link.setAttribute("rel", "noopener noreferrer");
  }
}

function hasPreloaded(link) {
  return !!(tryParsePreview(link) ?? globalPreviews[link.getAttribute("href")]);
}

function onMouseOver(e) {
  const link = getLinkFromEventTarget(e.target);
  if (!link) return;
  const related = getLinkFromEventTarget(e.relatedTarget);
  if (related && related === link) return;
  ensureExternal(link);
  if (!hasPreloaded(link)) return;
  onLinkEnter(link, e.clientX);
}

function onMouseOut(e) {
  const link = getLinkFromEventTarget(e.target);
  if (!link) return;
  const related = getLinkFromEventTarget(e.relatedTarget);
  if (related && related === link) return;
  if (activeLink === link) onLinkLeave(link);
}

function onFocusIn(e) {
  const link = getLinkFromEventTarget(e.target);
  if (!link) return;
  ensureExternal(link);
  if (!hasPreloaded(link)) return;
  onLinkEnter(link);
}

function onFocusOut(e) {
  const link = getLinkFromEventTarget(e.target);
  if (!link) return;
  const related = getLinkFromEventTarget(e.relatedTarget);
  if (related && (related === link || link.contains(related))) return;
  if (activeLink === link) onLinkLeave(link);
}

function onClick(e) {
  const link = getLinkFromEventTarget(e.target);
  if (!link) return;
  if (activeLink) hidePopup();
}

function onKeyDown(e) {
  if (e.key === "Escape") hidePopup();
}

function onScrollOrResize(e) {
  if (e.type === "scroll") return;
  hidePopup();
}

function attachGlobalListeners() {
  if (globalListenersAttached) return;
  globalListenersAttached = true;
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onScrollOrResize);
  window.addEventListener("scroll", onScrollOrResize, true);
}

function resetState() {
  hidePopup();
  if (popupEl) {
    popupEl.remove();
    popupEl = null;
  }
  activeLink = null;
  if (globalListenersAttached) {
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onScrollOrResize);
    window.removeEventListener("scroll", onScrollOrResize, true);
    globalListenersAttached = false;
  }
  resolveCache.clear();
  resolvePending.clear();
}

export class LinkPreview {
  static enhance(rootEl) {
    if (!rootEl || rootEl._linkPreviewEnhanced) return;
    rootEl._linkPreviewEnhanced = true;
    attachGlobalListeners();
    rootEl.addEventListener("mouseover", onMouseOver);
    rootEl.addEventListener("mouseout", onMouseOut);
    rootEl.addEventListener("focusin", onFocusIn);
    rootEl.addEventListener("focusout", onFocusOut);
    rootEl.addEventListener("click", onClick);
  }

  static setPreviews(map) {
    setPreviews(map);
  }

  static hide() {
    hidePopup();
  }
}

export const __test = { resetState };

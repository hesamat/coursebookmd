import { md, renderMarkdown, sanitizeHtml } from "./markdown-renderer.js";

const HIDE_DELAY = 200;
const SHOW_DELAY = 200;
const IMAGE_TIMEOUT = 300;
const MIN_IMAGE_SIZE = 80;
const SCROLL_TITLE_OFFSET = 100;

const WP_HOST_REGEX = /^(?!www$)[a-z]{2,}(?:-[a-zA-Z0-9]+)?\.wikipedia\.org$/i;
const WM_IMAGE_HOST = /^https:\/\/upload\.wikimedia\.org\//i;

let popupEl = null;
let activeLink = null;
let activeX = null;
let showTimer = null;
let hideTimeout = null;
let imageTimeout = null;
let globalListenersAttached = false;
let globalPreviews = {};
let onDemandFetchActive = false;

// How long the Jina reader is left alone after it answers 429. Preview
// requests made during the cooldown fail immediately (no network), and the
// next coursebook open after it expires retries them normally.
const JINA_RATE_LIMIT_COOLDOWN_MS = 3 * 60 * 1000;
let jinaRateLimitedUntil = 0;

function jinaRateLimitedError() {
  const error = new Error("HTTP 429 (rate limited)");
  error.rateLimited = true;
  return error;
}

/** Whether the Jina reader is inside its post-429 cooldown. */
export function isJinaRateLimited() {
  return Date.now() < jinaRateLimitedUntil;
}

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

  /** False while the reader is inside its post-429 cooldown. */
  isAvailable() {
    return !isJinaRateLimited();
  }

  async fetchPreview(url, { signal, apiKey } = {}) {
    // The reader rate-limits unauthenticated traffic (HTTP 429). Retrying
    // while limited only burns the quota and fills the console with failed
    // requests, so the provider goes quiet for a cooldown and reports the
    // limit without touching the network.
    if (Date.now() < jinaRateLimitedUntil) throw jinaRateLimitedError();

    const jinaUrl = `https://r.jina.ai/${url}`;
    const headers = { Accept: "text/plain" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(jinaUrl, { signal, headers });
    if (response.status === 429) {
      jinaRateLimitedUntil = Date.now() + JINA_RATE_LIMIT_COOLDOWN_MS;
      throw jinaRateLimitedError();
    }
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

// ---- Same-workbook links ----
// Anchors into the currently loaded content (#chapter-slug, #heading-anchor)
// resolve locally from the DOM — no provider, no network — so they preview
// instantly on hover. The exported HTML viewer shares this module and the
// same section/heading id structure, so it gets these previews for free.

const INTERNAL_SUMMARY_MAX = 400;
const INTERNAL_DOMAIN_LABEL = "This workbook";

function isInternalHref(href) {
  return typeof href === "string" && href.startsWith("#");
}

function headingLevel(el) {
  return Number(el.tagName[1]);
}

function headingText(heading) {
  const clone = heading.cloneNode(true);
  const number = clone.querySelector(".heading-number");
  if (number) number.remove();
  return clone.textContent.replace(/\s+/g, " ").trim();
}

function blockText(el) {
  if (el.matches("ul, ol")) {
    const items = el.querySelectorAll(":scope > li");
    return items.length
      ? Array.from(items, (li) => li.textContent.replace(/\s+/g, " ").trim()).join("; ")
      : "";
  }
  return el.textContent.replace(/\s+/g, " ").trim();
}

/**
 * Text of the content blocks following a heading. For a section's own title
 * heading, stop at the very next heading (any level): everything after it is
 * a subsection. For a targeted heading, run through its subsections until a
 * heading of the same or higher level ends the section.
 */
function collectSummaryAfter(heading, { ownSection = false } = {}) {
  const level = headingLevel(heading);
  const parts = [];
  let total = 0;
  for (let el = heading.nextElementSibling; el; el = el.nextElementSibling) {
    if (/^H[1-6]$/.test(el.tagName)) {
      if (ownSection || headingLevel(el) <= level) break;
      continue;
    }
    if (!el.matches("p, ul, ol, blockquote")) continue;
    const text = blockText(el);
    if (!text) continue;
    parts.push(text);
    total += text.length;
    if (total >= INTERNAL_SUMMARY_MAX) break;
  }
  return truncateToSentence(parts.join(" "), INTERNAL_SUMMARY_MAX);
}

function findInternalPreviewTarget(id) {
  if (!id) return null;
  const el = document.getElementById(id);
  if (!el) return null;
  if (/^H[1-6]$/.test(el.tagName)) return { heading: el, ownSection: false };
  if (el.tagName === "SECTION") {
    const heading = el.querySelector("h1, h2, h3, h4, h5, h6");
    return heading ? { heading, ownSection: true } : null;
  }
  // Point anchors — index locators anchor the ==term== occurrence spans
  // (idx-<slug> ids) — preview the subsection that contains the occurrence.
  return enclosingHeadingTarget(el);
}

function enclosingHeadingTarget(el) {
  const scope = el.closest(".coursebook-section") || el.closest("section");
  if (!scope) return null;
  const headings = scope.querySelectorAll("h1, h2, h3, h4, h5, h6");
  let heading = null;
  for (const h of headings) {
    if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
      heading = h;
    } else {
      break;
    }
  }
  if (heading) return { heading, ownSection: false };
  const first = headings[0];
  return first ? { heading: first, ownSection: true } : null;
}

function buildInternalPreview(href) {
  if (!isInternalHref(href) || typeof document === "undefined") return null;
  let id = href.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    // keep the raw id
  }
  const target = findInternalPreviewTarget(id);
  if (!target) return null;
  const title = headingText(target.heading);
  if (!title) return null;
  return {
    title,
    summary: collectSummaryAfter(target.heading, {
      ownSection: target.ownSection,
    }),
    image: null,
    url: href,
    internal: true,
    domain: INTERNAL_DOMAIN_LABEL,
  };
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
  title.addEventListener("click", (e) => {
    // For same-workbook previews the title must perform the link's own
    // action — a raw hash click would skip app behavior such as the index
    // locator's jump-and-flash. External titles keep their native click
    // (new tab, modifier keys) via the rendered href.
    if (!activeLink || !isInternalHref(activeLink.getAttribute("href"))) return;
    e.preventDefault();
    const link = activeLink;
    hidePopup();
    link.click();
  });
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
  const internal = !!data.internal;
  popupEl.classList.toggle("link-preview--internal", internal);

  const title = popupEl.querySelector(".link-preview__title");
  title.href = data.url;
  if (internal) {
    // The title is the same navigation the link itself performs; it must
    // stay in this window.
    title.removeAttribute("target");
    title.removeAttribute("rel");
  } else {
    title.target = "_blank";
    title.rel = "noopener noreferrer";
  }
  title.textContent = data.title;

  const summary = popupEl.querySelector(".link-preview__summary");
  if (internal) {
    // Built locally from DOM text, never HTML from the network.
    summary.textContent = data.summary;
  } else {
    summary.innerHTML = sanitizeHtml(data.summary);
  }

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
      // background. The onload handler will still hide it if it is too small.
      clearTimeout(imageTimeout);
      imageTimeout = null;
      if (image.complete) {
        finishImage();
      } else {
        finishPopup(link);
      }
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

function showFor(link, x, data) {
  clearTimeout(hideTimeout);
  hideTimeout = null;

  activeLink = link;
  activeX = x;
  createPopup();
  // Force re-positioning when switching from another link.
  if (popupEl) {
    popupEl.classList.remove("is-visible");
    popupEl.setAttribute("aria-hidden", "true");
  }
  loadPopup(link, data);
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
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
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

function onLinkEnter(link, x, { immediate = false } = {}) {
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
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }

  const href = link.getAttribute("href");
  const data =
    tryParsePreview(link) ?? globalPreviews[href] ?? buildInternalPreview(href);
  if (!data && !canFetchOnDemand(href)) {
    hidePopup();
    return;
  }

  if (immediate) {
    if (data) {
      showFor(link, x, data);
    } else {
      void fetchPreviewOnDemand(link, x, href);
    }
    return;
  }

  // Hover intent: the pointer must dwell on the link before the popup
  // appears, so sweeping the cursor across a link-rich paragraph does not
  // strobe popups. Keyboard focus skips the wait — it is deliberate. The
  // dwell also gates on-demand fetches, so drive-bys never hit the network.
  activeLink = link;
  activeX = x;
  showTimer = setTimeout(() => {
    showTimer = null;
    if (data) {
      showFor(link, x, data);
      return;
    }
    void fetchPreviewOnDemand(link, x, href);
  }, SHOW_DELAY);
}

function onLinkLeave(link) {
  if (activeLink !== link) return;
  if (showTimer) {
    // The popup never appeared; just cancel the pending show.
    clearTimeout(showTimer);
    showTimer = null;
    activeLink = null;
    activeX = null;
    return;
  }
  scheduleHide();
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

function canPreview(link) {
  const href = link.getAttribute("href");
  const data =
    tryParsePreview(link) ?? globalPreviews[href] ?? buildInternalPreview(href);
  return !!data || canFetchOnDemand(href);
}

function isExternalHref(href) {
  return typeof href === "string" && /^(?:https?:)?\/\//i.test(href);
}

/**
 * Whether hovering this link can trigger a first-time fetch — an external
 * URL one of the providers handles, with the Jina reader opting out while
 * it cools down after a 429.
 */
function canFetchOnDemand(href) {
  if (!isExternalHref(href)) return false;
  const provider = findProvider(href);
  if (!provider) return false;
  return provider.isAvailable ? provider.isAvailable() : true;
}

/**
 * Fetch a preview for an external link the first time it is hovered: new
 * links the coursebook-open preload has not covered, links missed during a
 * rate-limit cooldown, and standalone documents that never preload at all.
 * Results land in the global map so the next hover is instant (resolveCache
 * already dedupes repeat fetches). Failures stay silent, matching preload.
 */
async function fetchPreviewOnDemand(link, x, href) {
  if (onDemandFetchActive) return;
  onDemandFetchActive = true;
  try {
    const preview = await resolvePreview(href, {
      apiKey: import.meta.env?.JINA_API_KEY,
    });
    if (activeLink !== link) return;
    if (preview) {
      globalPreviews[href] = preview;
      showFor(link, x, preview);
    }
  } catch {
    // Unreachable, sign-in-gated, or rate-limited: no popup, matching the
    // preload path.
  } finally {
    onDemandFetchActive = false;
  }
}

function onMouseOver(e) {
  const link = getLinkFromEventTarget(e.target);
  if (!link) return;
  const related = getLinkFromEventTarget(e.relatedTarget);
  if (related && related === link) return;
  ensureExternal(link);
  if (!canPreview(link)) return;
  onLinkEnter(link, e.clientX);
}

function onMouseOut(e) {
  const link = getLinkFromEventTarget(e.target);
  if (!link) return;
  if (popupEl && popupEl.contains(e.relatedTarget)) return;
  const related = getLinkFromEventTarget(e.relatedTarget);
  if (related && related === link) return;
  if (activeLink === link) onLinkLeave(link);
}

function onFocusIn(e) {
  const link = getLinkFromEventTarget(e.target);
  if (!link) return;
  ensureExternal(link);
  if (!canPreview(link)) return;
  onLinkEnter(link, undefined, { immediate: true });
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

/**
 * Whether the current device lacks a hovering pointer. Link previews are a
 * hover affordance: where there is no hover they can never be revealed, and
 * the tap that would show one also dismisses it before the link navigates.
 */
function deviceHasNoHover() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none)").matches
  );
}

export class LinkPreview {
  static enhance(rootEl) {
    if (!rootEl || rootEl._linkPreviewEnhanced) return;
    if (deviceHasNoHover()) return;
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

function resetJinaRateLimit() {
  jinaRateLimitedUntil = 0;
}

export const __test = { resetState, resetJinaRateLimit };

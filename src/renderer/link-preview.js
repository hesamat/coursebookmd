const SHOW_DELAY = 150;
const HIDE_DELAY = 200;
const SCROLL_TITLE_OFFSET = 100;

const WP_HOST_REGEX = /^(?!www$)[a-z]{2,}(?:-[a-zA-Z0-9]+)?\.wikipedia\.org$/i;
const WM_IMAGE_HOST = /^https:\/\/upload\.wikimedia\.org\//i;

let popupEl = null;
let activeLink = null;
let activeProvider = null;
let activeX = null;
let pendingLink = null;
let showTimeout = null;
let hideTimeout = null;
let activeAbort = null;
const cache = new Map();
let globalListenersAttached = false;

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

    return {
      title: data.titles?.normalized || data.title || title,
      summary: data.extract || "",
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
    return parseJinaResponse(text, url);
  }
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
  let image = extractJinaImage(markdown);
  if (image && !image.startsWith("http")) {
    try {
      image = new URL(image, originalUrl).href;
    } catch {
      image = null;
    }
  }

  return {
    title: title || "Untitled",
    summary,
    image,
    url: originalUrl,
    domain: new URL(originalUrl).hostname,
  };
}

const MIN_JINA_SUMMARY_LENGTH = 120;

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
    if (text.length >= MIN_JINA_SUMMARY_LENGTH) return text.slice(0, 240);
    if (text.length > best.length) best = text;
  }
  return best.slice(0, 240);
}

function extractJinaImage(markdown) {
  const m = markdown.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
  return m ? m[1] : null;
}

const providers = [new WikipediaProvider(), new JinaReaderProvider()];

function findProvider(url) {
  return providers.find((p) => p.canHandle(url));
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

  const summary = document.createElement("p");
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

  popup.addEventListener("mouseenter", () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  });
  popup.addEventListener("mouseleave", scheduleHide);
  popup.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const canScrollDown =
        popup.scrollHeight > popup.clientHeight &&
        popup.scrollTop + popup.clientHeight < popup.scrollHeight;
      const canScrollUp = popup.scrollHeight > popup.clientHeight && popup.scrollTop > 0;
      if ((e.deltaY > 0 && canScrollDown) || (e.deltaY < 0 && canScrollUp)) {
        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 20;
        if (e.deltaMode === 2) delta *= popup.clientHeight;
        popup.scrollTop += delta;
      }
    },
    { passive: false },
  );

  document.body.appendChild(popup);
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

function renderError() {
  if (!popupEl) return;
  const title = popupEl.querySelector(".link-preview__title");
  const url = activeLink ? activeLink.getAttribute("href") : "";
  title.href = url || "";
  title.target = "_blank";
  title.rel = "noopener noreferrer";
  title.textContent = "Preview unavailable";

  popupEl.querySelector(".link-preview__summary").textContent = "";
  const imageWrap = popupEl.querySelector(".link-preview__image-wrap");
  imageWrap.setAttribute("hidden", "");
  popupEl.querySelector(".link-preview__image").onerror = null;
  popupEl.querySelector(".link-preview__domain").textContent = "";
}

function renderPreview(data) {
  if (!popupEl) return;
  const title = popupEl.querySelector(".link-preview__title");
  title.href = data.url;
  title.target = "_blank";
  title.rel = "noopener noreferrer";
  title.textContent = data.title;

  const summary = popupEl.querySelector(".link-preview__summary");
  summary.textContent = data.summary;

  const footer = popupEl.querySelector(".link-preview__domain");
  footer.textContent = data.domain || new URL(data.url).hostname;
}

function finishPopup(link) {
  if (activeLink !== link) return;
  if (!popupEl) return;
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
  if (data.image) {
    imageWrap.removeAttribute("hidden");
    image.onload = () => finishPopup(link);
    image.onerror = () => {
      imageWrap.setAttribute("hidden", "");
      finishPopup(link);
    };
    image.src = data.image;
    if (image.complete && image.naturalHeight > 0) finishPopup(link);
  } else {
    imageWrap.setAttribute("hidden", "");
    image.onerror = null;
    finishPopup(link);
  }
}

async function fetchAndRender(link) {
  const provider = activeProvider;
  if (!provider || !activeLink) return;

  const url = link.getAttribute("href");
  const controller = new window.AbortController();
  activeAbort = controller;

  try {
    const cached = cache.get(url);
    const data =
      cached ?? (await provider.fetchPreview(url, { signal: controller.signal }));
    if (!data) throw new Error("no data");
    if (!cached) cache.set(url, data);
    if (activeLink !== link) return;
    loadPopup(link, data);
  } catch (e) {
    if (e.name === "AbortError") return;
    if (activeLink !== link) return;
    renderError();
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
  clearTimeout(showTimeout);
  showTimeout = null;
  clearTimeout(hideTimeout);
  hideTimeout = null;

  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
  if (activeLink === link) return;

  const preloaded = tryParsePreview(link);
  if (preloaded) {
    activeLink = link;
    activeProvider = null;
    activeX = x;
    createPopup();
    loadPopup(link, preloaded);
    return;
  }

  const provider = findProvider(link.getAttribute("href"));
  if (!provider) return;

  activeLink = link;
  activeProvider = provider;
  activeX = x;

  const popup = createPopup();

  const title = popup.querySelector(".link-preview__title");
  const url = link.getAttribute("href");
  title.href = url;
  title.target = "_blank";
  title.rel = "noopener noreferrer";
  title.textContent = "Loading…";
  popup.querySelector(".link-preview__summary").textContent = "";
  popup.querySelector(".link-preview__image-wrap").setAttribute("hidden", "");
  popup.querySelector(".link-preview__image").onerror = null;
  popup.querySelector(".link-preview__domain").textContent = "";

  fetchAndRender(link);
}

function scheduleHide() {
  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(hidePopup, HIDE_DELAY);
}

function hidePopup() {
  clearTimeout(showTimeout);
  showTimeout = null;
  clearTimeout(hideTimeout);
  hideTimeout = null;

  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }

  activeLink = null;
  activeProvider = null;
  activeX = null;

  if (popupEl) {
    popupEl.classList.remove("is-visible");
    popupEl.setAttribute("aria-hidden", "true");
  }
}

function onLinkEnter(link, isFocus, x) {
  if (activeLink === link) {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    return;
  }
  if (pendingLink === link) {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    return;
  }

  if (showTimeout) {
    clearTimeout(showTimeout);
    showTimeout = null;
  }
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }

  pendingLink = link;
  showTimeout = setTimeout(
    () => {
      pendingLink = null;
      showFor(link, x);
    },
    isFocus ? 0 : SHOW_DELAY,
  );
}

function onLinkLeave(link) {
  if (pendingLink === link) {
    clearTimeout(showTimeout);
    showTimeout = null;
    pendingLink = null;
  }
  if (activeLink) scheduleHide();
}

function getLinkFromEventTarget(target) {
  return target?.closest ? target.closest("a[href]") : null;
}

function ensureExternal(link) {
  if (link.getAttribute("target") !== "_blank") {
    link.setAttribute("target", "_blank");
  }
  if (link.getAttribute("rel") !== "noopener noreferrer") {
    link.setAttribute("rel", "noopener noreferrer");
  }
}

function onMouseOver(e) {
  const link = getLinkFromEventTarget(e.target);
  if (!link) return;
  const related = getLinkFromEventTarget(e.relatedTarget);
  if (related && related === link) return;
  if (!findProvider(link.getAttribute("href"))) return;
  ensureExternal(link);
  onLinkEnter(link, false, e.clientX);
}

function onMouseOut(e) {
  const link = getLinkFromEventTarget(e.target);
  if (!link) return;
  const related = getLinkFromEventTarget(e.relatedTarget);
  if (related && related === link) return;
  if (activeLink === link || pendingLink === link) onLinkLeave(link);
}

function onFocusIn(e) {
  const link = getLinkFromEventTarget(e.target);
  if (!link) return;
  if (!findProvider(link.getAttribute("href"))) return;
  ensureExternal(link);
  onLinkEnter(link, true);
}

function onFocusOut(e) {
  const link = getLinkFromEventTarget(e.target);
  if (!link) return;
  const related = getLinkFromEventTarget(e.relatedTarget);
  if (related && (related === link || link.contains(related))) return;
  if (activeLink === link || pendingLink === link) onLinkLeave(link);
}

function onClick(e) {
  const link = getLinkFromEventTarget(e.target);
  if (!link) return;
  if (findProvider(link.getAttribute("href"))) hidePopup();
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
  cache.clear();
  pendingLink = null;
  activeLink = null;
  activeProvider = null;
  if (globalListenersAttached) {
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onScrollOrResize);
    window.removeEventListener("scroll", onScrollOrResize, true);
    globalListenersAttached = false;
  }
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

  static hide() {
    hidePopup();
  }
}

export const __test = { resetState, providers };

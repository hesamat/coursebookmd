import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  JinaReaderProvider,
  WikipediaProvider,
  LinkPreview,
  isJinaRateLimited,
  __test,
} from "../renderer/link-preview.js";

function mockFetch(response) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
}

function mockFetchText(text) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => text,
  });
}

function clearFetch() {
  globalThis.fetch = undefined;
}

describe("WikipediaProvider", () => {
  const provider = new WikipediaProvider();

  it("handles wikipedia.org /wiki/ URLs", () => {
    expect(provider.canHandle("https://en.wikipedia.org/wiki/JavaScript")).toBe(true);
    expect(provider.canHandle("https://fr.wikipedia.org/wiki/Paris")).toBe(true);
    expect(provider.canHandle("https://en.m.wikipedia.org/wiki/React")).toBe(false);
  });

  it("rejects non-wikipedia and non-wiki paths", () => {
    expect(provider.canHandle("https://example.com")).toBe(false);
    expect(provider.canHandle("https://en.wikipedia.org/w/index.php")).toBe(false);
    expect(provider.canHandle("#section")).toBe(false);
    expect(provider.canHandle("/chapters/01.md")).toBe(false);
    expect(provider.canHandle("mailto:hello@example.com")).toBe(false);
  });

  it("fetches and formats a summary", async () => {
    mockFetch({
      title: "JavaScript",
      titles: { normalized: "JavaScript" },
      extract: "A programming language.",
      thumbnail: {
        source: "https://upload.wikimedia.org/wikipedia/commons/thumb/js.png",
      },
    });

    const result = await provider.fetchPreview(
      "https://en.wikipedia.org/wiki/JavaScript",
      {
        signal: undefined,
      },
    );

    expect(result.title).toBe("JavaScript");
    expect(result.summary).toContain("A programming language.");
    expect(result.image).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/js.png",
    );
    expect(result.domain).toBe("wikipedia.org");
    clearFetch();
  });

  it("drops thumbnails that are not from upload.wikimedia.org", async () => {
    mockFetch({
      title: "Foo",
      extract: "Bar.",
      thumbnail: { source: "https://evil.example.com/image.png" },
    });

    const result = await provider.fetchPreview("https://en.wikipedia.org/wiki/Foo", {
      signal: undefined,
    });

    expect(result.image).toBeNull();
    clearFetch();
  });

  it("throws on non-ok responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    await expect(
      provider.fetchPreview("https://en.wikipedia.org/wiki/NotFound", {
        signal: undefined,
      }),
    ).rejects.toThrow("HTTP 404");
    clearFetch();
  });
});

describe("JinaReaderProvider", () => {
  const provider = new JinaReaderProvider();

  beforeEach(() => {
    __test.resetJinaRateLimit();
    clearFetch();
  });

  it("handles any http/https URL", () => {
    expect(provider.canHandle("https://fourmilab.ch/babbage/sketch.html")).toBe(true);
    expect(provider.canHandle("http://example.com")).toBe(true);
    expect(provider.canHandle("mailto:hello@example.com")).toBe(false);
    expect(provider.canHandle("/chapters/01.md")).toBe(false);
  });

  it("parses the Jina reader response", async () => {
    const jinaText = `Title: Sketch of The Analytical Engine
URL Source: http://www.fourmilab.ch/babbage/sketch.html

Markdown Content:
## Sketch of

![Image 1: The Analytical Engine](http://www.fourmilab.ch/babbage/figures/aetitlewt.png)

Those labours which belong to the various branches of the mathematical sciences may, nevertheless, be divided into two distinct sections; one of which may be called the mechanical, because it is subjected to precise and invariable laws, that are capable of being expressed by means of the operations of matter.
`;
    mockFetchText(jinaText);

    const result = await provider.fetchPreview(
      "http://www.fourmilab.ch/babbage/sketch.html",
    );

    expect(result.title).toBe("Sketch of The Analytical Engine");
    expect(result.summary).toContain("Those labours");
    expect(result.image).toBe("http://www.fourmilab.ch/babbage/figures/aetitlewt.png");
    expect(result.domain).toBe("www.fourmilab.ch");
    clearFetch();
  });

  it("throws on non-ok responses", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => "" });

    await expect(provider.fetchPreview("https://example.com")).rejects.toThrow(
      "HTTP 500",
    );
    clearFetch();
  });

  it("returns null for sign-in pages", async () => {
    const jinaText = `Title: Sign in
URL Source: https://example.com/private

Markdown Content:
Please sign in to continue reading.
`;
    mockFetchText(jinaText);
    const result = await provider.fetchPreview("https://example.com/private");
    expect(result).toBeNull();
    clearFetch();
  });

  it("cools down after a 429 instead of retrying the reader", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 429, text: async () => "" });

    const first = await provider.fetchPreview("https://example.com/a").catch((e) => e);
    expect(first.rateLimited).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(isJinaRateLimited()).toBe(true);

    // Every other URL fails fast while the cooldown holds: no more requests.
    const second = await provider.fetchPreview("https://example.com/b").catch((e) => e);
    expect(second.rateLimited).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    clearFetch();
  });

  it("requests again once the rate-limit cooldown is over", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 429, text: async () => "" });
    await provider.fetchPreview("https://example.com/a").catch(() => {});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    __test.resetJinaRateLimit();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => "" });
    await expect(provider.fetchPreview("https://example.com/b")).rejects.toThrow(
      "HTTP 500",
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    clearFetch();
  });
});

describe("LinkPreview", () => {
  beforeEach(() => {
    __test.resetState();
    clearFetch();
  });

  afterEach(() => {
    __test.resetState();
    clearFetch();
  });

  it("creates a popup on focus and shows the preloaded preview", async () => {
    const root = document.createElement("div");
    const link = document.createElement("a");
    link.href = "https://en.wikipedia.org/wiki/JavaScript";
    link.target = "_blank";
    root.appendChild(link);
    document.body.appendChild(root);

    LinkPreview.setPreviews({
      "https://en.wikipedia.org/wiki/JavaScript": {
        title: "JavaScript",
        summary: "A programming language.",
        image: null,
        url: "https://en.wikipedia.org/wiki/JavaScript",
        domain: "wikipedia.org",
      },
    });
    LinkPreview.enhance(root);
    link.focus();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const popup = document.body.querySelector(".link-preview");
    expect(popup).not.toBeNull();
    expect(popup.classList.contains("is-visible")).toBe(true);
    expect(popup.getAttribute("aria-hidden")).toBe("false");
    expect(popup.querySelector(".link-preview__title").textContent).toBe("JavaScript");
    expect(popup.querySelector(".link-preview__summary").textContent).toBe(
      "A programming language.",
    );
    expect(popup.querySelector(".link-preview__title").target).toBe("_blank");

    document.body.removeChild(root);
  });

  it("attaches nothing on a device that cannot hover", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true }));
    try {
      const root = document.createElement("div");
      const link = document.createElement("a");
      link.href = "https://en.wikipedia.org/wiki/JavaScript";
      link.dataset.preview = JSON.stringify({
        title: "JavaScript",
        summary: "<p>A programming language.</p>",
        image: null,
        url: link.href,
        domain: "wikipedia.org",
      });
      root.appendChild(link);
      document.body.appendChild(root);

      LinkPreview.enhance(root);
      link.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));

      // No listeners, no card: a tap on a phone can neither show nor flash it.
      expect(document.body.querySelector(".link-preview")).toBeNull();
      expect(root._linkPreviewEnhanced).toBeUndefined();

      document.body.removeChild(root);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("hides the popup on Escape", async () => {
    const root = document.createElement("div");
    const link = document.createElement("a");
    link.href = "https://en.wikipedia.org/wiki/JavaScript";
    root.appendChild(link);
    document.body.appendChild(root);

    LinkPreview.enhance(root);
    link.focus();
    await new Promise((resolve) => setTimeout(resolve, 10));

    document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    const popup = document.body.querySelector(".link-preview");
    expect(popup.classList.contains("is-visible")).toBe(false);
    expect(popup.getAttribute("aria-hidden")).toBe("true");

    document.body.removeChild(root);
  });

  it("does nothing for non-http links", () => {
    const root = document.createElement("div");
    const link = document.createElement("a");
    link.href = "mailto:hello@example.com";
    root.appendChild(link);
    document.body.appendChild(root);

    LinkPreview.enhance(root);
    link.focus();

    expect(document.body.querySelector(".link-preview")).toBeNull();
    document.body.removeChild(root);
  });

  it("uses a preloaded global previews map", async () => {
    const root = document.createElement("div");
    const link = document.createElement("a");
    link.href = "https://example.com";
    root.appendChild(link);
    document.body.appendChild(root);

    LinkPreview.setPreviews({
      "https://example.com": {
        title: "Global",
        summary: "From map.",
        image: null,
        url: "https://example.com",
        domain: "example.com",
      },
    });
    LinkPreview.enhance(root);
    link.focus();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const popup = document.body.querySelector(".link-preview");
    expect(popup).not.toBeNull();
    expect(popup.classList.contains("is-visible")).toBe(true);
    expect(popup.querySelector(".link-preview__title").textContent).toBe("Global");
    expect(popup.querySelector(".link-preview__summary").textContent).toBe("From map.");

    document.body.removeChild(root);
  });

  it("uses a preloaded data-preview attribute", async () => {
    const root = document.createElement("div");
    const link = document.createElement("a");
    link.href = "https://example.com";
    link.setAttribute(
      "data-preview",
      JSON.stringify({
        title: "Preloaded",
        summary: "Cached preview.",
        image: null,
        url: "https://example.com",
        domain: "example.com",
      }),
    );
    root.appendChild(link);
    document.body.appendChild(root);

    LinkPreview.enhance(root);
    link.focus();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const popup = document.body.querySelector(".link-preview");
    expect(popup).not.toBeNull();
    expect(popup.classList.contains("is-visible")).toBe(true);
    expect(popup.querySelector(".link-preview__title").textContent).toBe("Preloaded");
    expect(popup.querySelector(".link-preview__summary").textContent).toBe(
      "Cached preview.",
    );

    document.body.removeChild(root);
  });
});

describe("same-workbook link previews", () => {
  let root;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function setupContent(html) {
    root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  }

  function focusLink(selector) {
    LinkPreview.enhance(root);
    root.querySelector(selector).focus();
    return wait(50);
  }

  function popup() {
    return document.body.querySelector(".link-preview");
  }

  beforeEach(() => {
    __test.resetState();
    clearFetch();
  });

  afterEach(() => {
    __test.resetState();
    clearFetch();
    root?.remove();
    root = null;
  });

  it("previews a section anchor from its first heading and intro", async () => {
    setupContent(`
      <section id="getting-started" class="coursebook-section">
        <h1><span class="heading-number">1 </span>Getting Started</h1>
        <p>CoursebookMD turns a folder of Markdown files into a coursebook.</p>
        <h2><span class="heading-number">1.1 </span>Opening Files</h2>
        <p>Use the sidebar to open files.</p>
      </section>
      <a href="#getting-started">Getting Started</a>
    `);
    await focusLink('a[href="#getting-started"]');

    const card = popup();
    expect(card).not.toBeNull();
    expect(card.classList.contains("is-visible")).toBe(true);
    expect(card.querySelector(".link-preview__title").textContent).toBe(
      "Getting Started",
    );
    // A section preview stops at the next heading of any level: the 1.1
    // subsection is not part of the intro.
    expect(card.querySelector(".link-preview__summary").textContent).toBe(
      "CoursebookMD turns a folder of Markdown files into a coursebook.",
    );
  });

  it("previews a heading anchor through its subsections", async () => {
    setupContent(`
      <section id="ch1" class="coursebook-section">
        <h2 id="overview">Overview</h2>
        <p>Intro text here.</p>
        <h3>Details</h3>
        <ul><li>Deep detail.</li><li>More depth.</li></ul>
        <h2 id="next">Next Section</h2>
        <p>Elsewhere.</p>
      </section>
      <a href="#overview">Overview</a>
    `);
    await focusLink('a[href="#overview"]');

    const card = popup();
    expect(card).not.toBeNull();
    expect(card.querySelector(".link-preview__title").textContent).toBe("Overview");
    const summary = card.querySelector(".link-preview__summary").textContent;
    expect(summary).toContain("Intro text here.");
    expect(summary).toContain("Deep detail.; More depth.");
    // The next h2 ends the section, so its content stays out.
    expect(summary).not.toContain("Elsewhere.");
  });

  it("shows nothing when the anchor has no target", () => {
    setupContent(`
      <section id="ch1"><h2>Real</h2><p>Text.</p></section>
      <a href="#missing">Missing</a>
    `);
    LinkPreview.enhance(root);
    root.querySelector('a[href="#missing"]').focus();

    expect(popup()).toBeNull();
  });

  it("renders an in-page title link and workbook footer", async () => {
    setupContent(`
      <section id="ch1"><h2>Chapter</h2><p>Body text.</p></section>
      <a href="#ch1">Chapter</a>
    `);
    await focusLink('a[href="#ch1"]');

    const card = popup();
    const title = card.querySelector(".link-preview__title");
    expect(title.getAttribute("href")).toBe("#ch1");
    expect(title.getAttribute("target")).toBeNull();
    expect(card.classList.contains("link-preview--internal")).toBe(true);
    expect(card.querySelector(".link-preview__domain").textContent).toBe("This workbook");
  });

  it("truncates long section content at a sentence boundary", async () => {
    const long = "Long sentence one. ".repeat(60);
    setupContent(`
      <section id="ch1"><h2>Chapter</h2><p>${long}</p></section>
      <a href="#ch1">Chapter</a>
    `);
    await focusLink('a[href="#ch1"]');

    const summary = popup().querySelector(".link-preview__summary").textContent;
    expect(summary.length).toBeLessThanOrEqual(400);
    expect(summary).toMatch(/\.$/);
  });

  it("previews the enclosing subsection for a point anchor (index locator)", async () => {
    setupContent(`
      <section id="ch1" class="coursebook-section">
        <h1>Chapter One</h1>
        <p>Chapter intro.</p>
        <h2><span class="heading-number">1.1 </span>Indexed Terms</h2>
        <p>Read about <span class="idx" id="idx-term">term</span> here.</p>
        <h2><span class="heading-number">1.2 </span>Next Section</h2>
        <p>Elsewhere.</p>
      </section>
      <a href="#idx-term">1.1</a>
    `);
    await focusLink('a[href="#idx-term"]');

    const card = popup();
    expect(card).not.toBeNull();
    // The point anchor previews the subsection containing the occurrence,
    // not the chapter intro and not later subsections.
    expect(card.querySelector(".link-preview__title").textContent).toBe("Indexed Terms");
    const summary = card.querySelector(".link-preview__summary").textContent;
    expect(summary).toContain("Read about term here.");
    expect(summary).not.toContain("Chapter intro.");
    expect(summary).not.toContain("Elsewhere.");
  });

  it("falls back to the section intro when a point anchor precedes all headings", async () => {
    setupContent(`
      <section id="ch1" class="coursebook-section">
        <p>Preamble about <span class="idx" id="idx-term">term</span>.</p>
        <h1>Chapter One</h1>
        <p>Chapter intro.</p>
      </section>
      <a href="#idx-term">1</a>
    `);
    await focusLink('a[href="#idx-term"]');

    const card = popup();
    expect(card).not.toBeNull();
    expect(card.querySelector(".link-preview__title").textContent).toBe("Chapter One");
    expect(card.querySelector(".link-preview__summary").textContent).toBe(
      "Chapter intro.",
    );
  });

  it("shows a hover preview only after the pointer dwells", async () => {
    setupContent(`
      <section id="ch1"><h2>Chapter</h2><p>Body text.</p></section>
      <a href="#ch1">Chapter</a>
    `);
    LinkPreview.enhance(root);
    root
      .querySelector('a[href="#ch1"]')
      .dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));

    // Hover intent: a drive-by mouseover within the dwell window shows
    // nothing yet.
    await wait(50);
    expect(popup()).toBeNull();

    await wait(300);
    const card = popup();
    expect(card).not.toBeNull();
    expect(card.classList.contains("is-visible")).toBe(true);
  });

  it("cancels a hover preview when the pointer leaves before the dwell", async () => {
    setupContent(`
      <section id="ch1"><h2>Chapter</h2><p>Body text.</p></section>
      <a href="#ch1">Chapter</a>
    `);
    const link = root.querySelector('a[href="#ch1"]');
    LinkPreview.enhance(root);
    link.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
    link.dispatchEvent(
      new window.MouseEvent("mouseout", { bubbles: true, relatedTarget: root }),
    );

    await wait(300);
    expect(popup()).toBeNull();
  });

  it("clicking an internal popup title performs the link's own action", async () => {
    setupContent(`
      <section id="ch1"><h2>Chapter</h2><p>Body text.</p></section>
      <a href="#ch1">Chapter</a>
    `);
    let linkClicked = false;
    root.querySelector('a[href="#ch1"]').addEventListener("click", () => {
      linkClicked = true;
    });
    await focusLink('a[href="#ch1"]');

    const card = popup();
    card
      .querySelector(".link-preview__title")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

    // The forwarded click carries the link's app behavior, and the popup
    // closes instead of surviving the navigation.
    expect(linkClicked).toBe(true);
    expect(card.classList.contains("is-visible")).toBe(false);
  });
});

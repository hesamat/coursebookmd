import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  JinaReaderProvider,
  WikipediaProvider,
  LinkPreview,
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
    expect(result.summary).toBe("A programming language.");
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
    expect(result.summary.startsWith("Those labours")).toBe(true);
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

  it("creates a popup on focus and shows the provider result", async () => {
    mockFetch({
      title: "JavaScript",
      titles: { normalized: "JavaScript" },
      extract: "A programming language.",
    });

    const root = document.createElement("div");
    const link = document.createElement("a");
    link.href = "https://en.wikipedia.org/wiki/JavaScript";
    link.target = "_blank";
    root.appendChild(link);
    document.body.appendChild(root);

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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WikipediaProvider, LinkPreview, __test } from "../renderer/link-preview.js";

function mockFetch(response) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => response,
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

  it("does nothing for non-wikipedia links", () => {
    const root = document.createElement("div");
    const link = document.createElement("a");
    link.href = "https://example.com";
    root.appendChild(link);
    document.body.appendChild(root);

    LinkPreview.enhance(root);
    link.focus();

    expect(document.body.querySelector(".link-preview")).toBeNull();
    document.body.removeChild(root);
  });
});

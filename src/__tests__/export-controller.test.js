import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../renderer/link-preview.js", () => ({
  LinkPreview: { setPreviews: vi.fn(), enhance: vi.fn() },
  extractLinks: vi.fn(),
  resolvePreview: vi.fn(),
}));

vi.mock("../renderer/coursebook-exporter.js", () => ({
  exportCoursebookHtml: vi.fn(),
  exportSingleHtml: vi.fn(),
}));

import { createExportController } from "../controllers/export-controller.js";
import { LinkPreview, extractLinks, resolvePreview } from "../renderer/link-preview.js";

function rateLimitError() {
  const error = new Error("HTTP 429 (rate limited)");
  error.rateLimited = true;
  return error;
}

describe("export controller link-preview preloading", () => {
  let state;
  let showToast;
  let warn;

  beforeEach(() => {
    state = {
      coursebook: { markdown: "# Book", chapters: [] },
      linkPreviews: {},
      localFileStore: null,
    };
    showToast = vi.fn();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    extractLinks.mockReset();
    resolvePreview.mockReset();
    LinkPreview.setPreviews.mockReset();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  function controller() {
    return createExportController({
      state,
      localAssets: {},
      showToast,
      flushEditor: vi.fn(),
    });
  }

  it("attempts each URL once when the reader is rate limited", async () => {
    const urls = [
      "https://a.example",
      "https://b.example",
      "https://c.example",
      "https://d.example",
      "https://e.example",
    ];
    extractLinks.mockReturnValue(urls);
    resolvePreview.mockRejectedValue(rateLimitError());

    await controller().preloadMissingLinkPreviews(state.coursebook);

    // One request per URL: no re-queueing, no backoff retry storm.
    expect(resolvePreview).toHaveBeenCalledTimes(urls.length);
    for (const url of urls) {
      expect(resolvePreview).toHaveBeenCalledWith(url, { apiKey: undefined });
    }
    // A rate limit writes nothing into the cache, so a later open retries.
    expect(state.linkPreviews).toEqual({});
    expect(LinkPreview.setPreviews).not.toHaveBeenCalled();

    // One concise line, with the URL list trimmed.
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0];
    expect(message).toContain("Link previews unavailable for 5 of 5 URL(s)");
    expect(message).toContain("rate limited; they will retry later");
    expect(message).toContain("https://a.example");
    expect(message).toContain("(+2 more)");
    expect(showToast).toHaveBeenCalledWith(
      "Link previews rate-limited — will retry in a few minutes.",
    );
  });

  it("keeps successful previews and reports only the failures", async () => {
    extractLinks.mockReturnValue(["https://ok.example", "https://bad.example"]);
    resolvePreview.mockImplementation(async (url) => {
      if (url === "https://ok.example") {
        return {
          title: "Ok",
          summary: "Summary",
          image: null,
          url,
          domain: "ok.example",
        };
      }
      throw new Error("HTTP 403");
    });

    await controller().preloadMissingLinkPreviews(state.coursebook);

    expect(state.linkPreviews["https://ok.example"]).toBeTruthy();
    expect(state.linkPreviews["https://bad.example"]).toBeUndefined();
    expect(LinkPreview.setPreviews).toHaveBeenCalledWith(state.linkPreviews);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("1 of 2 URL(s)");
    expect(warn.mock.calls[0][0]).not.toContain("rate limited");
    expect(showToast).toHaveBeenCalledWith("Link previews ready");
    expect(showToast).not.toHaveBeenCalledWith(
      "Link previews rate-limited — will retry in a few minutes.",
    );
  });

  it("skips URLs that already have a preview", async () => {
    extractLinks.mockReturnValue(["https://cached.example", "https://new.example"]);
    state.linkPreviews["https://cached.example"] = { title: "Cached" };
    resolvePreview.mockResolvedValue(null);

    await controller().preloadMissingLinkPreviews(state.coursebook);

    expect(resolvePreview).toHaveBeenCalledTimes(1);
    expect(resolvePreview).toHaveBeenCalledWith("https://new.example", {
      apiKey: undefined,
    });
  });

  it("gives up quietly when the coursebook changed mid-flight", async () => {
    extractLinks.mockReturnValue(["https://a.example", "https://b.example"]);
    resolvePreview.mockImplementation(async () => {
      state.coursebook = { markdown: "# Other", chapters: [] };
      return null;
    });
    const original = state.coursebook;

    await controller().preloadMissingLinkPreviews(original);

    expect(warn).not.toHaveBeenCalled();
    expect(state.linkPreviews).toEqual({});
  });
});

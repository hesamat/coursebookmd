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
      expect(resolvePreview).toHaveBeenCalledWith(url, {
        apiKey: undefined,
        signal: expect.any(AbortSignal),
        fresh: false,
      });
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
      signal: expect.any(AbortSignal),
      fresh: false,
    });
  });

  it("retries URLs whose seeded cache entry is null", async () => {
    // previews.json records fetches that failed at build time as null. Those
    // must count as missing on open, not as covered, or one bad network day
    // would suppress the bulk preview build forever.
    extractLinks.mockReturnValue(["https://failed-before.example", "https://ok.example"]);
    state.linkPreviews = {
      "https://failed-before.example": null,
      "https://ok.example": { title: "Ok" },
    };
    resolvePreview.mockResolvedValue({
      title: "Recovered",
      summary: "Summary",
      image: null,
      url: "https://failed-before.example",
      domain: "failed-before.example",
    });

    await controller().preloadMissingLinkPreviews(state.coursebook);

    expect(resolvePreview).toHaveBeenCalledTimes(1);
    expect(resolvePreview).toHaveBeenCalledWith("https://failed-before.example", {
      apiKey: undefined,
      signal: expect.any(AbortSignal),
      fresh: false,
    });
    expect(state.linkPreviews["https://failed-before.example"]).toEqual({
      title: "Recovered",
      summary: "Summary",
      image: null,
      url: "https://failed-before.example",
      domain: "failed-before.example",
    });
    expect(showToast).toHaveBeenCalledWith("Link previews ready");
    expect(warn).not.toHaveBeenCalled();
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

  it("does not fetch when the export runs from the disk cache (?previews=disk)", async () => {
    extractLinks.mockReturnValue(["https://a.example"]);
    window.history.replaceState(null, "", "/?coursebook=/courses/x.md&previews=disk");

    try {
      await controller().preloadMissingLinkPreviews(state.coursebook);

      // The CLI export must be reproducible: it renders from the previews
      // seeded from previews.json, so nothing is fetched and nothing is built.
      expect(resolvePreview).not.toHaveBeenCalled();
      expect(LinkPreview.setPreviews).not.toHaveBeenCalled();
      expect(showToast).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});

describe("export controller rebuildLinkPreviews", () => {
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

  function fakeWritable(writes) {
    return {
      write: async (text) => writes.push(text),
      close: async () => {},
    };
  }

  it("refetches every link fresh and saves previews.json when writable", async () => {
    extractLinks.mockReturnValue(["https://a.example", "https://b.example"]);
    state.linkPreviews = { "https://a.example": { title: "Old A" } };
    resolvePreview.mockImplementation(async (url) => ({
      title: url === "https://a.example" ? "Fresh A" : "Fresh B",
      summary: "Summary",
      image: null,
      url,
      domain: "example",
    }));
    const writes = [];
    state.localFileStore = {
      dirHandle: {
        getFileHandle: async () => ({ createWritable: async () => fakeWritable(writes) }),
      },
    };

    await controller().rebuildLinkPreviews();

    // A rebuild ignores the session cache: even the URL that already had a
    // preview goes back to the network.
    expect(resolvePreview).toHaveBeenCalledTimes(2);
    for (const [, options] of resolvePreview.mock.calls) {
      expect(options.fresh).toBe(true);
    }
    const saved = JSON.parse(writes[0]);
    expect(saved["https://a.example"].title).toBe("Fresh A");
    expect(saved["https://b.example"].title).toBe("Fresh B");
    expect(LinkPreview.setPreviews).toHaveBeenCalledWith(state.linkPreviews);
    expect(showToast).toHaveBeenCalledWith(
      "Link previews rebuilt (2 of 2 fetched) and saved.",
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the previous entry when a refetch fails", async () => {
    extractLinks.mockReturnValue(["https://good.example", "https://broken.example"]);
    state.linkPreviews = {
      "https://good.example": { title: "Keep me" },
      "https://broken.example": null,
    };
    resolvePreview.mockImplementation(async (url) => {
      if (url === "https://broken.example") throw new Error("HTTP 403");
      return null;
    });
    const writes = [];
    state.localFileStore = {
      dirHandle: {
        getFileHandle: async () => ({ createWritable: async () => fakeWritable(writes) }),
      },
    };

    await controller().rebuildLinkPreviews();

    // A throttled or failed fetch must never overwrite good cache data.
    const saved = JSON.parse(writes[0]);
    expect(saved["https://good.example"]).toEqual({ title: "Keep me" });
    expect(saved["https://broken.example"]).toBeNull();
    expect(showToast).toHaveBeenCalledWith(
      "Link previews rebuilt (0 of 2 fetched) and saved.",
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("1 of 2 URL(s)");
    expect(warn.mock.calls[0][0]).toContain("https://broken.example");
  });

  it("stays session-only when the coursebook folder is not writable", async () => {
    extractLinks.mockReturnValue(["https://a.example"]);
    resolvePreview.mockResolvedValue({
      title: "A",
      summary: "Summary",
      image: null,
      url: "https://a.example",
      domain: "example",
    });

    await controller().rebuildLinkPreviews();

    expect(state.linkPreviews["https://a.example"]).toEqual({
      title: "A",
      summary: "Summary",
      image: null,
      url: "https://a.example",
      domain: "example",
    });
    expect(showToast).toHaveBeenCalledWith(
      "Link previews rebuilt for this session (open the coursebook folder to save them).",
    );
  });

  it("does nothing without a loaded coursebook", async () => {
    state.coursebook = null;

    await controller().rebuildLinkPreviews();

    expect(resolvePreview).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});

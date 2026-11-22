import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../core/fs.js", () => ({
  readFileFromDirectory: vi.fn(),
}));

import { readFileFromDirectory } from "../core/fs.js";
import {
  createDocCardsController,
  docCardsPathFor,
} from "../controllers/doc-cards-controller.js";
import {
  getActiveDocCards,
  matchDocCard,
  resetDocCardsForTests,
} from "../core/doc-cards.js";

const GLOSSARY = [
  "## COUNT",
  "https://www.postgresql.org/docs/current/functions-aggregate.html",
  "",
  "Signatures:",
  "",
  "```",
  "COUNT(*)",
  "```",
  "",
  "Counts rows.",
].join("\n");

function makeController(state) {
  return createDocCardsController({ state, showToast: vi.fn() });
}

describe("docCardsPathFor", () => {
  it("sits next to the coursebook", () => {
    expect(docCardsPathFor("coursebook.md")).toBe("doc-cards.md");
    expect(docCardsPathFor("docs/coursebook.md")).toBe("docs/doc-cards.md");
    expect(docCardsPathFor(null)).toBeNull();
  });
});

describe("createDocCardsController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDocCardsForTests();
    globalThis.fetch = undefined;
  });

  afterEach(() => {
    globalThis.fetch = undefined;
  });

  it("dirHandle mode: a missing glossary degrades to the pack silently", async () => {
    readFileFromDirectory.mockRejectedValue(
      Object.assign(new Error("File not found in selected folder."), { code: "ENOENT" }),
    );
    const state = { localFileStore: { dirHandle: {} }, sectionMarkdowns: [] };
    const coursebook = { parentPath: "coursebook.md", chapters: [] };
    const { problems } = await makeController(state).loadForCoursebook(coursebook);

    expect(problems.errors).toEqual([]);
    expect(getActiveDocCards().exactMap.get("len")?.id).toBe("python:len");
    expect(getActiveDocCards().exactMap.get("COUNT")).toBeUndefined();
    expect(readFileFromDirectory).toHaveBeenCalledWith(
      {},
      "doc-cards.md",
      expect.objectContaining({ quiet: true }),
    );
  });

  it("dirHandle mode: a present glossary builds the author registry", async () => {
    readFileFromDirectory.mockResolvedValue({ file: { text: async () => GLOSSARY } });
    const state = { localFileStore: { dirHandle: {} }, sectionMarkdowns: [] };
    const coursebook = { parentPath: "coursebook.md", chapters: [] };
    await makeController(state).loadForCoursebook(coursebook);

    expect(getActiveDocCards().exactMap.get("COUNT")?.id).toBe("book:count");
    expect(getActiveDocCards().exactMap.get("len")?.id).toBe("python:len");
  });

  it("dirHandle mode: read errors are reported, not treated as missing", async () => {
    readFileFromDirectory.mockRejectedValue(new Error("permission denied"));
    const state = { localFileStore: { dirHandle: {} }, sectionMarkdowns: [] };
    const coursebook = { parentPath: "coursebook.md", chapters: [] };
    const { problems } = await makeController(state).loadForCoursebook(coursebook);

    expect(problems.errors[0]).toContain("could not be read");
    expect(getActiveDocCards().exactMap.get("len")?.id).toBe("python:len");
  });

  it("fileMap mode: reads the glossary sibling by coursebook-relative path", async () => {
    const file = { text: async () => GLOSSARY };
    const state = {
      localFileStore: { fileMap: new Map([["docs/doc-cards.md", file]]) },
      sectionMarkdowns: [],
    };
    const coursebook = { parentPath: "docs/coursebook.md", chapters: [] };
    await makeController(state).loadForCoursebook(coursebook);

    expect(getActiveDocCards().exactMap.get("COUNT")?.id).toBe("book:count");
  });

  it("URL mode: 404 means missing, 500 means a read error", async () => {
    const state = { localFileStore: null, sectionMarkdowns: [] };
    const controller = makeController(state);
    const coursebook = { parentPath: "docs/coursebook.md", chapters: [] };

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const missing = await controller.loadForCoursebook(coursebook);
    expect(missing.problems.errors).toEqual([]);
    expect(getActiveDocCards().exactMap.get("len")?.id).toBe("python:len");

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const failed = await controller.loadForCoursebook(coursebook);
    expect(failed.problems.errors[0]).toContain("HTTP 500");
  });

  it("URL mode: the SPA shell is missing, but a glossary comment never is", async () => {
    const state = { localFileStore: null, sectionMarkdowns: [] };
    const controller = makeController(state);
    const coursebook = { parentPath: "docs/coursebook.md", chapters: [] };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => "<!doctype html>\n<html><body>app shell</body></html>",
    });
    await controller.loadForCoursebook(coursebook);
    expect(getActiveDocCards().exactMap.get("COUNT")).toBeUndefined();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => GLOSSARY,
    });
    await controller.loadForCoursebook(coursebook);
    expect(getActiveDocCards().exactMap.get("COUNT")?.id).toBe("book:count");
  });

  it("reuses the glossary chapter's loaded markdown without re-fetching", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const state = { localFileStore: null, sectionMarkdowns: [] };
    const coursebook = {
      parentPath: "docs/coursebook.md",
      chapters: [
        {
          title: "Reference",
          path: "doc-cards.md",
          resolvedPath: "docs/doc-cards.md",
          slug: "reference",
          markdown: GLOSSARY,
        },
      ],
    };
    await makeController(state).loadForCoursebook(coursebook);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getActiveDocCards().exactMap.get("COUNT")?.id).toBe("book:count");
    // URL-less entries resolve against the glossary chapter when it exists.
    expect(matchDocCard("COUNT")?.url).toBe(
      "https://www.postgresql.org/docs/current/functions-aggregate.html",
    );
  });

  it("applyGlossaryText rebuilds from edited text; resetToPack restores the pack", async () => {
    const state = { localFileStore: null, sectionMarkdowns: [], coursebook: null };
    const controller = makeController(state);
    const coursebook = { parentPath: "coursebook.md", chapters: [] };
    state.coursebook = coursebook;
    await controller.loadForCoursebook(coursebook);

    controller.applyGlossaryText("## COUNT\nhttps://example.com\n\nCounts.");
    expect(matchDocCard("COUNT")?.id).toBe("book:count");

    controller.resetToPack();
    expect(matchDocCard("COUNT")).toBeNull();
    expect(matchDocCard("len")?.id).toBe("python:len");
  });
});

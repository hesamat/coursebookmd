import { describe, expect, it } from "vitest";
import { anchorsMatch } from "../present/popup-helpers.js";
import { captureAnchor, scrollTopForAnchor, syncBlocks } from "../present/scroll-sync.js";

function fakePane({ scrollTop = 0, scrollHeight = 1000, clientHeight = 500 } = {}) {
  return {
    scrollTop,
    scrollHeight,
    clientHeight,
    getBoundingClientRect: () => ({ top: 0 }),
  };
}

function fakeBlock(id, top, height) {
  return {
    dataset: { syncId: id },
    getBoundingClientRect: () => ({ top, height }),
  };
}

describe("anchorsMatch", () => {
  it("matches the same block and a close fraction", () => {
    expect(anchorsMatch({ id: "b2", fraction: 0.5 }, { id: "b2", fraction: 0.51 })).toBe(
      true,
    );
    expect(anchorsMatch({ id: "b2", fraction: 0.5 }, { id: "b2", fraction: 0.9 })).toBe(
      false,
    );
    expect(anchorsMatch({ id: "b2", fraction: 0.5 }, { id: "b3", fraction: 0.5 })).toBe(
      false,
    );
    expect(anchorsMatch(null, { id: "b1" })).toBe(false);
  });
});

describe("syncBlocks", () => {
  it("keeps only laid-out blocks", () => {
    const visible = { getClientRects: () => [{}] };
    const hidden = { getClientRects: () => [] };
    const root = { querySelectorAll: () => [visible, hidden] };
    expect(syncBlocks(root)).toEqual([visible]);
  });

  it("returns an empty list without a root", () => {
    expect(syncBlocks(null)).toEqual([]);
  });
});

describe("captureAnchor", () => {
  it("picks the block above the line and the fraction into it", () => {
    const pane = fakePane({ scrollTop: 50 });
    const blocks = [fakeBlock("b0", -50, 100), fakeBlock("b1", 50, 100)];
    expect(captureAnchor(pane, blocks)).toEqual({ id: "b0", fraction: 0.5 });
  });

  it("falls back to the first block at the very top", () => {
    const pane = fakePane({ scrollTop: 0 });
    const blocks = [fakeBlock("b0", 0, 100), fakeBlock("b1", 100, 100)];
    expect(captureAnchor(pane, blocks)).toEqual({ id: "b0", fraction: 0 });
  });

  it("returns null with no content", () => {
    expect(captureAnchor(fakePane(), [])).toBeNull();
  });
});

describe("scrollTopForAnchor", () => {
  it("resolves the pixel offset that puts the anchor at the line", () => {
    const pane = fakePane({ scrollTop: 0 });
    const blocks = [fakeBlock("b0", 0, 100), fakeBlock("b1", 100, 100)];
    expect(scrollTopForAnchor(pane, blocks, { id: "b1", fraction: 0.25 })).toBe(125);
  });

  it("clamps to the scrollable range and returns null for unknown blocks", () => {
    const pane = fakePane({ scrollTop: 0, scrollHeight: 520, clientHeight: 500 });
    const blocks = [fakeBlock("b0", 0, 1000)];
    expect(scrollTopForAnchor(pane, blocks, { id: "b0", fraction: 1 })).toBe(20);
    expect(scrollTopForAnchor(pane, blocks, { id: "nope", fraction: 0 })).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBlockFocus } from "../present/block-focus.js";

function buildDom(count = 4) {
  document.body.innerHTML = "";
  document.body.className = "";
  const content = document.createElement("div");
  content.id = "content";
  const chapter = document.createElement("section");
  chapter.className = "coursebook-section active";
  chapter.id = "chapter";
  const inner = document.createElement("section");
  chapter.appendChild(inner);
  const blocks = [];
  for (let i = 0; i < count; i++) {
    const p = document.createElement("p");
    p.dataset.syncId = `b${i}`;
    p.getBoundingClientRect = () => ({ top: i * 100, bottom: i * 100 + 80 });
    inner.appendChild(p);
    blocks.push(p);
  }
  content.appendChild(chapter);
  document.body.appendChild(content);
  return { content, chapter, inner, blocks };
}

function setup({ count = 4, top = 0 } = {}) {
  const dom = buildDom(count);
  const scrollTo = vi.fn();
  const onBoundary = vi.fn();
  const pane = { getBoundingClientRect: () => ({ top }) };
  const focus = createBlockFocus({
    pane,
    getRoot: () => dom.chapter,
    scrollTo,
    onBoundary,
  });
  focus.refresh();
  return { ...dom, focus, scrollTo, onBoundary };
}

const focused = (blocks) =>
  blocks.findIndex((b) => b.classList.contains("is-block-focused"));

describe("createBlockFocus", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.className = "";
  });

  it("activates on the first visible block and dims the rest", () => {
    const { focus, blocks } = setup();
    focus.next();
    expect(focus.isActive()).toBe(true);
    expect(focused(blocks)).toBe(0);
    expect(blocks[1].classList.contains("is-block-muted")).toBe(true);
    expect(document.body.classList.contains("block-focus")).toBe(true);
  });

  it("steps forward and back through the block list", () => {
    const { focus, blocks, scrollTo } = setup();
    focus.next();
    focus.next();
    expect(focused(blocks)).toBe(1);
    expect(scrollTo).toHaveBeenLastCalledWith(blocks[1]);

    focus.prev();
    expect(focused(blocks)).toBe(0);
  });

  it("starts on the block at the top of the viewport", () => {
    const { focus, blocks } = setup({ top: 250 });
    focus.next();
    expect(focused(blocks)).toBe(2);
  });

  it("asks the host to advance instead of walking past the last block", () => {
    const { focus, blocks, onBoundary } = setup();
    focus.focusIndex(blocks.length - 1);
    focus.next();
    expect(onBoundary).toHaveBeenCalledWith(1);
    expect(focused(blocks)).toBe(blocks.length - 1);
  });

  it("asks the host to retreat instead of walking past the first block", () => {
    const { focus, blocks, onBoundary } = setup();
    focus.focusIndex(0);
    focus.prev();
    expect(onBoundary).toHaveBeenCalledWith(-1);
    expect(focused(blocks)).toBe(0);
  });

  it("re-seeds the cursor after a host chapter switch", () => {
    const { focus, blocks, onBoundary } = setup();
    focus.focusIndex(blocks.length - 1);
    focus.next();
    expect(onBoundary).toHaveBeenCalledTimes(1);
    // The host collects the new chapter, then focuses its first block.
    focus.refresh();
    focus.focusIndex(0);
    expect(focused(blocks)).toBe(0);
  });

  it("hides blocks past the cursor while revealing", () => {
    const { focus, blocks } = setup();
    focus.focusIndex(1);
    focus.toggleReveal();
    expect(focus.isRevealed()).toBe(true);
    expect(document.body.classList.contains("block-reveal")).toBe(true);
    expect(blocks[2].classList.contains("is-block-reveal-hidden")).toBe(true);
    expect(blocks[0].classList.contains("is-block-reveal-hidden")).toBe(false);

    focus.toggleReveal();
    expect(blocks[2].classList.contains("is-block-reveal-hidden")).toBe(false);
  });

  it("lifts the focused block while zoomed and restores it", () => {
    const { focus, blocks } = setup();
    focus.focusIndex(1);
    focus.toggleZoom();
    expect(focus.isZoomed()).toBe(true);
    expect(blocks[1].classList.contains("is-block-zoomed")).toBe(true);
    expect(document.body.classList.contains("block-zoomed")).toBe(true);

    focus.toggleZoom();
    expect(blocks[1].classList.contains("is-block-zoomed")).toBe(false);
  });

  it("clears every class and body flag", () => {
    const { focus, blocks } = setup();
    focus.focusIndex(1);
    focus.toggleReveal();
    focus.toggleZoom();
    focus.clear();
    expect(focus.isActive()).toBe(false);
    expect(focus.isRevealed()).toBe(false);
    expect(focus.isZoomed()).toBe(false);
    expect(document.body.className).toBe("");
    expect(blocks.some((b) => b.classList.length > 0)).toBe(false);
  });

  it("clamps the cursor when the block list shrinks", () => {
    const { focus, inner, blocks } = setup();
    focus.focusIndex(3);
    inner.removeChild(blocks[3]);
    inner.removeChild(blocks[2]);
    focus.refresh();
    expect(focus.count()).toBe(2);
    expect(focused(blocks)).toBe(1);
  });
});

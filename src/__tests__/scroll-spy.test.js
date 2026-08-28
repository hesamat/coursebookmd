import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScrollSpy } from "../core/scroll-spy.js";

let rafQueue;
let rafId;

function flushRaf() {
  const queue = [...rafQueue.values()];
  rafQueue.clear();
  for (const cb of queue) cb();
}

function takeRaf() {
  const cb = [...rafQueue.values()][0];
  rafQueue.clear();
  return cb;
}

function makePane({ scrollHeight = 1000, clientHeight = 500 } = {}) {
  const pane = document.createElement("div");
  Object.defineProperty(pane, "scrollTop", {
    value: 0,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(pane, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(pane, "clientHeight", {
    value: clientHeight,
    configurable: true,
  });
  pane.getBoundingClientRect = () => ({
    top: 0,
    bottom: clientHeight,
    height: clientHeight,
  });
  pane.scrollTo = () => {};
  return pane;
}

function heading(top, { id, tag = "h2" } = {}) {
  const el = document.createElement(tag);
  if (id) el.id = id;
  el.getBoundingClientRect = () => ({ top, height: 40 });
  return el;
}

function tocEl(ids) {
  const el = document.createElement("nav");
  for (const id of ids) {
    const btn = document.createElement("button");
    btn.className = "toc-item";
    if (id) btn.setAttribute("data-target", id);
    el.appendChild(btn);
  }
  return el;
}

function activeIds(el) {
  return [...el.querySelectorAll(".toc-item.active")].map((i) =>
    i.getAttribute("data-target"),
  );
}

function makeNavigator(headings) {
  return {
    headings,
    currentIdx: 0,
    setCurrentCalls: [],
    syncVisualCalls: 0,
    setCurrent(idx) {
      this.currentIdx = idx;
      this.setCurrentCalls.push(idx);
    },
    syncVisual() {
      this.syncVisualCalls++;
    },
    get current() {
      return this.headings[this.currentIdx];
    },
  };
}

function makeSpy({
  pane = makePane(),
  toc = tocEl(["a", "b", "c"]),
  nav = null,
  options = {},
} = {}) {
  document.body.appendChild(pane);
  document.body.appendChild(toc);
  const spy = createScrollSpy({
    pane,
    resizeTarget: document.createElement("div"),
    getTocContainer: () => toc,
    getNavigator: () => nav,
    ...options,
  });
  return { spy, pane, toc, nav };
}

beforeEach(() => {
  rafQueue = new Map();
  rafId = 0;
  vi.stubGlobal("requestAnimationFrame", (cb) => {
    rafId += 1;
    rafQueue.set(rafId, cb);
    return rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id) => {
    rafQueue.delete(id);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createScrollSpy", () => {
  describe("heading selection", () => {
    it("picks the last heading above the activation line and syncs the navigator", () => {
      const h1 = heading(50, { id: "a", tag: "h1" });
      const h2 = heading(100, { id: "b" });
      const h3 = heading(500, { id: "c" });
      const nav = makeNavigator([h1, h2]);
      const { spy, toc } = makeSpy({ nav });
      document.body.append(h1, h2, h3);

      spy.setHeadings([h1, h2, h3]);
      spy.update({ lockNavigator: false });

      expect(activeIds(toc)).toEqual(["b"]);
      expect(nav.setCurrentCalls).toEqual([1]);
    });

    it("forces the last heading near the bottom of a scrollable pane", () => {
      const h1 = heading(50, { id: "a" });
      const h2 = heading(100, { id: "b" });
      const h3 = heading(500, { id: "c" });
      const { spy, pane, toc } = makeSpy();
      document.body.append(h1, h2, h3);

      spy.setHeadings([h1, h2, h3]);
      pane.scrollTop = 450;
      spy.update({ lockNavigator: false });

      expect(activeIds(toc)).toEqual(["c"]);
    });

    it("does not force the last heading before the user has scrolled", () => {
      const h1 = heading(50, { id: "a" });
      const h2 = heading(200, { id: "b" });
      const pane = makePane({ scrollHeight: 500, clientHeight: 450 });
      const { spy, toc } = makeSpy({ pane });
      document.body.append(h1, h2);

      spy.setHeadings([h1, h2]);

      expect(activeIds(toc)).toEqual(["a"]);
    });

    it("keeps the current TOC highlight when the cached heading list is empty", () => {
      const h1 = heading(50, { id: "a" });
      const h2 = heading(100, { id: "b" });
      const h3 = heading(500, { id: "c" });
      const { spy, toc } = makeSpy();
      document.body.append(h1, h2, h3);

      spy.setHeadings([h1, h2, h3]);
      expect(activeIds(toc)).toEqual(["b"]);

      spy.setHeadings([]);
      spy.update({ lockNavigator: false });

      expect(activeIds(toc)).toEqual(["b"]);
    });
  });

  describe("lockNavigator", () => {
    it("uses getDefaultLock for the default and lets explicit options override it", () => {
      const h1 = heading(50, { id: "a", tag: "h1" });
      const h2 = heading(100, { id: "b" });
      const h3 = heading(500, { id: "c" });
      const nav = makeNavigator([h1, h2]);
      const { spy, toc } = makeSpy({
        nav,
        options: { getDefaultLock: () => true },
      });
      document.body.append(h1, h2, h3);

      spy.setHeadings([h1, h2, h3]);
      spy.update();

      expect(activeIds(toc)).toEqual(["b"]);
      expect(nav.setCurrentCalls).toEqual([]);

      spy.update({ lockNavigator: false });

      expect(nav.setCurrentCalls).toEqual([1]);
    });

    it("defaults to unlocked when no getDefaultLock is given", () => {
      const h1 = heading(50, { id: "a", tag: "h1" });
      const h2 = heading(100, { id: "b" });
      const nav = makeNavigator([h1, h2]);
      const { spy } = makeSpy({ nav });
      document.body.append(h1, h2);

      spy.update({ lockNavigator: false });

      expect(nav.setCurrentCalls).toEqual([]);
    });
  });

  describe("tocMatch", () => {
    it("index mode highlights by position", () => {
      const h1 = heading(50, { id: "a" });
      const h2 = heading(500, { id: "b" });
      const { spy, toc } = makeSpy({ toc: tocEl(["a", "b", "c"]) });
      document.body.append(h1, h2);

      spy.setHeadings([h1, h2]);
      spy.setActive(h2);
      expect(activeIds(toc)).toEqual(["b"]);

      spy.setActive(null);
      expect(activeIds(toc)).toEqual([]);
    });

    it("dataTarget mode highlights by data-target attribute", () => {
      const h1 = heading(50, { id: "a" });
      const h2 = heading(500, { id: "b" });
      const other = heading(500, { id: "zzz" });
      const { spy, toc } = makeSpy({
        toc: tocEl(["a", "b", "c"]),
        options: { tocMatch: "dataTarget" },
      });
      document.body.append(h1, h2, other);

      spy.setActive(h2);
      expect(activeIds(toc)).toEqual(["b"]);

      spy.setActive(other);
      expect(activeIds(toc)).toEqual([]);

      spy.setActive(null);
      expect(activeIds(toc)).toEqual([]);
    });
  });

  describe("suppression generation guard", () => {
    it("a pending re-enable from a superseded scroll does not unlock the spy", () => {
      const h1 = heading(50, { id: "a" });
      const h2 = heading(500, { id: "b" });
      const { spy, toc } = makeSpy();
      document.body.append(h1, h2);

      spy.setHeadings([h1, h2]);
      expect(activeIds(toc)).toEqual(["a"]);

      spy.scrollToInstant(h2);
      const staleCb = takeRaf();
      spy.scrollToInstant(h1);
      const freshCb = takeRaf();
      staleCb();
      // If the stale re-enable ran, it would unlock the spy and sync at
      // scrollTop 420, where the bottom-forcing rule would highlight "b".
      expect(activeIds(toc)).toEqual(["a"]);

      // The spy is still suppressed: scheduled updates are dropped.
      spy.scheduleUpdate();
      flushRaf();
      expect(activeIds(toc)).toEqual(["a"]);

      freshCb();
      expect(activeIds(toc)).toEqual(["a"]);
    });

    it("the pending re-enable of the newest scroll unlocks the spy", () => {
      const h1 = heading(50, { id: "a" });
      const h2 = heading(500, { id: "b" });
      const { spy, pane, toc } = makeSpy();
      document.body.append(h1, h2);

      spy.setHeadings([h1, h2]);
      spy.scrollToInstant(h2);
      const cb = takeRaf();

      cb();
      pane.scrollTop = 420;
      spy.scheduleUpdate();
      flushRaf();

      expect(activeIds(toc)).toEqual(["b"]);
    });
  });

  describe("syncAfterScroll", () => {
    it("settles on the intended heading when the scroll landed on target", () => {
      const h1 = heading(50, { id: "a" });
      const h2 = heading(500, { id: "b" });
      const nav = makeNavigator([h1, h2]);
      const { spy, pane, toc } = makeSpy({ nav });
      document.body.append(h1, h2);

      spy.setHeadings([h1, h2]);
      pane.scrollTop = 100;
      spy.syncAfterScroll({ activeHeading: h2, expectedTop: 102, lockNavigator: true });

      expect(activeIds(toc)).toEqual(["b"]);
      expect(nav.setCurrentCalls).toEqual([]);
      expect(nav.syncVisualCalls).toBe(1);
    });

    it("falls back to a position-based update when off target", () => {
      const h1 = heading(50, { id: "a" });
      const h2 = heading(500, { id: "b" });
      const nav = makeNavigator([h1, h2]);
      const { spy, pane, toc } = makeSpy({ nav });
      document.body.append(h1, h2);

      spy.setHeadings([h1, h2]);
      pane.scrollTop = 200;
      spy.syncAfterScroll({ activeHeading: h2, expectedTop: 102, lockNavigator: true });

      expect(activeIds(toc)).toEqual(["a"]);
      expect(nav.setCurrentCalls).toEqual([]);
      expect(nav.syncVisualCalls).toBe(1);
    });

    it("falls back to a position-based update when the heading left the document", () => {
      const h1 = heading(50, { id: "a" });
      const h2 = heading(500, { id: "b" });
      const { spy, toc } = makeSpy();
      document.body.append(h1, h2);

      spy.setHeadings([h1, h2]);
      h2.remove();
      spy.syncAfterScroll({ activeHeading: h2, expectedTop: null, lockNavigator: true });

      expect(activeIds(toc)).toEqual(["a"]);
    });
  });

  describe("scheduling", () => {
    it("coalesces bursts of scheduled updates into one frame", () => {
      const { spy } = makeSpy();
      spy.scheduleUpdate();
      spy.scheduleUpdate();
      expect(rafQueue.size).toBe(1);
    });

    it("runs the update when the frame fires", () => {
      const h1 = heading(50, { id: "a" });
      const h2 = heading(500, { id: "b" });
      const { spy, pane, toc } = makeSpy();
      document.body.append(h1, h2);

      spy.setHeadings([h1, h2]);
      pane.scrollTop = 420;
      spy.scheduleUpdate();
      flushRaf();

      expect(activeIds(toc)).toEqual(["b"]);
    });

    it("cancelScheduledUpdate drops the pending update", () => {
      const { spy, toc } = makeSpy();
      spy.scheduleUpdate();
      spy.cancelScheduledUpdate();
      flushRaf();

      expect(rafQueue.size).toBe(0);
      expect(activeIds(toc)).toEqual([]);
    });
  });

  describe("attach and destroy", () => {
    it("attach listens for pane scroll events", () => {
      const h1 = heading(50, { id: "a" });
      const h2 = heading(500, { id: "b" });
      const { spy, pane, toc } = makeSpy();
      document.body.append(h1, h2);

      spy.setHeadings([h1, h2]);
      spy.attach();
      pane.scrollTop = 420;
      pane.dispatchEvent(new window.Event("scroll"));
      flushRaf();

      expect(activeIds(toc)).toEqual(["b"]);
    });

    it("destroy removes the scroll listener and the observer", () => {
      const { spy, pane } = makeSpy();
      spy.attach();
      spy.destroy();

      pane.dispatchEvent(new window.Event("scroll"));

      expect(rafQueue.size).toBe(0);
    });

    it("disconnectObserver and reobserve control the ResizeObserver", () => {
      const target = document.createElement("div");
      const calls = [];
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe(t) {
            calls.push(["observe", t]);
          }
          disconnect() {
            calls.push(["disconnect"]);
          }
        },
      );
      const { spy } = makeSpy({ options: { resizeTarget: target } });

      spy.attach();
      spy.disconnectObserver();
      spy.reobserve();

      expect(calls).toEqual([["observe", target], ["disconnect"], ["observe", target]]);
    });
  });

  describe("suppressUntilDone", () => {
    it("keeps the spy suppressed until the no-start timeout settles the scroll", () => {
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
      });
      const h1 = heading(50, { id: "a" });
      const h2 = heading(500, { id: "b" });
      const { spy, toc } = makeSpy();
      document.body.append(h1, h2);

      spy.setHeadings([h1, h2]);
      spy.suppressUntilDone({
        activeHeading: h2,
        lockNavigator: true,
        syncVisual: false,
      });

      spy.scheduleUpdate();
      flushRaf();
      expect(activeIds(toc)).toEqual(["a"]);

      vi.advanceTimersByTime(260);

      expect(activeIds(toc)).toEqual(["b"]);
    });

    it("withNavigatorScroll settles on the navigator's current heading", () => {
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
      });
      const h1 = heading(50, { id: "a", tag: "h1" });
      const h2 = heading(500, { id: "b" });
      const nav = makeNavigator([h1, h2]);
      const { spy, toc } = makeSpy({ nav });
      document.body.append(h1, h2);

      spy.setHeadings([h1, h2]);
      spy.withNavigatorScroll(() => nav.setCurrent(1), true);
      vi.advanceTimersByTime(260);

      expect(activeIds(toc)).toEqual(["b"]);
      expect(nav.syncVisualCalls).toBe(1);
    });

    it("withNavigatorScroll does nothing when the action does not move", () => {
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
      });
      const h1 = heading(50, { id: "a" });
      const h2 = heading(500, { id: "b" });
      const nav = makeNavigator([h1, h2]);
      const { spy, toc } = makeSpy({ nav });
      document.body.append(h1, h2);

      spy.setHeadings([h1, h2]);
      spy.withNavigatorScroll(() => {}, true);
      vi.advanceTimersByTime(400);

      expect(activeIds(toc)).toEqual(["a"]);
      expect(nav.syncVisualCalls).toBe(0);
    });
  });

  describe("scrollToSmooth", () => {
    it("scrolls to the clamped target and settles on the element", () => {
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
      });
      const h1 = heading(50, { id: "a" });
      const h2 = heading(500, { id: "b" });
      const pane = makePane();
      pane.scrollTo = vi.fn(({ top }) => {
        pane.scrollTop = top;
      });
      const { spy, toc } = makeSpy({ pane });
      document.body.append(h1, h2);

      spy.setHeadings([h1, h2]);
      spy.scrollToSmooth(h2);

      expect(pane.scrollTo).toHaveBeenCalledWith({ top: 420, behavior: "smooth" });
      vi.advanceTimersByTime(400);

      expect(activeIds(toc)).toEqual(["b"]);
    });

    it("jumps instantly beyond the long-scroll distance", () => {
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
      });
      const h1 = heading(50, { id: "a" });
      const h2 = heading(4000, { id: "b" });
      const pane = makePane({ scrollHeight: 5000 });
      pane.scrollTo = vi.fn(({ top }) => {
        pane.scrollTop = top;
      });
      const { spy } = makeSpy({ pane });
      document.body.append(h1, h2);

      spy.setHeadings([h1, h2]);
      spy.scrollToSmooth(h2);

      expect(pane.scrollTo).toHaveBeenCalledWith({ top: 3920, behavior: "auto" });
      vi.advanceTimersByTime(400);
    });
  });

  describe("rederive mode", () => {
    it("re-derives headings on every update and clears highlights for an empty section", () => {
      const h1 = heading(50, { id: "a" });
      const h2 = heading(500, { id: "b" });
      let derived = [h1, h2];
      const { spy, toc } = makeSpy({
        options: { rederive: () => derived },
      });
      document.body.append(h1, h2);

      spy.update({ lockNavigator: false });
      expect(activeIds(toc)).toEqual(["a"]);

      derived = [];
      spy.update({ lockNavigator: false });
      expect(activeIds(toc)).toEqual([]);
    });

    it("skips the pass when rederive returns null", () => {
      const h1 = heading(50, { id: "a" });
      const h2 = heading(500, { id: "b" });
      let derived = [h1, h2];
      const { spy, toc } = makeSpy({
        options: { rederive: () => derived },
      });
      document.body.append(h1, h2);

      spy.update({ lockNavigator: false });
      expect(activeIds(toc)).toEqual(["a"]);

      derived = null;
      spy.update({ lockNavigator: false });
      expect(activeIds(toc)).toEqual(["a"]);
    });
  });
});

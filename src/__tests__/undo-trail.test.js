import { describe, expect, it } from "vitest";
import { createUndoTrail } from "../core/undo-trail.js";

describe("createUndoTrail", () => {
  it("starts empty with position -1", () => {
    const trail = createUndoTrail();
    expect(trail.entries()).toEqual([]);
    expect(trail.position()).toBe(-1);
    expect(trail.stepBack()).toBeNull();
    expect(trail.stepForward()).toBeNull();
  });

  it("records edits and steps back through them", () => {
    const trail = createUndoTrail();
    trail.noteEdit("1");
    trail.noteEdit("2");
    expect(trail.entries()).toEqual(["1", "2"]);
    expect(trail.position()).toBe(1);
    expect(trail.stepBack()).toBe("1");
    expect(trail.position()).toBe(0);
    expect(trail.stepBack()).toBeNull();
    expect(trail.position()).toBe(0);
  });

  it("steps forward through entries and stops at the end", () => {
    const trail = createUndoTrail();
    trail.noteEdit("1");
    trail.noteEdit("2");
    trail.stepBack();
    expect(trail.stepForward()).toBe("2");
    expect(trail.stepForward()).toBeNull();
    expect(trail.position()).toBe(1);
  });

  it("collapses repeated edits in the same chapter into one entry", () => {
    const trail = createUndoTrail();
    trail.noteEdit("1");
    trail.noteEdit("1");
    trail.noteEdit("1");
    expect(trail.entries()).toEqual(["1"]);
    expect(trail.position()).toBe(0);
  });

  it("re-noting the current key after stepping back is a no-op", () => {
    const trail = createUndoTrail();
    trail.noteEdit("1");
    trail.noteEdit("2");
    trail.stepBack();
    trail.noteEdit("1");
    expect(trail.entries()).toEqual(["1", "2"]);
    expect(trail.position()).toBe(0);
  });

  it("discards forward entries when a different chapter is edited", () => {
    const trail = createUndoTrail();
    trail.noteEdit("1");
    trail.noteEdit("2");
    trail.noteEdit("3");
    trail.stepBack();
    trail.stepBack();
    trail.noteEdit("9");
    expect(trail.entries()).toEqual(["1", "9"]);
    expect(trail.position()).toBe(1);
    expect(trail.stepForward()).toBeNull();
  });

  it("caps history at the limit, dropping the oldest entry", () => {
    const trail = createUndoTrail({ limit: 3 });
    trail.noteEdit("a");
    trail.noteEdit("b");
    trail.noteEdit("c");
    trail.noteEdit("d");
    expect(trail.entries()).toEqual(["b", "c", "d"]);
    expect(trail.position()).toBe(2);
    expect(trail.stepBack()).toBe("c");
    expect(trail.stepBack()).toBe("b");
    expect(trail.stepBack()).toBeNull();
  });

  it("caps history at the default limit of 50", () => {
    const trail = createUndoTrail();
    for (let i = 0; i < 60; i++) trail.noteEdit(String(i));
    expect(trail.entries().length).toBe(50);
    expect(trail.entries()[0]).toBe("10");
    expect(trail.entries()[49]).toBe("59");
  });

  it("reset clears entries and position", () => {
    const trail = createUndoTrail();
    trail.noteEdit("1");
    trail.noteEdit("2");
    trail.stepBack();
    trail.reset();
    expect(trail.entries()).toEqual([]);
    expect(trail.position()).toBe(-1);
    expect(trail.stepBack()).toBeNull();
    expect(trail.stepForward()).toBeNull();
  });
});

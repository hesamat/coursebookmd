import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadCollapsedGroups,
  saveCollapsedGroup,
  isGroupCollapsed,
} from "../core/nav-groups.js";

describe("nav-groups", () => {
  let store;

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key) => store[key] ?? null,
      setItem: (key, val) => {
        store[key] = val;
      },
      removeItem: (key) => {
        delete store[key];
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loadCollapsedGroups", () => {
    it("returns an empty set when nothing is stored", () => {
      const result = loadCollapsedGroups();
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it("returns stored group titles", () => {
      store["coursebookmd_nav_collapsed_groups"] = JSON.stringify(["Week 1", "Week 3"]);
      const result = loadCollapsedGroups();
      expect([...result]).toEqual(["Week 1", "Week 3"]);
    });

    it("returns an empty set when stored value is not an array", () => {
      store["coursebookmd_nav_collapsed_groups"] = JSON.stringify({ foo: 1 });
      const result = loadCollapsedGroups();
      expect(result.size).toBe(0);
    });

    it("returns an empty set when JSON is invalid", () => {
      store["coursebookmd_nav_collapsed_groups"] = "not valid json{";
      const result = loadCollapsedGroups();
      expect(result.size).toBe(0);
    });
  });

  describe("saveCollapsedGroup", () => {
    it("adds a group to the collapsed set", () => {
      saveCollapsedGroup("Week 1", true);
      const raw = store["coursebookmd_nav_collapsed_groups"];
      expect(JSON.parse(raw)).toEqual(["Week 1"]);
    });

    it("removes a group from the collapsed set", () => {
      store["coursebookmd_nav_collapsed_groups"] = JSON.stringify(["Week 1", "Week 2"]);
      saveCollapsedGroup("Week 1", false);
      expect(JSON.parse(store["coursebookmd_nav_collapsed_groups"])).toEqual(["Week 2"]);
    });

    it("preserves other groups when adding one", () => {
      store["coursebookmd_nav_collapsed_groups"] = JSON.stringify(["Week 1"]);
      saveCollapsedGroup("Week 2", true);
      const result = JSON.parse(store["coursebookmd_nav_collapsed_groups"]);
      expect(result).toContain("Week 1");
      expect(result).toContain("Week 2");
    });

    it("does nothing when removing a group that is not collapsed", () => {
      store["coursebookmd_nav_collapsed_groups"] = JSON.stringify(["Week 1"]);
      saveCollapsedGroup("Week 99", false);
      expect(JSON.parse(store["coursebookmd_nav_collapsed_groups"])).toEqual(["Week 1"]);
    });

    it("handles empty string titles", () => {
      saveCollapsedGroup("", true);
      expect(JSON.parse(store["coursebookmd_nav_collapsed_groups"])).toEqual([""]);
    });
  });

  describe("isGroupCollapsed", () => {
    it("returns true for a collapsed group", () => {
      const collapsed = new Set(["Week 1", "Week 2"]);
      expect(isGroupCollapsed(collapsed, "Week 1")).toBe(true);
    });

    it("returns false for an expanded group", () => {
      const collapsed = new Set(["Week 1"]);
      expect(isGroupCollapsed(collapsed, "Week 2")).toBe(false);
    });

    it("returns false for an empty set", () => {
      const collapsed = new Set();
      expect(isGroupCollapsed(collapsed, "Week 1")).toBe(false);
    });
  });
});

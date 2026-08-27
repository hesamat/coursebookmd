import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadCollapsedGroups,
  saveCollapsedGroup,
  isGroupCollapsed,
  createGroupElement,
  autoExpandGroup,
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

  describe("createGroupElement", () => {
    it("creates a .nav-group container with a label button", () => {
      const group = createGroupElement("Week 1", new Set());
      expect(group.className).toBe("nav-group");
      const label = group.querySelector(".nav-group-label");
      expect(label).not.toBeNull();
      expect(label.tagName).toBe("BUTTON");
    });

    it("sets the label text", () => {
      const group = createGroupElement("Week 1", new Set());
      const text = group.querySelector(".nav-group-label__text");
      expect(text.textContent).toBe("Week 1");
    });

    it("is expanded by default", () => {
      const group = createGroupElement("Week 1", new Set());
      expect(group.classList.contains("is-collapsed")).toBe(false);
      const label = group.querySelector(".nav-group-label");
      expect(label.getAttribute("aria-expanded")).toBe("true");
    });

    it("is collapsed when title is in the collapsed set", () => {
      const group = createGroupElement("Week 1", new Set(["Week 1"]));
      expect(group.classList.contains("is-collapsed")).toBe(true);
      const label = group.querySelector(".nav-group-label");
      expect(label.getAttribute("aria-expanded")).toBe("false");
    });

    it("toggles collapsed state on click and persists it", () => {
      const group = createGroupElement("Week 1", new Set());
      const label = group.querySelector(".nav-group-label");
      label.click();
      expect(group.classList.contains("is-collapsed")).toBe(true);
      expect(label.getAttribute("aria-expanded")).toBe("false");
      const raw = store["coursebookmd_nav_collapsed_groups"];
      expect(JSON.parse(raw)).toEqual(["Week 1"]);
    });

    it("toggles back to expanded on second click", () => {
      const group = createGroupElement("Week 1", new Set(["Week 1"]));
      const label = group.querySelector(".nav-group-label");
      label.click();
      expect(group.classList.contains("is-collapsed")).toBe(false);
      expect(label.getAttribute("aria-expanded")).toBe("true");
    });

    it("includes a chevron SVG", () => {
      const group = createGroupElement("Week 1", new Set());
      const chevron = group.querySelector(".nav-group-chevron");
      expect(chevron).not.toBeNull();
      expect(chevron.tagName).toBe("svg");
    });
  });

  describe("autoExpandGroup", () => {
    it("expands a collapsed group", () => {
      const group = createGroupElement("Week 1", new Set(["Week 1"]));
      const wrapper = document.createElement("div");
      group.appendChild(wrapper);
      autoExpandGroup(wrapper);
      expect(group.classList.contains("is-collapsed")).toBe(false);
      const label = group.querySelector(".nav-group-label");
      expect(label.getAttribute("aria-expanded")).toBe("true");
    });

    it("does not persist the expanded state", () => {
      const group = createGroupElement("Week 1", new Set(["Week 1"]));
      const wrapper = document.createElement("div");
      group.appendChild(wrapper);
      autoExpandGroup(wrapper);
      expect(store["coursebookmd_nav_collapsed_groups"]).toBeUndefined();
    });

    it("does nothing if the group is already expanded", () => {
      const group = createGroupElement("Week 1", new Set());
      const wrapper = document.createElement("div");
      group.appendChild(wrapper);
      autoExpandGroup(wrapper);
      expect(group.classList.contains("is-collapsed")).toBe(false);
    });

    it("does nothing if the element is not in a group", () => {
      const wrapper = document.createElement("div");
      expect(() => autoExpandGroup(wrapper)).not.toThrow();
    });

    it("does nothing for null/undefined input", () => {
      expect(() => autoExpandGroup(null)).not.toThrow();
      expect(() => autoExpandGroup(undefined)).not.toThrow();
    });
  });
});

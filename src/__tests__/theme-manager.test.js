import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThemeManager, PALETTES, PALETTE_LABELS } from "../core/theme-manager.js";

describe("theme-manager", () => {
  describe("constants", () => {
    it("exports the three palettes", () => {
      expect(PALETTES).toEqual(["warm-graphite", "indigo", "blue-slate"]);
    });

    it("exports labels for all palettes", () => {
      for (const palette of PALETTES) {
        expect(PALETTE_LABELS[palette]).toBeTruthy();
      }
    });
  });

  describe("getPalette", () => {
    beforeEach(() => {
      const store = {};
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

    it("returns the stored palette when valid", () => {
      localStorage.setItem("coursebookmd_palette", "indigo");
      expect(ThemeManager.getPalette()).toBe("indigo");
    });

    it("returns the default palette when nothing is stored", () => {
      expect(ThemeManager.getPalette()).toBe("warm-graphite");
    });

    it("returns the default palette when stored value is invalid", () => {
      localStorage.setItem("coursebookmd_palette", "nonexistent");
      expect(ThemeManager.getPalette()).toBe("warm-graphite");
    });
  });

  describe("setPalette", () => {
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
      vi.spyOn(ThemeManager, "applyPalette");
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("persists a valid palette and applies it", () => {
      ThemeManager.setPalette("indigo");
      expect(store["coursebookmd_palette"]).toBe("indigo");
      expect(ThemeManager.applyPalette).toHaveBeenCalledWith("indigo");
    });

    it("ignores an invalid palette", () => {
      ThemeManager.setPalette("nonexistent");
      expect(store["coursebookmd_palette"]).toBeUndefined();
      expect(ThemeManager.applyPalette).not.toHaveBeenCalled();
    });
  });

  describe("applyPalette", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("sets data-palette attribute on document element", () => {
      ThemeManager.applyPalette("indigo");
      expect(document.documentElement.getAttribute("data-palette")).toBe("indigo");
    });
  });

  describe("getCurrentTheme", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns the current data-theme attribute", () => {
      document.documentElement.setAttribute("data-theme", "dark");
      expect(ThemeManager.getCurrentTheme()).toBe("dark");
    });

    it("defaults to light when no theme is set", () => {
      document.documentElement.removeAttribute("data-theme");
      expect(ThemeManager.getCurrentTheme()).toBe("light");
    });
  });

  describe("toggleTheme", () => {
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

    it("toggles from light to dark", () => {
      document.documentElement.setAttribute("data-theme", "light");
      ThemeManager.toggleTheme();
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(store["coursebookmd_theme"]).toBe("dark");
    });

    it("toggles from dark to light", () => {
      document.documentElement.setAttribute("data-theme", "dark");
      ThemeManager.toggleTheme();
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      expect(store["coursebookmd_theme"]).toBe("light");
    });
  });

  describe("initTheme", () => {
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

    it("applies stored theme when valid", () => {
      store["coursebookmd_theme"] = "dark";
      ThemeManager.initTheme();
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    it("falls back to system preference when no stored theme", () => {
      vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
      ThemeManager.initTheme();
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    it("falls back to light when system prefers light", () => {
      vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
      ThemeManager.initTheme();
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });
  });
});

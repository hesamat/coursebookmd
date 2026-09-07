/**
 * ThemeManager
 * Manages theme state (light/dark mode) and color palette selection,
 * localStorage persistence, and system preference detection.
 */

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage errors (e.g. disabled localStorage in exports)
  }
}

/** @typedef {"warm-graphite" | "indigo" | "blue-slate"} Palette */

/** @type {Palette[]} */
export const PALETTES = ["warm-graphite", "indigo", "blue-slate"];

export const PALETTE_LABELS = {
  "warm-graphite": "Warm Graphite",
  indigo: "Cool Indigo",
  "blue-slate": "Blue Slate",
};

const DEFAULT_PALETTE = "warm-graphite";

export class ThemeManager {
  static THEME_KEY = "coursebookmd_theme";
  static PALETTE_KEY = "coursebookmd_palette";

  /**
   * When false, toggleTheme applies without persisting to localStorage.
   * The standalone export uses this: file:// origins share one localStorage
   * across every local file, so persisting would leak one book's toggle into
   * the next book the viewer opens.
   */
  static persistenceEnabled = true;

  /** When set, getPalette() returns this instead of the persisted palette. */
  static lockedPalette = null;

  static setPersistenceEnabled(enabled) {
    ThemeManager.persistenceEnabled = enabled;
  }

  /**
   * Pin the palette for this session. Exported books bake one palette; a
   * viewer's own stored palette must not override it on toggle.
   * @param {Palette} palette
   */
  static lockPalette(palette) {
    if (PALETTES.includes(palette)) {
      ThemeManager.lockedPalette = palette;
    }
  }

  /**
   * Initializes the theme on application startup.
   * Checks localStorage first, then falls back to system preference.
   */
  static initTheme() {
    const stored = safeGet(ThemeManager.THEME_KEY);
    if (stored === "light" || stored === "dark") {
      ThemeManager.applyTheme(stored);
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      ThemeManager.applyTheme(prefersDark ? "dark" : "light");
    }
  }

  /**
   * Applies the specified theme to the document.
   * @param {"light"|"dark"} theme
   */
  static applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    ThemeManager.applyPalette(ThemeManager.getPalette());
  }

  /**
   * Applies a palette by setting data-palette on the document element.
   * @param {Palette} palette
   */
  static applyPalette(palette) {
    document.documentElement.setAttribute("data-palette", palette);
  }

  /**
   * Gets the persisted palette (or the default).
   * @returns {Palette}
   */
  static getPalette() {
    if (ThemeManager.lockedPalette) {
      return ThemeManager.lockedPalette;
    }
    const stored = safeGet(ThemeManager.PALETTE_KEY);
    if (PALETTES.includes(/** @type {Palette} */ (stored))) {
      return /** @type {Palette} */ (stored);
    }
    return DEFAULT_PALETTE;
  }

  /**
   * Persists and applies a palette.
   * @param {Palette} palette
   */
  static setPalette(palette) {
    if (!PALETTES.includes(palette)) return;
    safeSet(ThemeManager.PALETTE_KEY, palette);
    ThemeManager.applyPalette(palette);
  }

  /**
   * Toggles between light and dark themes.
   */
  static toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const newTheme = current === "dark" ? "light" : "dark";
    if (ThemeManager.persistenceEnabled) {
      safeSet(ThemeManager.THEME_KEY, newTheme);
    }
    ThemeManager.applyTheme(newTheme);
  }

  /**
   * Gets the current active theme.
   * @returns {"light"|"dark"}
   */
  static getCurrentTheme() {
    return document.documentElement.getAttribute("data-theme") || "light";
  }
}

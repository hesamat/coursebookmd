/**
 * window-placement.js — Pure helpers for deciding where the presentation
 * window opens. Data transforms only; imported by
 * present-window-controller.js and unit tests.
 */

/** localStorage key the popup stores its window bounds under. */
export const BOUNDS_STORAGE_KEY = "cbmd-present-window-bounds";

/** Features for window.open() when nothing is known about displays. */
export const DEFAULT_POPUP_FEATURES = "popup=yes,left=60,top=60,width=1280,height=720";

/**
 * Pick the screen the presentation window should open on: prefer an
 * external (non-built-in) display that is not the current one, then any
 * non-current display, then the current display. Returns null only when
 * the API returned nothing usable.
 * @param {{ screens?: Screen[], currentScreen?: Screen } | null} details
 *   A WindowDetails from getScreenDetails() (or a test double).
 */
export function pickTargetScreen(details) {
  const screens = Array.from(details?.screens ?? []);
  const current = details?.currentScreen ?? null;
  const others = screens.filter((screen) => screen !== current);
  return others.find((screen) => screen.isInternal === false) ?? others[0] ?? current;
}

/**
 * Map a ScreenDetailed (or test double) to the bounds window.open() needs.
 * Returns null when the screen is missing the numeric fields, so callers fall
 * back to remembered bounds or the default features.
 * @param {{ availLeft: number, availTop: number, availWidth: number, availHeight: number } | null | undefined} screen
 */
export function boundsFromScreen(screen) {
  if (!screen) return null;
  const { availLeft, availTop, availWidth, availHeight } = screen;
  if (![availLeft, availTop, availWidth, availHeight].every(Number.isFinite)) {
    return null;
  }
  return { left: availLeft, top: availTop, width: availWidth, height: availHeight };
}

/**
 * Parse and validate window bounds stored by the popup. Returns null
 * unless the value is a usable { left, top, width, height }.
 * @param {string | null} raw
 */
export function parseStoredBounds(raw) {
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const { left, top, width, height } = data;
  const values = [left, top, width, height];
  if (values.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    return null;
  }
  if (width < 300 || height < 200) return null;
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * window.open features for remembered bounds, or a sane default for a
 * first-ever open (the user drags it once; the popup then remembers).
 * @param {{ left: number, top: number, width: number, height: number } | null} bounds
 */
export function featuresFromBounds(bounds) {
  if (!bounds) return DEFAULT_POPUP_FEATURES;
  const { left, top, width, height } = bounds;
  return `popup=yes,left=${left},top=${top},width=${width},height=${height}`;
}

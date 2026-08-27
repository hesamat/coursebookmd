/**
 * Collapsible nav group state management.
 *
 * Persists which group labels are collapsed in the sidebar across page
 * reloads via localStorage. Group labels are identified by their title
 * text (e.g. "Week 1", "Basics").
 */

const COLLAPSED_GROUPS_KEY = "coursebookmd_nav_collapsed_groups";

/**
 * Load the set of collapsed group titles from localStorage.
 * @returns {Set<string>} Titles of groups that should be collapsed.
 */
export function loadCollapsedGroups() {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * Persist the collapsed/expanded state of a single group.
 * @param {string} title - The group label title.
 * @param {boolean} isCollapsed - Whether the group is now collapsed.
 */
export function saveCollapsedGroup(title, isCollapsed) {
  const groups = loadCollapsedGroups();
  if (isCollapsed) {
    groups.add(title);
  } else {
    groups.delete(title);
  }
  try {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...groups]));
  } catch {
    // ignore quota / privacy mode errors
  }
}

/**
 * Check whether a group title is currently collapsed.
 * @param {Set<string>} collapsed - The collapsed set from loadCollapsedGroups().
 * @param {string} title - The group label title.
 * @returns {boolean}
 */
export function isGroupCollapsed(collapsed, title) {
  return collapsed.has(title);
}

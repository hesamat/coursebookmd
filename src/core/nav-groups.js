/**
 * Collapsible nav group state management and DOM construction.
 *
 * Persists which group labels are collapsed in the sidebar across page
 * reloads via localStorage. Group labels are identified by their title
 * text (e.g. "Week 1", "Basics").
 */

import { icon } from "./icon.js";

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

/**
 * Create a collapsible group container with its label button and chevron.
 * @param {string} title - The group label title.
 * @param {Set<string>} collapsedGroups - Current collapsed set from loadCollapsedGroups().
 * @returns {HTMLDivElement} The `.nav-group` container; chapters should be appended to it.
 */
export function createGroupElement(title, collapsedGroups) {
  const group = document.createElement("div");
  group.className = "nav-group";
  const isCollapsed = isGroupCollapsed(collapsedGroups, title);
  group.classList.toggle("is-collapsed", isCollapsed);

  const label = document.createElement("button");
  label.type = "button";
  label.className = "nav-group-label";
  label.setAttribute("aria-expanded", String(!isCollapsed));

  const chevron = icon("chevron-down", {
    size: "sm",
    class: isCollapsed
      ? "nav-group-chevron"
      : "nav-group-chevron nav-group-chevron--open",
  });
  if (chevron) label.appendChild(chevron);

  const labelText = document.createElement("span");
  labelText.className = "nav-group-label__text";
  labelText.textContent = title;
  label.appendChild(labelText);

  label.addEventListener("click", () => {
    const collapsed = group.classList.toggle("is-collapsed");
    label.setAttribute("aria-expanded", String(!collapsed));
    const chevronEl = label.querySelector(".nav-group-chevron");
    if (chevronEl) chevronEl.classList.toggle("nav-group-chevron--open", !collapsed);
    saveCollapsedGroup(title, collapsed);
  });
  group.appendChild(label);

  return group;
}

/**
 * Auto-expand the group containing an element so it stays visible.
 * @param {Element} element - An element inside a `.nav-group` (e.g. a chapter wrapper).
 */
export function autoExpandGroup(element) {
  const group = element?.closest(".nav-group");
  if (!group || !group.classList.contains("is-collapsed")) return;

  group.classList.remove("is-collapsed");
  const label = group.querySelector(".nav-group-label");
  if (label) label.setAttribute("aria-expanded", "true");
  const chevron = label?.querySelector(".nav-group-chevron");
  if (chevron) chevron.classList.add("nav-group-chevron--open");
}

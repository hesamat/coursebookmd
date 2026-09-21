/**
 * mobile-nav.js — below the breakpoint the navigation pane becomes an
 * overlay drawer. This is the live app's port of the export's mobile drawer
 * (mobileSidebarScript in coursebook-exporter.js + the viewer runtime's
 * toggle): same `sidebar-closed` body class as the one source of truth,
 * same dismissal rules. The export keeps its own emitted copy because its
 * drawer behavior must travel inside the standalone document, but the two
 * implementations are deliberately kept behavior-identical.
 *
 * Hosts differ only in configuration: the app's toggle lives inside the pane
 * (closed = the desktop peek, so the toggle stays reachable), the export's
 * lives in its header (closed = fully slid away behind it).
 */

/** The mobile drawer breakpoint, shared with the CSS media queries. */
export const MOBILE_NAV_QUERY = "(max-width: 768px)";

/**
 * Wire the drawer behaviors to the host's DOM.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.pane - The sliding navigation pane.
 * @param {HTMLElement} [opts.toggle] - The button that opens/closes it.
 * @param {HTMLElement} [opts.list] - Container of .chapter-item/.toc-item
 *   picks; picks dismiss the drawer and take focus.
 * @param {HTMLElement} [opts.content] - Reading surface that receives focus
 *   when a pick has no matching heading.
 * @param {Array<HTMLElement>} [opts.background] - Elements made inert while
 *   the drawer covers the page.
 * @param {object} [opts.labels] - Toggle labels: { open, closed }.
 * @returns {{ isOpen: () => boolean, setOpen: (open: boolean) => void,
 *   destroy: () => void } | null} Null when the pane is missing.
 */
export function setupMobileNavDrawer({
  pane,
  toggle,
  list,
  content,
  background = [],
  labels = { open: "Hide navigation", closed: "Show navigation" },
} = {}) {
  if (!pane || !pane.isConnected) return null;
  // matchMedia is missing under jsdom; without it the drawer simply starts
  // in whatever state the markup has and nothing wires up.
  const query =
    typeof window.matchMedia === "function" ? window.matchMedia(MOBILE_NAV_QUERY) : null;
  const atMobile = () => query?.matches ?? false;
  const inerted = [];

  function isOpen() {
    return !document.body.classList.contains("sidebar-closed");
  }

  function setOpen(open) {
    document.body.classList.toggle("sidebar-closed", !open);
    if (toggle) {
      // Describe the next action, not the current state, or a screen reader
      // hears "Hide navigation" while the drawer is already closed.
      const label = open ? labels.open : labels.closed;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", label);
      toggle.setAttribute("title", label);
    }
    syncInert(open);
  }

  /** While the drawer covers the page, its background must be unreachable
      by keyboard too — the scrim only blocks the pointer. Elements another
      feature made inert are left alone, and every value this sets is put
      back when the drawer closes or the viewport leaves the breakpoint. */
  function syncInert(open) {
    if (!atMobile() || !open || !("inert" in document.body)) {
      for (const [el, previous] of inerted) el.inert = previous;
      inerted.length = 0;
      return;
    }
    for (const el of background) {
      if (!el || el.inert) continue;
      inerted.push([el, el.inert]);
      el.inert = true;
    }
  }

  const onToggleClick = () => setOpen(!isOpen());

  const onQueryChange = (event) => setOpen(!event.matches);

  // Escape closes the drawer before the host's own Escape handling (exit
  // presentation, close the shortcuts sheet) can react: the open drawer is
  // topmost, so the key belongs to it.
  const onKeydown = (event) => {
    if (event.key !== "Escape" || !atMobile() || !isOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    toggle?.focus();
  };

  // A tap outside the drawer dismisses it; the scrim is the usual target.
  const onDocumentClick = (event) => {
    if (!atMobile() || !isOpen()) return;
    if (pane.contains(event.target)) return;
    // A toggle outside the pane (the export's header button) keeps working
    // as the close control instead of closing-and-reopening.
    if (toggle && !pane.contains(toggle) && toggle.contains(event.target)) return;
    setOpen(false);
    toggle?.focus();
  };

  // Picking a chapter or section navigates underneath the drawer, so close
  // it and move focus to what was picked — closing would otherwise drop
  // focus on <body> as the picked row leaves the accessibility tree.
  const onListClick = (event) => {
    if (!atMobile() || !isOpen()) return;
    const item = event.target.closest?.(".chapter-item, .toc-item");
    if (!item) return;
    setOpen(false);
    const targetId = item.getAttribute("data-target");
    const destination =
      (targetId && document.getElementById(targetId)) || content || pane;
    if (!destination.hasAttribute("tabindex")) {
      destination.setAttribute("tabindex", "-1");
    }
    try {
      destination.focus({ preventScroll: true });
    } catch {
      destination.focus();
    }
  };

  // A presentation takes over the whole page and must not sit under the
  // drawer's scrim (the same rule media-zoom follows): close when the body
  // enters presenting. Only a false→true transition may close — bodies that
  // present permanently change their classes while the drawer is open.
  let wasPresenting = document.body.classList.contains("presenting");
  const Observer = window.MutationObserver;
  const presentingObserver =
    typeof Observer === "function"
      ? new Observer(() => {
          const presenting = document.body.classList.contains("presenting");
          if (presenting && !wasPresenting && isOpen()) setOpen(false);
          wasPresenting = presenting;
        })
      : null;
  presentingObserver?.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });

  toggle?.addEventListener("click", onToggleClick);
  query?.addEventListener("change", onQueryChange);
  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("click", onDocumentClick);
  list?.addEventListener("click", onListClick);

  // Phones start with the drawer shut; hosts that care about the first-paint
  // flash set the class in a pre-paint script and this re-syncs the ARIA
  // state. Crossing the breakpoint restores the desktop default.
  if (atMobile()) setOpen(false);

  return {
    isOpen,
    setOpen,
    destroy() {
      toggle?.removeEventListener("click", onToggleClick);
      query?.removeEventListener("change", onQueryChange);
      document.removeEventListener("keydown", onKeydown, true);
      document.removeEventListener("click", onDocumentClick);
      list?.removeEventListener("click", onListClick);
      presentingObserver?.disconnect();
      if (inerted.length > 0) {
        for (const [el, previous] of inerted) el.inert = previous;
        inerted.length = 0;
      }
    },
  };
}

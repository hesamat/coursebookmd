/**
 * Shared scroll-spy engine for the preview pane.
 *
 * Tracks the active h2/h3 of the visible section, highlights the matching
 * TOC entry, and keeps the SectionNavigator's waypoint in sync. Owns all
 * suppression/generation state for programmatic scrolls, the rAF scheduler,
 * and the pane's scroll/resize listeners. Used by both the live app and the
 * standalone export runtime; host-specific behavior (heading sourcing, TOC
 * matching, navigator access, lock defaults) is injected via the factory.
 */

/** How far from the top of the pane a scrolled-to element should sit. */
export const SCROLL_OFFSET = 80;

/** When within this many pixels of the content bottom, force the last heading. */
export const BOTTOM_THRESHOLD = 100;

/** How close the actual scroll top must be to the expected target to use the
    intended heading instead of recomputing from position. */
export const SCROLL_TARGET_TOLERANCE = 4;

/** Beyond this many pixels, programmatic scrolls jump instantly. */
export const LONG_SCROLL_DISTANCE = 3000;

/** A heading at or above this many pixels from the pane top is "active". */
export const ACTIVATION_LINE = 120;

/**
 * Create a scroll-spy bound to one scroll pane.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.pane - The scroll container (#previewPane).
 * @param {HTMLElement} [opts.resizeTarget] - Element observed for size changes
 *   that must re-run the spy without scrolling (async diagram/math rendering,
 *   editor re-renders, window resizes).
 * @param {() => HTMLElement | null} opts.getTocContainer - Returns the TOC
 *   container of the currently active chapter, or null.
 * @param {() => object | null} [opts.getNavigator] - Returns the
 *   SectionNavigator-like object ({ headings, currentIdx, setCurrent,
 *   syncVisual }) or null. A getter, so hosts may recreate the navigator at
 *   any time.
 * @param {() => boolean} [opts.getDefaultLock] - Default for update()'s
 *   lockNavigator when the caller does not pass one.
 * @param {"index" | "dataTarget"} [opts.tocMatch] - How TOC entries are matched
 *   to the active heading: by position ("index") or by the entry's
 *   data-target attribute ("dataTarget").
 * @param {() => HTMLElement[] | null} [opts.rederive] - When given, update()
 *   re-derives the tracked headings on every pass instead of using the cache
 *   set by setHeadings(). Returning null skips the pass; returning an empty
 *   array proceeds and clears the TOC highlight. Used by the export runtime,
 *   which tracks the active section without a chapter-switch cache.
 */
export function createScrollSpy({
  pane,
  resizeTarget = null,
  getTocContainer,
  getNavigator = () => null,
  getDefaultLock = () => false,
  tocMatch = "index",
  rederive = null,
}) {
  // Increments each time a programmatic scroll starts. A pending re-enable
  // captures the generation it started with and only re-enables the spy if
  // no newer scroll has superseded it.
  let suppressScrollGeneration = 0;
  let suppressScrollSpy = false;
  let headings = [];
  let frame = null;
  let resizeObserver = null;

  function resolveHeadings() {
    if (!rederive) return headings;
    const derived = rederive();
    if (!derived) return null;
    headings = derived;
    return derived;
  }

  /**
   * Set the active heading: update the TOC highlight and the navigator.
   * Pass null to clear the TOC highlight (chapter intro is on screen);
   * the navigator keeps its current heading in that case.
   * @param {HTMLElement | null} heading
   * @param {{ lockNavigator?: boolean }} [opts]
   */
  function setActive(heading, { lockNavigator = false } = {}) {
    const idx = heading ? headings.indexOf(heading) : -1;

    const tocContainer = getTocContainer();
    if (tocContainer) {
      const items = tocContainer.querySelectorAll(".toc-item");
      if (tocMatch === "dataTarget") {
        items.forEach((item) => item.classList.remove("active"));
        if (heading) {
          const target = heading.id;
          for (const item of items) {
            if (item.getAttribute("data-target") === target) {
              item.classList.add("active");
              break;
            }
          }
        }
      } else {
        items.forEach((item, i) => item.classList.toggle("active", i === idx));
      }
    }

    if (!heading) return;

    // Walk up to the parent H2 (the navigator tracks H1/H2). Skipped when
    // locked: the navigator's current heading was set explicitly and must
    // not be overridden.
    const navigator = getNavigator();
    if (navigator && !lockNavigator) {
      let h2 = heading;
      for (let i = idx; i >= 0; i--) {
        if (headings[i].tagName === "H2") {
          h2 = headings[i];
          break;
        }
      }
      const navIdx = navigator.headings.indexOf(h2);
      if (navIdx >= 0) {
        navigator.setCurrent(navIdx);
      }
    }
  }

  /**
   * Compute the active heading from the current scroll position and update
   * the TOC + navigator. This is the user-driven update path (scroll,
   * resize); programmatic scrolls settle on their intended heading instead
   * (see syncAfterScroll). Cheap, idempotent, and safe to call on every
   * frame.
   *
   * The active heading is the LAST heading (in document order) whose top has
   * scrolled up to the activation line near the top of the pane. This agrees
   * with programmatic navigation: TOC clicks and navigator moves land their
   * target at SCROLL_OFFSET — above the line. Clamped landings (targets near
   * the top/bottom of the scroll range) are handled by settling programmatic
   * scrolls on their INTENDED heading instead of re-computing from the
   * position (see syncAfterScroll), so no click-lock state is needed.
   *
   * @param {{ lockNavigator?: boolean }} [opts]
   */
  function update({ lockNavigator } = {}) {
    if (suppressScrollSpy) return;
    const lock = lockNavigator ?? getDefaultLock();
    const current = resolveHeadings();
    if (current === null) return;
    if (!rederive && current.length === 0) return;

    const { scrollTop, clientHeight, scrollHeight } = pane;

    // Near the bottom of a scrollable chapter: force the last heading so
    // short final sections are always reachable (the last heading may never
    // reach the activation line because there isn't enough content below it).
    // Only do this once the user has actually scrolled; otherwise a short
    // chapter that was just switched to could have its current heading forced
    // to the end before the user has navigated, breaking Right-arrow movement.
    if (scrollHeight > clientHeight) {
      const nearBottom =
        scrollTop + clientHeight >= scrollHeight - BOTTOM_THRESHOLD && scrollTop > 0;
      if (nearBottom) {
        setActive(current[current.length - 1] ?? null, { lockNavigator: lock });
        return;
      }
    }

    // Pick the last heading whose top is at or above the activation line.
    // Heading tops are monotonically non-decreasing in document order, so we
    // can stop at the first heading below the line.
    const paneTop = pane.getBoundingClientRect().top;
    let active = null;
    for (const heading of current) {
      if (heading.getBoundingClientRect().top - paneTop <= ACTIVATION_LINE) {
        active = heading;
      } else {
        break;
      }
    }

    setActive(active, { lockNavigator: lock });
  }

  /**
   * Sync the spy after a programmatic scroll settles (used by
   * scrollToInstant, scrollToSmooth, and navigator moves).
   *
   * When the scroll had an intended heading (TOC click, hash navigation,
   * navigator move), settle on THAT heading: clamped landings near the top or
   * bottom of the scroll range place the heading outside the activation line,
   * so a position re-computation would immediately override the user's
   * navigation. If the user interrupted the scroll (position off target), or
   * there was no intended heading (chapter switches), fall back to a
   * position-based update.
   *
   * @param {{ lockNavigator?: boolean, syncVisual?: boolean, activeHeading?: HTMLElement | null, expectedTop?: number | null }} [opts]
   */
  function syncAfterScroll({
    lockNavigator = false,
    syncVisual = lockNavigator,
    activeHeading = null,
    expectedTop = null,
  } = {}) {
    const navigator = getNavigator();
    if (syncVisual && navigator) {
      navigator.syncVisual();
    }
    const onTarget =
      expectedTop == null ||
      Math.abs(pane.scrollTop - expectedTop) <= SCROLL_TARGET_TOLERANCE;
    if (activeHeading && document.contains(activeHeading) && onTarget) {
      setActive(activeHeading, { lockNavigator });
    } else if (!activeHeading || !document.contains(activeHeading)) {
      // Chapter switch or the intended heading is gone: re-compute from the
      // current position.
      update({ lockNavigator });
    }
    // Otherwise the scroll landed off-target (main-thread jank interrupted
    // the animation mid-flight). Keep the intended heading highlighted — a
    // position re-computation from a stale snapshot would highlight whatever
    // section the janked scroll happened to stop at. The spy is live again,
    // so the next real user scroll re-computes from the actual position.
  }

  /**
   * Compute the pane's scrollTop that places `el` SCROLL_OFFSET px below the
   * top of the pane. Uses getBoundingClientRect so the math is consistent
   * with the spy (which also uses rects).
   * @param {HTMLElement} el
   * @returns {number}
   */
  function scrollTopForElement(el) {
    const paneRect = pane.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    return pane.scrollTop + (elRect.top - paneRect.top) - SCROLL_OFFSET;
  }

  /**
   * Scroll to an element instantly (no smooth animation). Used for
   * chapter-level navigation. The caller is responsible for chapter/sidebar
   * state — the spy is suppressed so it doesn't override it.
   * @param {HTMLElement} el
   */
  function scrollToInstant(el) {
    // Bump the generation and arm the suppression guard atomically, so a
    // stale re-enable from a superseded scroll sees a different generation
    // and is ignored.
    const gen = ++suppressScrollGeneration;
    suppressScrollSpy = true;
    pane.scrollTop = scrollTopForElement(el);
    // Instant scrolls jump immediately, so a single rAF is enough to let the
    // DOM settle before re-enabling the spy. Polling is not needed here.
    requestAnimationFrame(() => {
      if (gen !== suppressScrollGeneration) return;
      cancelScheduledUpdate();
      suppressScrollSpy = false;
      // Chapter/landing switches already set the navigator's current
      // heading; do not let the spy override it after the jump.
      syncAfterScroll({ lockNavigator: true });
    });
  }

  /**
   * Scroll to an element smoothly, suppressing the spy during the animation.
   * Very long jumps scroll instantly: smooth scrolling can take well over a
   * second for thousands of pixels, which reads as a hang.
   * @param {HTMLElement} el
   */
  function scrollToSmooth(el) {
    const maxTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
    const targetTop = Math.min(Math.max(scrollTopForElement(el), 0), maxTop);
    const distance = Math.abs(targetTop - pane.scrollTop);
    // Arm the guard and start the re-enable monitor before the scroll
    // begins. Smooth animations need polling because they can take longer
    // than one frame and may not fire a scrollend event. Highlight the
    // target once the scroll settles.
    suppressUntilDone({
      activeHeading: el,
      expectedTop: targetTop,
      syncVisual: true,
    });
    pane.scrollTo({
      top: targetTop,
      behavior: distance > LONG_SCROLL_DISTANCE ? "auto" : "smooth",
    });
  }

  /**
   * Suppress the spy while a programmatic scroll is in progress and
   * re-enable it once the scroll settles. scrollend is used when available;
   * the polling fallback also covers browsers without scrollend and the case
   * where no scrolling occurs at all (scrollend never fires then). Polling
   * is used instead of a fixed timeout so long smooth animations stay
   * suppressed until they truly end — waking mid-animation would let the spy
   * highlight intermediate headings and clobber the user's selection.
   *
   * @param {{ lockNavigator?: boolean, syncVisual?: boolean, activeHeading?: HTMLElement | null, expectedTop?: number | null }} [opts]
   */
  function suppressUntilDone({
    lockNavigator = false,
    syncVisual = lockNavigator,
    activeHeading = null,
    expectedTop = null,
  } = {}) {
    // Increment the generation and arm the guard atomically. Every re-enable
    // path checks the generation so a stale re-enable from an earlier,
    // superseded scroll cannot turn the spy back on.
    const gen = ++suppressScrollGeneration;
    suppressScrollSpy = true;
    let done = false;
    let quietPolls = 0;
    let started = false;
    let lastTop = pane.scrollTop;
    let pollTimer = null;
    let noStartTimer = null;
    let capTimer = null;

    function reenable() {
      if (done) return;
      done = true;
      clearInterval(pollTimer);
      clearTimeout(noStartTimer);
      clearTimeout(capTimer);
      pane.removeEventListener("scrollend", reenable);
      // A re-enable from a superseded scroll must not turn the spy back on.
      if (gen !== suppressScrollGeneration) return;
      suppressScrollSpy = false;
      syncAfterScroll({ lockNavigator, syncVisual, activeHeading, expectedTop });
    }

    pollTimer = setInterval(() => {
      const top = pane.scrollTop;
      if (top !== lastTop) {
        lastTop = top;
        started = true;
        quietPolls = 0;
        return;
      }
      // Still for two consecutive polls after movement: the animation ended.
      if (started && ++quietPolls >= 2) reenable();
    }, 100);
    // A scroll that never starts (already at the target) settles quickly.
    noStartTimer = setTimeout(() => {
      if (!started) reenable();
    }, 250);
    // Absolute cap in case of a stuck animation.
    capTimer = setTimeout(reenable, 4000);

    if ("onscrollend" in pane) {
      pane.addEventListener("scrollend", reenable, { once: true });
    }
  }

  /**
   * Run a navigator action (next/prev/first/last) and suppress the spy while
   * the resulting smooth scroll is in progress. Re-enables the spy when the
   * scroll animation ends, settling on the navigator's heading so the TOC
   * agrees with it.
   *
   * @param {Function} action - A no-argument function that performs the navigation.
   * @param {boolean} [syncVisual] - Whether to visually highlight the target heading.
   *   When false, the spy is not locked to the navigator.
   */
  function withNavigatorScroll(action, syncVisual = true) {
    const navigator = getNavigator();
    if (!navigator) return;
    const before = navigator.currentIdx;
    action();
    if (navigator.currentIdx === before) return;
    suppressUntilDone({
      lockNavigator: syncVisual,
      syncVisual,
      activeHeading: navigator.current,
    });
  }

  // rAF-throttled updates coalesce bursts of scroll events into one update
  // per frame; the ResizeObserver catches layout changes that happen without
  // scrolling.
  function scheduleUpdate() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      update();
    });
  }

  /**
   * Drop a pending spy update scheduled from scroll events that arrived while
   * a programmatic scroll was still suppressed. Without this, the frame fires
   * right after the scroll settles and its position re-computation can stomp
   * the intended heading (e.g. near the bottom, where the rule forces the
   * last heading).
   */
  function cancelScheduledUpdate() {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  }

  /**
   * Store the headings to track and run one locked update pass. Replaces any
   * previous heading set.
   * @param {HTMLElement[]} next
   */
  function setHeadings(next) {
    headings = next;
    // Lock the navigator when switching chapters/landing; the TOC updates,
    // but the waypoint index must stay at the first heading until the user
    // navigates explicitly.
    update({ lockNavigator: true });
  }

  function attach() {
    pane.addEventListener("scroll", scheduleUpdate, { passive: true });
    resizeObserver = new ResizeObserver(() => {
      if (!suppressScrollSpy) scheduleUpdate();
    });
    if (resizeTarget) resizeObserver.observe(resizeTarget);
  }

  function disconnectObserver() {
    resizeObserver?.disconnect();
  }

  function reobserve() {
    if (resizeTarget) resizeObserver?.observe(resizeTarget);
  }

  function destroy() {
    cancelScheduledUpdate();
    pane.removeEventListener("scroll", scheduleUpdate);
    disconnectObserver();
    resizeObserver = null;
  }

  return {
    setHeadings,
    attach,
    disconnectObserver,
    reobserve,
    update,
    setActive,
    syncAfterScroll,
    scrollToInstant,
    scrollToSmooth,
    suppressUntilDone,
    withNavigatorScroll,
    scheduleUpdate,
    cancelScheduledUpdate,
    destroy,
  };
}

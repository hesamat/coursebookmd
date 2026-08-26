/**
 * Momentarily highlight a heading to draw the user's eye after navigation.
 *
 * The `.flash` class triggers a CSS animation (see content.css). The reflow
 * trick (`void heading.offsetWidth`) ensures the animation restarts on
 * repeated clicks to the same heading.
 *
 * This function is shared between the app and the exported HTML. The exporter
 * serializes it via `.toString()` into the standalone HTML's inline script.
 *
 * @param {HTMLElement} heading
 */
export function flashHeading(heading) {
  heading.classList.remove("flash");
  void heading.offsetWidth;
  heading.classList.add("flash");
  heading.addEventListener("animationend", () => heading.classList.remove("flash"), {
    once: true,
  });
}

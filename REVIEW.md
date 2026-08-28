# Review Guidelines

This file provides guidance to [Devin Review](https://docs.devin.ai/work-with-devin/devin-review)
and other automated reviewers when analyzing pull requests in this repository.
Architecture details, module reference, and pre-review verification checklists
live in `AGENTS.md` — this file contains only review-specific rules.

## Ignore

Do not raise findings in:

- `dist/` — generated build output
- `docs/assets/` — SVG diagrams and images, not source
- `docs/chapters/` — user guide content, not application source
- Formatting and syntax — owned by Prettier and ESLint, not review

## Critical Areas

### DOMPurify sanitization

All user-authored Markdown rendered into the DOM must be sanitized with
DOMPurify before `innerHTML`. This is the most important security invariant.

- Flag any `innerHTML` assignment that bypasses `sanitizeHtml()` when the
  content originates from Markdown or user input.
- `ContentEnhancer` output (Shiki HTML, KaTeX HTML, D2 SVG) is trusted —
  do not route it through DOMPurify again.
- Raw SVG code fences are user-authored and must be sanitized with `sanitizeSvg()`
  before insertion.
- The export script is injected as a string literal via `toString()` — flag
  any user-interpolated content in the export script template.

### Layering & dependency direction

Layers (low to high): `core` → `renderer` → `navigator` → `app`.

- Flag any import that crosses a layer upward (e.g., `core/` importing
  `renderer/` or `navigator/`, `renderer/` importing `app.js`).
- `app.js` is the top-level orchestrator — it may import from any layer, but
  no layer may import from `app.js`.
- Shared modules (`core/navigation.js`, `core/toc-data.js`) must not reference
  app-specific state (e.g., `previewPane`, `currentChapterIdx`). They are
  designed to be injectable into the exported HTML via `toString()`.

### Shared module injectability

`core/navigation.js` and `core/heading-flash.js` are injected into the
exported HTML script via `.toString()`. This imposes strict constraints:

- Flag any change to these modules that references external scope (imports,
  closures, module-level variables). The function body must be self-contained.
- Flag any change that uses ES module syntax (`import`/`export`) inside the
  function body — the exported script runs as a plain `<script>`, not a
  module.
- Flag any change to `navigateToTarget` that uses `scrollIntoView` with
  `behavior: "smooth"` without considering the scroll-spy suppression pattern
  used in the app (the export script has no scroll-spy, so this is fine there,
  but the app must suppress via `scrollToElSmooth`).

### Continuous flow invariants

The app renders all chapters as `<section class="coursebook-section">` elements
in a single continuous page. Several invariants must hold:

- Flag any code that renders a single chapter at a time (replacing
  `contentEl.innerHTML`) — all chapters must remain in the DOM for scroll-spy
  and hash navigation to work.
- Flag heading ID collisions across chapters — IDs must be unique across the
  entire document. The `usedIds` Set pattern in `renderAllChapters` enforces
  this; any new rendering path must do the same.
- Flag section numbering that does not use
  `computeSectionNumbersForSections()` — the landing page (section 0) must
  remain unnumbered, and chapter numbering must continue across chapters.
- Flag scroll-spy logic that uses `offsetTop` instead of
  `getBoundingClientRect()` — the two can disagree when margins or padding
  are involved, causing the scroll-spy to fight with programmatic scrolling.

### Scroll-spy suppression during programmatic navigation

The scroll-spy must be suppressed during programmatic scrolling (chapter
clicks, prev/next, hash navigation, TOC clicks) to prevent it from overriding
the caller's already-correct state.

- Flag any programmatic scroll (`scrollIntoView`, `scrollTop =`) that does not
  go through `scrollToElInstant` or `scrollToElSmooth`, which handle
  suppression.
- Flag any call to `updateScrollSpy()` immediately after setting
  `scrollTop` — the browser may not have flushed layout yet, producing stale
  rects. Use `requestAnimationFrame` to defer.

## Conventions

### Section numbering

Section numbers are computed by `computeSectionNumbersForSections()` in
`core/section-numbering.js` and applied via `applyHeadingNumber()`.

- Flag any code that manually constructs heading numbers (e.g., string
  concatenation like `"1." + i`) instead of using the shared functions.
- Flag any code that numbers the landing page H1 — it must remain unnumbered.
- The numbering must be continuous across chapters: chapter 2's first heading
  continues from where chapter 1 left off, not restart at "2.1".

### Hash format

The unified hash format is `#chapter-slug` or `#chapter-slug/heading-slug`.

- Flag any code that uses a different hash format (e.g., `#chapter-1`,
  `#prefixed-id`) — both the app and the export must use the same format via
  `parseLocationHash` / `formatLocationHash`.
- Flag any code that sets `location.hash` directly instead of using
  `history.replaceState` — direct assignment triggers a `hashchange` event
  that can cause double-navigation.

### CSS

- Flag hardcoded colors — use `var(--text-high)`, `var(--surface-bg)`,
  `var(--accent)`, etc. from `base.css`.
- Flag present-mode styles outside `present.css` — all `body.presenting`
  rules belong in `present.css`.
- Flag spotlight dimming rules that don't exclude `.coursebook-section` —
  the chapter wrapper sections must not be dimmed, only the
  `SectionNavigator`'s inner wrapper sections.

### Export HTML consistency

The exported HTML must behave identically to the app for navigation.

- Flag TOC links in the export that don't use `formatLocationHash()` —
  they must produce the same `#chapter-slug/heading-slug` format.
- Flag section IDs in the export that don't match the chapter slug —
  the export must use `chapterSlug(title)` as the section ID, same as the app.
- Flag any shared function injected into the export that has been modified
  without verifying the `.toString()` output is still self-contained.

### Reuse before reinvention

- Flag new hash parsing/formatting logic that duplicates
  `core/navigation.js` — both the app and export must use the shared module.
- Flag new TOC extraction logic that duplicates `core/toc-data.js` —
  `extractTocItems()` is the single source for TOC item data.
- Flag new section numbering logic that duplicates
  `core/section-numbering.js` — `computeSectionNumbers` and
  `computeSectionNumbersForSections` are the only correct implementations.

# CoursebookMD Audit — `main` (post-e2e)

This report was produced after pulling the latest `main`, installing dependencies, and running the local quality gates and the new Playwright e2e suite.

## Local verification snapshot

| Check            | Command                                     | Result                                                                                                                                          |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Latest `main`    | `git checkout main && git pull origin main` | Up to date                                                                                                                                      |
| Dependencies     | `npm install`                               | 5 packages added, 0 vulnerabilities                                                                                                             |
| Browser install  | `npx playwright install chromium`           | Chromium available                                                                                                                              |
| Dev boot         | `npm run dev`                               | http://127.0.0.1:8200/ loads `docs/coursebook.md`; console shows only 2 non-fatal `No available adapters` warnings                              |
| Unit tests       | `npm test`                                  | **157/157 pass** (10 test files)                                                                                                                |
| E2E tests        | `npm run test:e2e`                          | **7/7 pass** (`e2e/diagrams.spec.js`)                                                                                                           |
| Lint             | `npm run lint`                              | Pass                                                                                                                                            |
| Format           | `npm run format:check`                      | Pass                                                                                                                                            |
| Production build | `npm run build`                             | `dist/export-runtime.iife.js` generated (27.61 kB gzipped 8.11 kB); Rollup warns that some chunks exceed 500 kB (Shiki, Mermaid, KaTeX bundles) |
| Built preview    | `npm run preview`                           | http://127.0.0.1:4173/ loads the built site standalone and serves `docs/coursebook.md`                                                          |

Notes:

- `vitest.config.mjs` does not include a coverage provider, so no statement/branch coverage is generated; the suite is entirely pass/fail.
- The dev console warnings come from the D2/SVG adapter layer and are not fatal.

---

## A — Architecture & code health

### A.1 `src/app.js` is an oversized orchestrator

- `src/app.js` is **2,472 lines** with **71 top-level functions** plus ~50 top-level constants. Its 17 section-comment headers are at lines 118, 162, 202, 227, 267, 539, 1192, 1274, 1285, 1494, 1621, 1659, 1883, 2264, 2443, 2471.
- It imports from every layer (`core`, `renderer`, `navigator`) and directly owns: theme, settings, icon hydration, rendering pipeline, coursebook loading, chapter list building, TOC building, scroll-spy, editor, menu, presentation mode, keyboard routing, file-system operations, save, export, and in-content link interception.

**Concrete extraction seams for Phase 8 (`[ ] Split app.js`):**

| Proposed module              | Line range in `app.js` | Key functions / anchors                                                                                                                                                                                                    |
| ---------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scroll-spy.js`              | 775–1494               | `scrollTopForElement`, `scrollToElInstant`, `scrollToElSmooth`, `suppressScrollSpyUntilDone`, `setupScrollSpy`, `scrollSpyUpdate`, `syncScrollSpyAfterScroll`, `scheduleScrollSpyUpdate`, `cancelScheduledScrollSpyUpdate` |
| `chapter-renderer.js`        | 379–517                | `renderAllChapters`, `renderSingleMarkdown`, `resolveLocalImages`, `resolveAsset`, `fileToDataUri`, `getLocalFile`                                                                                                         |
| `editor-controller.js`       | 1494–1613              | `syncEditorWithCurrent`, `setEditMode`, the `editorEl` `input` listener and dirty-tracking                                                                                                                                 |
| `menu-controller.js`         | 1621–1658              | `toggleMenu`, `closeMenu`, `menuBtn` listener                                                                                                                                                                              |
| `presentation-controller.js` | 1659–1882              | `enterPresent`, `exitPresent`, `isShortcut`, keyboard routing, `withNavigatorScroll`                                                                                                                                       |
| `file-operations.js`         | 1883–2370              | `openCoursebookFolder`, `openFile`, `saveAll`, `showToast`, `exportHtml`                                                                                                                                                   |

**Status:** Confirmed — `app.js` is a clear extraction target.

### A.2 `wrapSections()` is not dead in coursebook mode

- `src/navigator/section-navigator.js:31–40` still runs `wrapSections()` from `setup()` at line 74.
- In coursebook mode it iterates over existing `.coursebook-section` chapter wrappers and calls `_wrapAtHeadings(chapter)` to create internal `<section>`s around H2s for spotlight dimming.
- In standalone mode it wraps the entire `contentEl`.
- The JSDoc comment at lines 27–30 says it should not run in continuous flow, which is now misleading — it wraps _inside_ the chapter, not the chapter itself.

**Status:** Confirmed active in both modes; the comment is stale and should be updated.

### A.3 Layer enforcement is unguarded

- No `layering-invariants.test.js` or equivalent exists in `src/__tests__/`.
- A manual import scan found no upward-crossing imports from `core/` to `renderer/`/`navigator/` or from `renderer/` to `navigator/`/`app.js`. `app.js` is the only top-layer orchestrator.

**Status:** Missing test; architecture is clean by inspection but not enforced by CI.

### A.4 Export runtime re-implements live-app scroll-spy logic

- `src/export-runtime.js` contains its own full copy of `scrollToElInstant`, `scrollToElSmooth`, `suppressScrollSpyUntilDone`, `scrollSpyUpdate`, etc. (lines 328–542) instead of reusing a shared `scroll-spy` module.
- It does correctly reuse `core/navigation.js`, `core/toc-data.js`, `core/section-numbering.js`, and `navigator/section-navigator.js`.

**Status:** Newly discovered duplication; a shared scroll-spy module would close this gap.

---

## B — Fragile invariants

### B.1 DOMPurify and `innerHTML` trust boundary

All Markdown-derived `innerHTML` assignments go through `sanitizeHtml` first:

| File                                  | Line                            | Assignment                                                            | Sanitized?                 |
| ------------------------------------- | ------------------------------- | --------------------------------------------------------------------- | -------------------------- |
| `src/app.js`                          | 386                             | `contentEl.innerHTML = ""` (clear)                                    | N/A                        |
| `src/app.js`                          | 395                             | `landingSection.innerHTML = sanitizeHtml(renderMarkdown(...))`        | Yes                        |
| `src/app.js`                          | 415                             | `section.innerHTML = sanitizeHtml(renderMarkdown(...))`               | Yes                        |
| `src/app.js`                          | 424                             | `section.innerHTML = sanitizeHtml(renderMarkdown(...))` (placeholder) | Yes                        |
| `src/app.js`                          | 494                             | `contentEl.innerHTML = sanitizeHtml(renderMarkdown(...))`             | Yes                        |
| `src/app.js`                          | 506, 586, 666, 1223, 1553, 2014 | `...innerHTML = ""` (clear)                                           | N/A                        |
| `src/renderer/coursebook-exporter.js` | 83, 93, 116                     | `html: container.innerHTML` extracted after `sanitizeHtml`            | Yes, by prior sanitization |
| `src/renderer/coursebook-exporter.js` | 136                             | `container.innerHTML = sanitizeHtml(renderMarkdown(...))`             | Yes                        |
| `src/export-runtime.js`               | 98, 190                         | `chapterListEl.innerHTML = ""` / `tocContainer.innerHTML = ""`        | N/A                        |

Trusted `ContentEnhancer` outputs are not double-sanitized:

| File                               | Line | Output                                 | Trust reason                                                                 |
| ---------------------------------- | ---- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `src/renderer/content-enhancer.js` | 152  | `temp.innerHTML = highlighted` (Shiki) | Trusted compiler output, inserted via `replaceWith` into a temp `<template>` |
| `src/renderer/content-enhancer.js` | 473  | `el.innerHTML = svg` (D2)              | Trusted D2-rendered SVG, not user markup                                     |
| `src/renderer/content-enhancer.js` | 492  | `el.innerHTML = clean` (raw SVG)       | Sanitized first with `sanitizeSvg`                                           |

`src/renderer/coursebook-exporter.js:330` escapes the `<title>` with `escapeHtml` (line 651). `configJson` escapes `<` (line 323) and the runtime bundle escapes `</script>` (line 322).

**Status:** Confirmed — all user/markdown `innerHTML` is sanitized; trusted outputs are not re-sanitized.

### B.2 Continuous-flow invariants

| Invariant                                 | Evidence                                                                                                                                                              | Status    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| All chapters stay in the DOM              | `src/app.js:379–430` appends every chapter `section` to `contentEl`; `src/renderer/coursebook-exporter.js:304–308` builds all section wrappers                        | Confirmed |
| Heading IDs unique across chapters        | `src/app.js:446–468` `usedIds` set in `renderAllChapters`; `src/app.js:1574–1595` on editor re-render; `src/renderer/coursebook-exporter.js:235–253` `deduplicateIds` | Confirmed |
| Section numbering continuous              | `computeSectionNumbersForSections` used at `src/app.js:439`, `659`, `1531` and `src/renderer/coursebook-exporter.js:215`                                              | Confirmed |
| H3/`1.1.1` numbering supported            | `src/core/section-numbering.js:86–114` tracks h1/h2/h3 counters; `src/core/section-numbering.js:132–165` `computeSectionNumbersForSections`                           | Confirmed |
| Scroll-spy uses `getBoundingClientRect()` | `src/app.js:1378`, `1381`; `src/export-runtime.js:457`, `475`; `src/navigator/section-navigator.js:151–152`, `159`, `193–194`                                         | Confirmed |
| No `offsetTop`                            | `grep` returned 0 matches in `src/`                                                                                                                                   | Confirmed |

### B.3 Scroll-spy suppression during programmatic navigation

- `src/app.js:787–806` (`scrollToElInstant`) and `src/app.js:817–835` (`scrollToElSmooth`) are the two canonical scroll helpers that arm `suppressScrollSpy` before the DOM move and re-enable via `requestAnimationFrame` / `suppressScrollSpyUntilDone`.
- `src/app.js:848–903` `suppressScrollSpyUntilDone` waits for layout to settle and never calls `updateScrollSpy()` before the flush.
- Hash, TOC, prev/next chapter, and keyboard nav all flow through `scrollToElInstant`/`scrollToElSmooth` or `withNavigatorScroll` + `suppressScrollSpyUntilDone`.

**Fragile finding:** `src/navigator/section-navigator.js:197` uses `heading.scrollIntoView({ behavior, block: "start" })` directly, not the two helpers. Keyboard navigation calls it from `withNavigatorScroll` (`src/app.js:915–925`) which suppresses after the fact, but the `scrollIntoView` itself does not observe the `SCROLL_OFFSET` or the shared generation guard. This is the only remaining `scrollIntoView` in source (not tests).

**Status:** Mostly confirmed; one fragile `scrollIntoView` escape in `section-navigator.js`.

### B.4 Shared-module reuse

- `core/navigation.js` (`parseLocationHash`, `formatLocationHash`): imported by `src/app.js:23` and `src/export-runtime.js:17`.
- `core/toc-data.js` (`extractTocItems`): imported by `src/app.js:24` and `src/export-runtime.js:18`.
- `core/section-numbering.js` (`computeSectionNumbersForSections`): imported by `src/app.js:19`, `src/renderer/coursebook-exporter.js:13`, and tested in `src/__tests__/section-numbering.test.js`.
- `core/utils.js` (`slugifyForId`, `resolveContentRefs`): imported by `src/app.js:22`, `src/renderer/coursebook-exporter.js:16`, `src/export-runtime.js:19`.

No duplicate hash parsing, TOC extraction, or section numbering logic was found in `app.js` or the export paths.

**Status:** Confirmed.

### B.5 Hash format consistency

- `src/app.js:1072`, `1126`, `1257` and `src/export-runtime.js:217`, `300`, `606` all use `history.replaceState(...)` to set the hash.
- No `location.hash = ...` assignments exist in `src/`.

**Status:** Confirmed.

---

## C — UX & feature gaps (vs. ROADMAP.md)

### Phase 2 — Reading / real content

| Task                                          | Status            | Evidence                                                                                                                                                 | User impact |
| --------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 2.1 Warning/note/command blocks               | **Implemented**   | `src/renderer/content-enhancer.js:302–335` + `src/styles/content.css:142–191`                                                                            | Low         |
| 2.1 Mandatory headings                        | **Implemented**   | `src/renderer/markdown-renderer.js:37–45` + `src/styles/content.css:193–201`                                                                             | Low         |
| 2.1 Figure captions                           | **Implemented**   | `src/renderer/content-enhancer.js:349–375` + `src/styles/content.css:213–230`                                                                            | Low         |
| 2.1 Indexed terms (`==term==`)                | **Missing**       | No parser, no `.idx` CSS; `grep` for `==...==` and `.idx` returned 0 matches in `src/` and `docs/`                                                       | High        |
| 2.1 Code sample captions                      | **Missing**       | No `data-code` handling; `grep` returned only ROADMAP references                                                                                         | Med         |
| 2.2 In-content "In this Chapter" TOC          | **Missing**       | No in-content TOC element generated; only sidebar TOC (`src/app.js:1216–1262`)                                                                           | High        |
| 2.2 Per-heading "go up" links                 | **Missing**       | No up-arrow/return link generation in `content-enhancer.js` or `content.css`                                                                             | Med         |
| 2.2 Presentation waypoints (`##! Title` etc.) | **Missing**       | `SectionNavigator` stops on every H1/H2 (`src/navigator/section-navigator.js:71`); no directive parser                                                   | High        |
| 2.3 Load/present a real chapter               | **Not validated** | Longest chapter in repo is `docs/chapters/03-rich-content.md` at 126 lines; no real long-form teaching material exists to stress-test heading navigation | High        |

### Phase 3 — Course structure

| Task                           | Status          | Evidence                                                                                                                      | User impact |
| ------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 3.1 Nested `1.1.1` numbering   | **Implemented** | `src/core/section-numbering.js:86–114` supports h3; rendered content uses `computeSectionNumbersForSections`                  | Low         |
| 3.1 Part/grouping              | **Implemented** | `src/core/coursebook-loader.js` emits groups; `src/core/nav-groups.js`; `src/app.js:691–744` renders collapsible group labels | Low         |
| 3.3 Fundamental concepts index | **Missing**     | No `data-fund` link collection or index page                                                                                  | Med         |
| 3.3 Figures index              | **Missing**     | `addFigureCaptions` numbers figures but does not aggregate an index                                                           | Med         |
| 3.3 Code samples index         | **Missing**     | No code-sample aggregation                                                                                                    | Low         |
| 3.3 General index (terms)      | **Missing**     | Depends on missing indexed-terms feature                                                                                      | High        |

### Phase 4 — CodeMirror editor

| Task                              | Status      | Evidence                                           | User impact |
| --------------------------------- | ----------- | -------------------------------------------------- | ----------- |
| 4.1 Integrate CodeMirror 6        | **Missing** | `index.html:127–132` is a plain `<textarea>`       | High        |
| 4.2 Syntax highlighting in editor | **Missing** | Same `<textarea>`                                  | High        |
| 4.3 Undo/redo history             | **Missing** | Native browser undo only; no chapter-level history | High        |
| 4.4 Find/replace                  | **Missing** | Browser find only                                  | Med         |
| 4.5 Soft wrap                     | **Missing** | `<textarea>` uses default wrap                     | Med         |
| 4.6 Tab handling                  | **Missing** | No custom Tab/Shift-Tab handler                    | Med         |

### Phase 5 — Presentation hardening

| Task                               | Status          | Evidence                                                                                                                            | User impact |
| ---------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 5.1 Waypoint-only navigation       | **Missing**     | Every H1/H2 is a waypoint; no mark-up syntax or filter                                                                              | High        |
| 5.2 Spotlight dimming              | **Implemented** | `src/navigator/section-navigator.js:216–219`; `src/styles/content.css:429–438`; `src/styles/present.css`                            | Low         |
| 5.3 Progress indicator             | **Partial**     | `src/app.js:518–537` sets `overlayProgress` text, but `src/styles/present.css:139–141` sets `.overlay__progress { display: none; }` | Med         |
| 5.4 Font size calibration          | **Partial**     | Fixed sizes in `src/styles/present.css:7–104`; no user control or per-room presets                                                  | Med         |
| 5.5 Keyboard shortcuts sheet (`?`) | **Missing**     | `src/styles/present.css:199` shows only `← → prev/next section  ↑ ↓ scroll  Esc exit`                                               | Med         |
| 5.6 Blackout (`B`)                 | **Missing**     | No blackout class or handler; `grep` for `blackout` returned 0 matches                                                              | Med         |

### Phase 6 — Export parity

| Task                              | Status          | Evidence                                                                                                                           | User impact |
| --------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 6.1 Course-level TOC landing page | **Implemented** | `src/renderer/coursebook-exporter.js:79–95` emits an `overview` section                                                            | Low         |
| 6.2 Per-chapter multi-page export | **Missing**     | `buildHtmlDocument` produces one single-file HTML                                                                                  | High        |
| 6.3 Indexes in export             | **Missing**     | No index pages generated in export                                                                                                 | High        |
| 6.4 Course branding header/footer | **Missing**     | No course code/title header or copyright footer in `buildHtmlDocument`                                                             | Med         |
| 6.5 Print-friendly CSS            | **Partial**     | `src/renderer/coursebook-exporter.js:415–421` hides inactive sections for screen; no `@media print` page-break or typography rules | Med         |
| 6.6 Client-side search in export  | **Missing**     | No search input/index in exported runtime                                                                                          | High        |

### Phase 7 — Authoring

| Task                                  | Status          | Evidence                                                                                                      | User impact |
| ------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------- | ----------- |
| 7.1 File-based editing                | **Implemented** | File System Access API flow in `src/app.js:1883–2370`                                                         | Low         |
| 7.2 Live preview on save (file watch) | **Missing**     | Editor re-renders on `input` (`src/app.js:1514–1613`), but there is no file-system watcher for external saves | Med         |
| 7.3 New chapter scaffolding           | **Missing**     | No UI or menu item to create chapter + update `coursebook.md`                                                 | High        |
| 7.4 Drag-to-reorder chapters          | **Missing**     | Chapter list is static; no drag handlers                                                                      | Med         |
| 7.5 Spell check                       | **Missing**     | `<textarea spellcheck="false">` (`index.html:131`)                                                            | Med         |
| 7.6 Link validation                   | **Missing**     | No validation for internal `.md`/image paths                                                                  | Med         |

### Backlog — Accessibility & i18n

| Task                 | Status      | Evidence                                                                                                                                                                              | User impact                  |
| -------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Keyboard nav         | **Partial** | Global shortcut handler exists (`src/app.js:1741–1875`), but no focus trap for modals, no skip link, and no `aria-live` for dynamic toasts                                            | Med                          |
| ARIA/landmarks       | **Partial** | 15 `aria-*` attributes in `index.html`; `main`, `aside`, `nav` used, but `chapterNav` buttons only get `aria-label` dynamically after load (`src/app.js:1156`)                        | Med                          |
| Focus management     | **Partial** | `:focus-visible` styles in `src/styles/controls.css` and `content.css`; no visible focus on sidebar chapter items; modal close buttons get focus but focus is not returned to trigger | Med                          |
| Screen-reader labels | **Partial** | Copy button, theme, menu, and nav buttons have labels; figure captions are text; progress overlay text is hidden                                                                      | Low                          |
| RTL / localization   | **Missing** | `html lang="en"` only; no `dir` or translation hooks                                                                                                                                  | High for non-English courses |

---

## E2E coverage note

The new `e2e/diagrams.spec.js` (7 tests, all passing) guards:

- D2 diagram rendering and SVG output (`:8–65`)
- Raw SVG code-fence rendering and sanitization (`:22–34`, `:67–98`)
- D2 theme consistency on light/dark toggle (`:36–65`)
- D2 error fallback (`:100–114`)
- Copy buttons not appearing on diagram containers (`:116–129`)
- Distinct D2 output for multiple diagrams (`:131–155`)

It does **not** cover the flows the prompt flagged: navigation/scroll-spy, TOC selection, present mode, or export. Those remain unguarded by e2e and rely on the 157 Vitest unit tests plus manual verification.

---

## Prioritized backlog

Ranked by user impact vs. effort. Items at the top deliver the most teaching value for the least work.

| Rank | Item                                                                                     | Phase     | Why it matters                                                                                | Effort      |
| ---- | ---------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------- | ----------- |
| 1    | Add a real/long chapter dry-run or fixture to validate heading navigation without slides | 2.3       | The core thesis is untested; without this, other UX choices are speculative. Low cost to run. | Low         |
| 2    | Replace `<textarea>` with CodeMirror 6 (editor module)                                   | 4         | Plain editor is the biggest authoring pain point.                                             | High        |
| 3    | In-content "In this Chapter" TOC + per-heading "go up" links                             | 2.2       | High reading-usability wins for long chapters; mostly DOM/CSS.                                | Low         |
| 4    | Indexed terms (`==term==`) + general index page                                          | 2.1 / 3.3 | Needed for course-portal parity and reference navigation.                                     | Medium      |
| 5    | Presentation waypoints, visible progress overlay, blackout, shortcut sheet               | 5         | Makes lecture mode actually usable for a full class.                                          | Medium      |
| 6    | Multi-page export + client-side search + indexes in export                               | 6         | Students need a standalone site, not just a single HTML file.                                 | Medium-High |
| 7    | Extract shared scroll-spy module and add `layering-invariants.test.js`                   | 8         | Reduces duplication and prevents future architectural drift.                                  | Medium      |
| 8    | New chapter scaffolding, drag-to-reorder, link validation                                | 7         | Authoring workflow features; foundational but larger UI work.                                 | High        |
| 9    | Focus traps, skip link, `aria-live`, visible focus in sidebar, RTL support               | Backlog   | Required for accessibility/internationalization.                                              | Medium      |
| 10   | Live file-watch preview on external save                                                 | 7         | Nice to have; editor debounce already covers most live preview.                               | Low         |
| 11   | Code sample captions                                                                     | 2.1       | Low demonstrated need; easy to add later.                                                     | Low         |

---

## Review result

**PASS** for the current quality gates and the new e2e suite. **NEEDS_FIX** on product side before the tool can teach a real course: it still lacks the reading aids (index, in-content TOC, waypoints), a usable editor, and the export/search features described in Phases 2–7. The new e2e tests also do not yet cover navigation, present mode, or export.

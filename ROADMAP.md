# CoursebookMD Roadmap

## Origin

CoursebookMD started from a simple question: can you teach a real course by
navigating headings in a continuous Markdown document, without wishing for
slides? The thesis is that connected course material is better for students and
easier for instructors than slide-deck authoring, and that presentation is a
view mode over the document — not a separate artifact.

The reference for real course content is the BCIT course portal
(alexandervolkov.commons.bcit.ca), which Alexander Volkov uses to teach COMP
courses with continuous HTML pages, hierarchical numbering, per-unit TOCs,
indexed terms, and figure/code captions — all generated from plain HTML.

This roadmap tracks the gap between the current tool and what is needed to teach
a real course with it.

---

## Phase 1: Foundation ✅

Goal: Build the core document-first authoring and presentation tool.

| Task                            | Details                                                |
| ------------------------------- | ------------------------------------------------------ |
| [x] Markdown rendering          | markdown-it with tables, strikethrough, task lists     |
| [x] Syntax highlighting         | Shiki (VS Code TextMate grammars, inline styles)       |
| [x] Math                        | KaTeX inline (`$...$`) and display (`$$...$$`)         |
| [x] Diagrams                    | D2 and raw SVG for flowcharts, sequence diagrams, etc. |
| [x] Presentation mode           | Fullscreen spotlight navigation, keyboard controls     |
| [x] Themes                      | Light/dark with three palettes                         |
| [x] Copy buttons                | One-click copy on every code block                     |
| [x] Multi-chapter structure     | `coursebook.md` + `chapters/` directory                |
| [x] Continuous flow             | All chapters on one scrollable page                    |
| [x] Section numbering           | Continuous across chapters (1, 1.1, 2, 2.1, ...)       |
| [x] URL hash navigation         | `#chapter-slug/heading-slug` format                    |
| [x] Standalone HTML export      | Single file with inlined assets                        |
| [x] Shared modules              | `navigation.js`, `toc-data.js`                         |
| [x] Quality gates               | ESLint, Prettier, Vitest (96 tests)                    |
| [x] Documentation               | README, AGENTS.md, REVIEW.md, CONTRIBUTING.md          |
| [x] External coursebook serving | Vite middleware serves sibling dirs via `/courses/`    |
| [x] Open Coursebook Folder      | One-step directory picker with File System Access API  |
| [x] Save to disk                | Write edited `.md` files back via file handles; Ctrl+S |
| [x] Neutral content colors      | Dark brown headings/links independent of app theme     |
| [x] Week group labels           | Unnumbered group headings in nav from parent H2/H3     |
| [x] Collapsible export sidebar  | Hamburger toggle + SVG chevron chapter toggles         |
| [x] Export link rewriting       | `.md` chapter links → `#chapter-slug` hash links       |
| [x] Toast notifications         | Save feedback and error messages                       |

---

## Phase 2: Real Course Content Validation

Goal: Load the COMP 1510 chapter and the BCIT course portal content model to
validate that CoursebookMD can handle real teaching material. This is the
original "Step 3: Present it" from the founding conversation.

### 2.1 Content styling

Real course HTML uses semantic styling that Markdown doesn't natively produce.
Support these via Markdown extensions or raw HTML passthrough.

| Task                            | Details                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [x] Warning/note/command blocks | `> **Warning:**` and `> **Note:**` blockquotes with styled left borders; bash/shell/sh fences get terminal styling |
| [x] Mandatory section styling   | Visual distinction (red border, tinted bg) for `## Mandatory: Title` headings                                      |
| [ ] Indexed terms               | Key terms get dotted underline and are collected into an index — `==term==` syntax or `<span class="idx">`         |
| [x] Figure captions             | Auto-number `![Caption](src)` as "Figure 1.", "Figure 2."                                                          |
| [ ] Code sample captions        | Optional `data-code` caption on code fences: "Code sample 1."                                                      |

### 2.2 Navigation aids

| Task                          | Details                                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ ] Per-heading "go up" links | `▲` link on each H2 that scrolls back to the chapter top or the course TOC                                                                                            |
| [ ] Presentation waypoints    | Not every heading is a presentation stop. Allow marking headings as waypoints (e.g. `##! Title` or a directive) so arrow-key navigation only stops on marked headings |

### 2.3 Test with real content

| Task                                                        | Details                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [ ] Load BCIT COMP 2854 scientific method chapter           | The reference page from alexandervolkov.commons.bcit.ca                                                                   |
| [ ] Present a real chapter to validate the core interaction | The original question: "Can I teach a real chapter by navigating its headings in fullscreen, without wishing for slides?" |
| [ ] Identify what's still missing after real use            | Honest assessment after dry-run                                                                                           |

---

## Phase 3: Course-Level Structure

Goal: Support the full course hierarchy that the BCIT portal demonstrates.

### 3.1 Hierarchical numbering

| Task                         | Details                                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ ] Nested section numbering | Support `1.1.1` depth from `<section>` nesting or heading levels, not just `chapter.heading`                                                                                                                                          |
| [x] Part/grouping concept    | Optional grouping above chapters (e.g. "Week 1", "Module 2") with its own numbering level                                                                                                                                             |
| [x] Numbering in export      | Ensure nested numbering appears correctly in exported HTML                                                                                                                                                                            |
| [x] Collapsible group labels | Group labels from parent H2/H3 headings are collapsible in the sidebar with chevron icons. Collapsed state persists per group in localStorage. Active chapter's group auto-expands. State managed via `src/core/nav-groups.js` module |

### 3.3 Indexes and cross-references

| Task                           | Details                                                                    |
| ------------------------------ | -------------------------------------------------------------------------- |
| [ ] Fundamental concepts index | Collect `data-fund` tagged links into a dedicated index page/section       |
| [ ] Figures index              | Auto-collect all figures with their captions into a figures index          |
| [ ] Code samples index         | Auto-collect all code samples with captions                                |
| [ ] General index              | Collect all indexed terms (`.idx` / `==term==`) into an alphabetical index |

---

## Phase 4: CodeMirror Editor

Goal: Replace the plain `<textarea>` with CodeMirror for a proper Markdown
editing experience. Copy the setup from SlideMD rather than building from
scratch. The work is tracked in four sub-iterations: drop-in replacement,
per-chapter state/flush, authoring helpers, and wrap/tab/source-jump.

### 4.1 Drop-in replacement ✅

| Task                                 | Details                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| [x] Integrate CodeMirror 6           | Markdown language support, line numbers, bracket matching, fold gutter       |
| [x] Syntax highlighting in editor    | Markdown tokens highlighted as you type                                      |
| [x] Search and replace               | In-editor find/replace panel                                                 |
| [x] Preserve live preview sync       | Editor changes still debounce-render to the preview pane                     |
| [x] Preserve continuous flow editing | Editing a chapter still updates its section in-place without full re-render  |
| [x] Theme integration                | Editor theme follows the app's light/dark mode and palette                   |
| [x] Resizable editor pane            | Draggable divider, 30% default, width persisted in localStorage              |
| [x] Reduced editor font size         | 13px editor text for comfortable prose editing                               |
| [x] Flush before navigation/save     | `setEditMode`, `activateCoursebook`, and save/export paths await a flush     |
| [x] Serialize live re-renders        | `onEditorInput` chains on `liveEditorInput` so concurrent renders don't race |

### 4.2 Per-chapter undo / state

| Task                              | Details                                                                |
| --------------------------------- | ---------------------------------------------------------------------- |
| [ ] Per-chapter EditorState cache | Cache `EditorState` per section so undo/redo survives chapter switches |
| [ ] Flush on save and export      | Ensure pending edits are rendered before serializing output            |

### 4.3 Authoring helpers

| Task                             | Details                                                             |
| -------------------------------- | ------------------------------------------------------------------- |
| [ ] Fenced-block auto-expansion  | Auto-grow ` ``` ` fences when Enter is typed at the start of a line |
| [ ] Slash commands / completions | Quick-insert common Markdown blocks and coursebook directives       |

### 4.4 Wrap, tab, and source jump

| Task             | Details                                                             |
| ---------------- | ------------------------------------------------------------------- |
| [ ] Soft wrap    | Word wrap for prose, no wrap for code blocks                        |
| [ ] Tab handling | Indent/dedent with Tab/Shift+Tab in code blocks                     |
| [ ] Source jump  | Click preview to scroll editor to the corresponding Markdown source |

---

## Phase 5: Presentation Hardening

Goal: Make presentation mode work reliably for a full lecture.

| Task                                    | Details                                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| [ ] Waypoint-only navigation            | Arrow keys only stop on marked waypoints, not every heading     |
| [ ] Spotlight on sections, not headings | Dim everything outside the current section (between waypoints)  |
| [ ] Progress indicator                  | "Section 3 of 12" overlay with current and next waypoint titles |
| [ ] Font size calibration               | Test readability from across a room; adjust present mode sizes  |
| [ ] Keyboard shortcuts sheet            | `?` shows available keys                                        |
| [ ] Black-out screen                    | `B` blanks the screen (like PowerPoint) for discussion          |

---

## Phase 6: Export Parity

Goal: The exported HTML should be a valid replacement for the BCIT course
portal — a student should be able to use it as their primary reading material.

| Task                            | Details                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| [ ] Course-level TOC in export  | Export the full hierarchical TOC as the landing page                                           |
| [ ] Per-chapter pages in export | Option to export as multi-page (one HTML per chapter) with cross-links, not just a single file |
| [ ] Indexes in export           | Fundamental concepts, figures, code samples, general index                                     |
| [ ] Course branding in export   | Header with course code/title, footer with copyright and instructor                            |
| [ ] Print-friendly CSS          | Page breaks between chapters, proper print typography                                          |
| [ ] Search in export            | Client-side full-text search across all chapters                                               |

---

## Phase 7: Authoring Experience

Goal: Make it practical to write and maintain a real course.

| Task                        | Details                                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| [x] File-based editing      | Open and edit chapter files directly from the filesystem (File System Access API) |
| [ ] Live preview on save    | Watch chapter files for changes and re-render automatically                       |
| [ ] New chapter scaffolding | Create a new chapter file with frontmatter and link it from `coursebook.md`       |
| [ ] Chapter reordering      | Drag chapters in the sidebar to reorder; update `coursebook.md`                   |
| [ ] Spell check             | Basic spell checking in the editor                                                |
| [ ] Link validation         | Check that internal chapter links and image paths resolve                         |

---

## Phase 8: Architecture Cleanup

Goal: Pay down technical debt before adding more features.

| Task                                | Details                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| [ ] Split `app.js`                  | Extract scroll-spy, chapter renderer, editor controller, menu controller into focused modules |
| [ ] Tests for navigation/scroll-spy | The bugs fixed in Phase 1 were found manually; add automated tests                            |
| [ ] Clean up `SectionNavigator`     | `wrapSections()` is dead code in coursebook mode; clarify standalone vs coursebook paths      |
| [ ] Export script tests             | Verify the built IIFE runtime boots correctly in a standalone HTML context                    |
| [ ] Layer enforcement test          | Like SlideMD's `layering-invariants.test.js` — prevent upward imports                         |

---

## Backlog

Items deferred or not yet scoped.

| Item                           | Notes                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-content unit TOC            | Auto-generated "In this Chapter" box at the top of each chapter. Dropped from Phase 2.2 — the sidebar TOC already covers this; revisit if needed    |
| Indexed terms                  | `==term==` syntax with dotted underline; collect into an alphabetical index. Dropped from Phase 2.1, revisit when index pages are built (Phase 3.3) |
| Code sample captions           | Optional `caption="..."` on code fences: "Code sample 1." Dropped from Phase 2.1, no demonstrated need yet                                          |
| AI-assisted content generation | Generate chapter drafts, exercises, quiz questions from a topic                                                                                     |
| Collaborative editing          | Multi-user real-time editing; high complexity, no demonstrated need yet                                                                             |
| LMS integration                | Export to D2L, Canvas, Moodle; depends on LMS APIs                                                                                                  |
| Version control integration    | Git-based chapter history and diff view                                                                                                             |
| Student analytics              | Track which sections students read most; requires a backend                                                                                         |
| Mobile presentation            | Touch gestures for waypoint navigation on tablets                                                                                                   |
| Accessibility audit            | Screen reader support, keyboard navigation compliance                                                                                               |
| Internationalization           | RTL languages, localized UI strings                                                                                                                 |
| Plugin system                  | Custom renderers, exporters, content transforms                                                                                                     |

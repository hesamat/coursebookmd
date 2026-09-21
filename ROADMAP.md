# CoursebookMD Roadmap

## Origin

CoursebookMD started from a simple question: can you teach a real course by
navigating headings in a continuous Markdown document, without wishing for
slides?

The thesis is that connected course material is better for students and easier
for instructors than slide-deck authoring, and that presentation is a view mode
over the coursebook — not a separate artifact.

The project is now being developed through use with real course material. The
roadmap focuses on remaining friction rather than adding features for their own
sake.

---

## Phase 9: Structural Authoring

**Goal:** Make changes to the structure of a coursebook without manually editing files and links.

Editing existing chapters works well, but adding or rearranging chapters still requires direct manipulation of the filesystem and `coursebook.md`.

| Task                        | Details                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| [ ] Create chapter          | Create a new Markdown chapter from the app and add its link to `coursebook.md`                |
| [ ] Choose chapter location | Insert a new chapter at the intended position or within an existing week/module group         |
| [ ] Reorder chapters        | Change chapter order from the coursebook UI and persist the new link order to `coursebook.md` |
| [ ] Reorder groups          | Move week/module groups while preserving their chapter membership and update `coursebook.md`  |

The Markdown files and parent document remain the source of truth; these features only provide a safer interface for modifying them.

---

## Phase 10: Cross-Browser Authoring

**Goal:** Reduce the current dependency on Chromium for filesystem-backed editing.

Chrome and Edge can open a coursebook folder with persistent read/write access through the File System Access API. Firefox and Safari currently fall back to opening the coursebook read-only.

| Task                                     | Details                                                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ ] Evaluate non-Chromium save workflows | Determine what persistent or explicit-save workflows are practical in Firefox and Safari                                                                   |
| [ ] Implement the viable fallback        | If a useful workflow exists, allow authors to edit and save without requiring Chrome/Edge                                                                  |
| [ ] Define the browser support boundary  | If equivalent filesystem editing is not practical, make the distinction between full authoring and read-only use explicit in the product and documentation |

The goal is not browser parity at any cost; it is to avoid an unnecessary browser restriction if the underlying web platform provides a reasonable alternative.

---

## Phase 11: Coursebook Structure UX

**Goal:** Make structural editing understandable and difficult to break.

Once chapter creation and reordering exist, the UI needs to make the relationship between the visual coursebook structure and `coursebook.md` predictable.

| Task                                  | Details                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [ ] Structural change preview         | Make it clear what file/link changes a chapter or group operation will make before saving           |
| [ ] Preserve unsaved chapter edits    | Structural changes must not discard edits in other chapters                                         |
| [ ] Validate after structural changes | Re-run chapter/link validation after adding, moving, or regrouping content                          |
| [ ] Undo structural mistakes          | Provide a practical way to reverse accidental structural changes within the current editing session |

---

## Phase 12: Real-Course Refinement

**Goal:** Use CoursebookMD as the primary coursebook for a real course and address recurring friction that appears in practice.

This phase does not begin with a predetermined feature list. Issues should be added here only when actual course use exposes a repeated problem in authoring, reading, teaching, or publishing.

Examples of evidence that justify a roadmap item:

- the same manual workaround is needed repeatedly
- students have difficulty finding or using material
- preparing or updating course content requires maintaining duplicate information
- a classroom workflow repeatedly interrupts teaching
- publishing requires manual cleanup or correction
- an accessibility problem prevents effective use of the coursebook

Features that are merely conventional in editors, textbooks, presentation tools, or LMS platforms are not roadmap items unless this use reveals a need for them.

---

## Deferred

These are deliberately **not** active roadmap items because there is not currently enough demonstrated need for them:

- specialized figure, code-sample, or concept indexes
- multi-page HTML export
- code sample captions
- slash commands or editor completions
- automatic fenced-block expansion
- spell checking
- LMS integration
- collaborative editing
- AI-assisted content generation
- student analytics
- version-control UI
- plugin system
- mobile presentation controls

They can return to the roadmap if real use exposes a problem they would meaningfully solve.

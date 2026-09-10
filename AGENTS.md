# Agent Instructions

User-facing documentation lives in README.md. This file contains only AI-assistant guidance for working on the codebase.

## Quick Start

For most tasks, use this loop:

1. **Understand** the request and read the relevant code.
2. **Confirm scope** — for anything bigger than one small, single-concern
   change, show the plan and wait for approval before editing (Hard Rule 8).
3. **Implement** a small, coherent change.
4. **Review** the implementation adversarially.
5. **Fix** any review findings.
6. **Run checks** — for non-trivial changes, run every command under
   [Quality Gates](#quality-gates).

   While iterating, `npm run test:e2e:fast` runs a core-flow subset of the
   browser tests (navigation, TOC, tables, editor, reading aids, source jump).
   It is a smoke check, not a substitute: the full `npm run test:e2e` is still
   required before opening a PR and is what CI runs.

   For UI/browser changes, run `npm run test:e2e:install` first if Chromium is not installed.
   For trivial changes (typo fixes, single-file config edits, pure formatting), run the relevant targeted check.

7. **Re-review** after fixes and checks.
8. **Report** what changed and whether checks passed.

- Ask the user before destructive actions, git commits/pushes, or anything with real-world side effects.
- For trivial changes, run the relevant check and report briefly.
- For non-trivial changes, use the full [Review Summary](#required-final-report).

## Hard Rules — Always On

1. **Git history and git commands are off-limits unless the user explicitly says so.**

   - Suggest the exact `git add`, `git commit`, and `git push` commands in a code block.
   - Wait for the user to run them.
   - Only execute these commands when the user explicitly says the words "commit" and/or "push".
   - The main branch is `main`; branches use `fix/`, `feature/`, `feat/`, or `refactor/` prefixes.
   - Never include a `Co-Authored-By:` trailer in commit messages.
   - Use this commit message format:

     ```bash
     git commit -m "$(cat <<'EOF'
     Concise imperative summary

     Optional detailed explanation.
     EOF
     )"
     ```

2. **Do not perform destructive, irreversible, or side-effecting actions without explicit user approval.**

   - This includes deleting files/directories, dropping database tables, force-pushing, rewriting git history, sending emails, making payments, or calling APIs with real-world side effects.
   - When in doubt, stop and ask.

3. **Do not log, write, or commit secrets, keys, or credentials.**

4. **Do not use emojis in code or communication unless the user explicitly asks for them.**

5. **Do not declare a task complete while known verification failures remain.**

6. **Never assign user-controlled or interpolated strings to `innerHTML`, `outerHTML`, or `document.write`.**
   - Prefer safe DOM construction: `document.createElement`, `textContent`, and `setAttribute`.
   - If HTML must be inserted, pass it through `DOMPurify.sanitize()` first.
   - Static string literals with no interpolation are acceptable, but prefer DOM construction when possible.

7. **Ask questions immediately when something is unclear, ambiguous, or risky — never guess scope.**

   - "Drop X" means drop exactly what is named. Neighboring features that happen to live in the same code stay unless they are explicitly included in the request.
   - If a request appears to conflict with an earlier instruction, the current plan, or the code's actual behavior, surface the conflict and ask before acting.
   - If a misunderstanding or risk is discovered mid-task, stop and report it right away — do not silently pick an interpretation and continue.

8. **Get approval before multi-part or wide-reaching work.**

   - Anything that touches more than three files, spans more than one concern,
     or that you would be tempted to group into "batches" needs a go-ahead
     first. Present the list — each item, what it changes, and what you would
     skip — and wait for the answer before editing anything.
   - Then work one item at a time and report after each one, so the user can
     stop, drop, or redirect. Never chain items silently.
   - "Fix all unless X" still requires the list and the X boundary to be
     confirmed first. Do not grow it afterwards, and do not re-interpret it.
   - If the work turns out bigger than the approved plan, stop and re-confirm
     instead of finishing it and explaining afterwards.
   - Keep internal planning vocabulary ("batch 3", "phase 2") out of final
     reports; describe the actual changes and their order.

## Context Efficiency

Optimize for useful information per token, not minimum token usage. One extra
file read is often cheaper than three edits made without it, so do not sacrifice
correctness to save tool calls.

### Progressive retrieval

Acquire context in this order. Do not advance to a later stage unless the earlier
stages are insufficient:

1. Paths, symbols, and test names the user provided.
2. Targeted search for the symbol, filename, import, or string, using the search tool.
3. The implementing file's relevant range only.
4. The test that covers it — `src/**/*.test.js` for unit, `e2e/*.spec.js` for browser.
5. Direct callers/importers of the changed symbol.
6. Broader context (README.md, the Code Organization section below) only if steps 1–5 cannot answer the question.

### Rules

- **Search before reading.** Locate a definition, caller, or test with a targeted
  search before opening files. Prefer one search with several useful terms over
  many exploratory ones, and do not repeat a search that already answered the question.
- **Do not scan the repository by default.** No recursive listings or directory
  walks to "get oriented" — the `src/` layout is documented in Code Organization.
- **Do not open a file because it is nearby or might be related.** Adjacency is not relevance.
- **Do not read a large file end to end for a small range.** Read the relevant
  sections, then expand only if that proves insufficient.
- **Do not reread what is already established.** Track the files and ranges already
  inspected; skip unchanged files unless a change makes re-reading necessary.
- **Trace dependencies flat, not recursively.** Definition → direct callers →
  covering test → stop. Follow a further dependency only when those results point at it.
- **Keep tool output small.** Use the search tool for symbol lookups — shell `rg` is not
  installed here. Never dump unrestricted listings, logs, or full-suite output; filter or
  truncate at the command level.
- **Make the smallest edit that fully solves the task.** Use localized patches, do not
  rewrite or reformat unrelated code, and preserve existing conventions.
- **Run the smallest validation that proves the change.** During development, prefer a
  targeted test/lint check, then escalate to the full [Quality Gates](#quality-gates). On
  failure, read the first useful failure and diagnose it before running more tests — do
  not rerun the whole suite while debugging, and suppress passing output:

  - one browser test — `npx playwright test e2e/<spec>.js -g "<test name>"`
  - only what failed — `npx playwright test --last-failed`
  - minimal browser output — add `--reporter=dot`
  - one unit test — `npx vitest run src/__tests__/<file>.test.js -t "<name>"`

- **Stop when you have enough.** Once the change and its likely consequences are
  identifiable with reasonable confidence, stop exploring, make the change, validate it,
  and report. Do not keep investigating "just in case."

To inspect what changed, re-read the modified ranges. Git commands remain off-limits
(Hard Rule 1), so do not reach for `git diff` without asking first.

### Reporting

Do not narrate routine exploration or paste code that is already visible in a file or
patch. Summarize findings and mention only what affects the user's decision.

## Development Workflow

For every non-trivial task: understand the request, inspect the relevant code,
implement incrementally, self-review, fix what the review finds, run the
relevant verification, re-review the affected code, then report. The
[Review & Verification Loop](#review--verification-loop--mandatory) below details
each step.

Prefer small, logically coherent changes over large speculative rewrites.

## Review & Verification Loop — MANDATORY

After implementation, perform an adversarial review before declaring the task complete.

### Phase 1 — Understand the final change

1. Re-read the original user request and acceptance criteria.
2. Inspect the complete final diff.
3. Re-read every modified file in sufficient context to understand how the change integrates with the existing code.
4. Identify all affected callers, callees, event handlers, state transitions, shared functions, public contracts, persistence paths, and UI/browser paths.

### Phase 2 — Adversarial self-review

Act as a skeptical senior engineer who did not write the change. Look specifically for:

- regressions
- incorrect assumptions
- edge cases
- broken contracts
- state/lifecycle bugs
- event-ordering problems
- async/sync problems
- error-handling problems
- unintended behavior outside the requested change
- dead code
- missing wiring
- stale or misleading comments
- changes that work in one path but break another

### Phase 3 — Fix review findings

If the review finds a legitimate problem:

1. Fix it immediately.
2. Re-read the affected code.
3. Re-check the relevant callers and surrounding behavior.
4. Continue reviewing until there are no known issues.

### Phase 4 — Verification

After self-review passes, run the [Quality Gates](#quality-gates).

For UI/browser changes:

1. First verify the actual behavior in the browser when practical.
2. Then run the relevant automated checks (`npm run test:e2e` uses Playwright; run `npm run test:e2e:install` first if Chromium is not installed).
3. If browser verification exposes a problem, fix it and repeat the review/verification loop.

## Required Final Report

When the task is complete, provide a report. For trivial changes, a brief report covering the change and the check result is enough. For non-trivial changes, use the full Review Summary below.

## Review Summary

- `Files changed:` — every modified file and its purpose.
- `Code paths traced:` — important callers, callees, and interactions checked.
- `Regression checks:` — important existing behaviors checked.
- `Dead code / wiring:` — relevant additions/removals checked.
- `Tests/checks:` — commands run and results.
- `Review result:` — `PASS` or `NEEDS_FIX`.
- `Remaining uncertainty:` — only if applicable.

## Quality Gates

```bash
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e
```

`npm run test:e2e:fast` is the during-development smoke subset (navigation, TOC,
tables, editor, reading aids, source jump). The full `npm run test:e2e` above is
the gate.

If `npm run format:check` fails:

```bash
npx prettier --write .
```

Then rerun the formatting check and any affected checks.

## Pull Requests

When a PR changes user-facing behavior, include specific manual/browser verification steps in the PR description.

Use either:

```text
## Acceptance Criteria
```

or:

```text
## Manual Verification
```

and list the exact actions to perform.

## Branch Lifecycle

- Branch prefixes: `fix/`, `feature/` (or `feat/`), `refactor/`.
- One branch per logical change, one PR per branch, short-lived.
- After a PR merges, delete the branch.
- Never push to `main` directly.

## Code Organization

### Source Structure (`src`)

- **state.js** — Single mutable application-state object (bottom layer, imports nothing)
- **core/** — Core utilities (fs, icon, theme-manager, section-numbering, utils)
- **navigator/** — Section navigation (section-navigator)
- **renderer/** — Content rendering (markdown-renderer, content-enhancer)
- **present/** — Presentation popup window (popup-main entry, popup-helpers, window-placement)
- **controllers/** — App controllers composed by app.js (coursebook-opener, chapter-renderer, editor-controller, export-controller, file-watcher, link-validation-controller, live-preview, local-assets-controller, menu-controller, present-window-controller, presentation-controller, save-controller)
- **styles/** — CSS (base, controls, layout, content, present)
- **app.js** — Application entry point and orchestrator

### Entry Points

- `index.html` — Main page
- `present.html` — Presentation popup window (fed by the main window)
- `src/app.js` — Application entry point
- `src/present/popup-main.js` — Presentation window entry point
- `vite.config.mjs` — Vite configuration

### Layering

The layer order is: **state → core → renderer → navigator → present → editor → controllers → app**.

Lower layers must never import from higher layers. `state.js` exports the one
mutable `state` object (never destructure it — access `state.x`) and imports
nothing. Controllers never import each other: `app.js` composes them via
injected dependencies and is the top-level orchestrator that wires everything
together.

## Development Guidelines

### CSS

- Use CSS custom properties (variables) defined in `base.css` for colors, spacing, typography, and sizing.
- Never hardcode colors — use `var(--text-high)`, `var(--surface-bg)`, `var(--accent)`, etc.
- Theme variants go in `base.css` under `[data-theme="dark"]` and `[data-palette="..."]` selectors.
- Content styles go in `content.css`, UI chrome in `controls.css`, layout in `layout.css`, presentation mode in `present.css`.

### JavaScript

- Use ES modules (`import`/`export`).
- Prefer DOM construction (`createElement`, `textContent`) over `innerHTML`.
- Use `async`/`await` for async operations.
- Keep functions small and focused.
- Do not add comments unless explaining non-obvious logic.

### Rendering Pipeline

The rendering pipeline is:

1. `renderMarkdown(markdown)` — markdown-it produces HTML
2. `ContentEnhancer.enhance(rootEl)` — Shiki highlighting, KaTeX math, D2/SVG diagrams, copy buttons
3. `SectionNavigator.setup()` — wraps sections, sets up heading navigation
4. `buildTOC()` — builds the table of contents with section numbering

When the theme changes, call `ContentEnhancer.rehighlight(rootEl)` to re-run Shiki with the new theme (inline styles are baked in).

## Common Tasks

### Run the dev server

```bash
npm run dev
```

### Build for production

```bash
npm run build
```

### Change the exported HTML viewer

After changing `src/export-runtime.js` (or anything it imports), run
`npm run build:export-runtime` — re-exporting otherwise silently ships the
previous viewer, which has already caused two "the exported file didn't change"
bug reports. Full detail: [docs/agent-reference.md](docs/agent-reference.md).

### Add a new UI component

1. Add the HTML markup to `index.html`.
2. Add styles to the appropriate CSS file (`controls.css` for UI chrome, `content.css` for document content, `layout.css` for layout).
3. Wire up behavior in `app.js`.
4. If icons are needed, use `data-icon="name"` placeholders and call `hydrateIcons()`.

## Reference

Material only some tasks need — adding a syntax-highlighting language, adding a
palette, changing the exported HTML viewer, and debugging rendering issues —
lives in [docs/agent-reference.md](docs/agent-reference.md).

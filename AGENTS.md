# Agent Instructions

User-facing documentation lives in README.md. This file contains only AI-assistant guidance for working on the codebase.

## Quick Start

For most tasks, use this loop:

1. **Understand** the request and read the relevant code.
2. **Implement** a small, coherent change.
3. **Review** the implementation adversarially.
4. **Fix** any review findings.
5. **Run checks** — for non-trivial changes, run all quality gates:
   - `npm run lint`
   - `npm run format:check`
   - `npm test`
   - `npm run build`
   - `npm run test:e2e`

   For UI/browser changes, run `npm run test:e2e:install` first if Chromium is not installed.
   For trivial changes (typo fixes, single-file config edits, pure formatting), run the relevant targeted check.

6. **Re-review** after fixes and checks.
7. **Report** what changed and whether checks passed.

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

## Development Workflow

For every non-trivial task, follow this loop:

```text
Understand request
      ↓
Inspect relevant code
      ↓
Implement incrementally
      ↓
Self-review
      ↓
Fix review findings
      ↓
Run relevant verification
      ↓
Fix failures
      ↓
Re-review affected code
      ↓
Final verification
      ↓
Report completion
```

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

After self-review passes, run the appropriate verification:

```bash
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e
```

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

- **core/** — Core utilities (icon, theme-manager, section-numbering, utils)
- **navigator/** — Section navigation (section-navigator)
- **renderer/** — Content rendering (markdown-renderer, content-enhancer)
- **styles/** — CSS (base, controls, layout, content, present)
- **app.js** — Application entry point and orchestrator

### Layering

The layer order is: **core → renderer → navigator → app**.

Lower layers must never import from higher layers. `app.js` is the top-level orchestrator that wires everything together.

### Entry Points

- `index.html` — Main page
- `src/app.js` — Application entry point
- `vite.config.mjs` — Vite configuration

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

### Adding a New Language for Syntax Highlighting

Add the language to the `SHIKI_LANGS` array in `src/renderer/content-enhancer.js`. Shiki bundles TextMate grammars at build time — no runtime CSS needed.

### Adding a New Palette

1. Add the palette to `PALETTES` and `PALETTE_LABELS` in `src/core/theme-manager.js`.
2. Add the CSS variables for light and dark variants in `base.css` under `[data-palette="your-palette"]`.
3. Add a swatch button in the settings modal in `index.html`.
4. Wire the button in `app.js`.

## Common Tasks

### Run the dev server

```bash
npm run dev
```

### Build for production

```bash
npm run build
```

### Add a new UI component

1. Add the HTML markup to `index.html`.
2. Add styles to the appropriate CSS file (`controls.css` for UI chrome, `content.css` for document content, `layout.css` for layout).
3. Wire up behavior in `app.js`.
4. If icons are needed, use `data-icon="name"` placeholders and call `hydrateIcons()`.

### Debug rendering issues

1. Check the browser console for errors.
2. Inspect the rendered DOM in the browser dev tools.
3. Check if `ContentEnhancer.enhance()` completed successfully (Shiki, KaTeX, D2/SVG load asynchronously).
4. Verify CSS variables are resolving (check computed styles on the target element).

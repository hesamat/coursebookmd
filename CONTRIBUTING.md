# Contributing to coursebookmd

Thanks for your interest in contributing. This guide covers the basics of setting up the project and submitting changes.

## Prerequisites

- Node.js 18+ (tested on 20 and 22)
- npm 10+

## Setup

```bash
git clone https://github.com/hesamat/coursebookmd.git
cd coursebookmd
npm install
npm run dev
```

The dev server runs at `http://127.0.0.1:8200`.

## Development Workflow

1. **Create a branch** from `main`:

   ```bash
   git checkout -b feature/your-feature
   ```

   Use `feature/`, `fix/`, or `refactor/` prefixes.

2. **Make your changes** in small, logically coherent commits.

3. **Run checks before pushing:**

   ```bash
   npm run lint
   npm run format:check
   npm run build
   ```

   If formatting fails:

   ```bash
   npm run format:write
   ```

4. **Push and open a PR:**

   ```bash
   git push -u origin feature/your-feature
   ```

   Open a pull request on GitHub. Describe what changed and why. For user-facing changes, include manual verification steps.

## Code Style

### JavaScript

- ES modules (`import`/`export`)
- `async`/`await` for async operations
- Prefer DOM construction (`createElement`, `textContent`) over `innerHTML`
- Do not add comments unless explaining non-obvious logic
- No emojis in code

### CSS

- Use CSS custom properties from `base.css` — never hardcode colors
- Theme variants go in `base.css` under `[data-theme]` and `[data-palette]` selectors
- Content styles in `content.css`, UI chrome in `controls.css`, layout in `layout.css`

### Project Structure

```
src/
├── core/           # Utilities (icon, theme-manager, section-numbering, utils)
├── navigator/      # Section navigation
├── renderer/       # Markdown rendering and content enhancement
├── styles/         # CSS (base, controls, layout, content, present)
└── app.js          # Application entry point
```

Layer order: **core → renderer → navigator → app**. Lower layers must not import from higher layers.

## Commit Messages

Use the imperative mood:

```
Add chapter sidebar navigation
Fix heading highlight on theme toggle
Remove unused Prism dependency
```

For detailed commits, use a summary line followed by a blank line and explanation:

```
Replace Prism with Shiki for syntax highlighting

Shiki produces inline-styled HTML, eliminating the need for theme CSS
and fixing ESM compatibility issues with Prism's global variable approach.
```

## Pull Requests

- One PR per branch, one logical change per PR
- Keep PRs small and reviewable
- For user-facing changes, include manual verification steps
- Do not push to `main` directly — all changes go through PRs

## Reporting Issues

Open a GitHub issue with:

1. What you expected to happen
2. What actually happened
3. Steps to reproduce
4. Browser and OS

## License

By contributing, you agree that your contributions are licensed under the MIT License.

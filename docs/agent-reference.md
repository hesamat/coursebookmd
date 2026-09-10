# Agent Reference

Reference material moved out of `AGENTS.md` so that file stays cheap to load on
every task. Read the part a task actually touches.

## Adding a new language for syntax highlighting

Add the language to the `SHIKI_LANGS` array in `src/renderer/content-enhancer.js`. Shiki bundles TextMate grammars at build time — no runtime CSS needed.

## Adding a new palette

1. Add the palette to `PALETTES` and `PALETTE_LABELS` in `src/core/theme-manager.js`.
2. Add the CSS variables for light and dark variants in `base.css` under `[data-palette="your-palette"]`.
3. Add a swatch button in the settings modal in `index.html`.
4. Wire the button in `app.js`.

## Changing the exported HTML viewer

The HTML exporter inlines `dist/export-runtime.iife.js`, which is built
separately from `src/export-runtime.js`. After changing the runtime (or
anything it imports), run `npm run build:export-runtime` — or restart
`npm run dev`, whose `predev` hook does it. Without that, re-exporting silently
ships the previous viewer, which has already caused two "the exported file
didn't change" bug reports.

Behavior that must never go stale (the mobile drawer, scroll hints) is emitted by
`coursebook-exporter.js` with the exported markup instead of living in the runtime.

This runs the whole pipeline headlessly, and rebuilds the bundle first when it
trails `src/`:

```bash
npm run export:html -- docs/coursebook.md -o /tmp/coursebook.html
```

## Debugging rendering issues

1. Check the browser console for errors.
2. Inspect the rendered DOM in the browser dev tools.
3. Check if `ContentEnhancer.enhance()` completed successfully (Shiki, KaTeX, D2/SVG load asynchronously).
4. Verify CSS variables are resolving (check computed styles on the target element).

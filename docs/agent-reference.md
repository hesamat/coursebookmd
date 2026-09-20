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

PDF export (`tools/export-pdf.mjs`, `npm run export:pdf`) imports
`exportHtmlFromMarkdown` from `tools/export-html.mjs`, so both tools share the
dev-server boot and the fresh-bundle check. The print CSS the PDF tool injects
(color fidelity, code-line layout, and the `pdf-scoped`/`pdf-include` subset
mechanism) lives in that tool only — the exporter and the viewer runtime know
nothing about it. It pins `data-theme="light"` and copies Shiki's inline light
token colors into the `--shiki-light` variables before printing: the export's
print CSS looks those up, but Shiki's dual-theme output only defines
`--shiki-dark*`, so without the copy code prints monochrome.

Unless `--no-header` is passed, the tool then stamps a running header/footer
with `pdf-lib`, reading each section's start page from the PDF outline
Chromium wrote. The load/modify/save keeps the bookmarks, internal links, and
accessibility tag tree intact (do not switch this to a page-merging approach —
merging drops them). Outputs that exclude the index section get a filtered
copy appended instead, so indexed terms always have a lookup; the stamping
reads that range from the outline's "Index" entry as well.

## Debugging rendering issues

1. Check the browser console for errors.
2. Inspect the rendered DOM in the browser dev tools.
3. Check if `ContentEnhancer.enhance()` completed successfully (Shiki, KaTeX, D2/SVG load asynchronously).
4. Verify CSS variables are resolving (check computed styles on the target element).

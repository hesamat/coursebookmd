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

Export media handling, both in `coursebook-exporter.js`:

- Raster `<img>` sources (PNG/JPEG/WebP) are re-encoded as WebP via canvas —
  quality 0.90 for PNG sources, 0.85 for JPEG — and the smaller data URI wins,
  so an image never grows. Skipped: SVG and GIF (rasterizing or re-encoding
  them would corrupt them), animated images (`acTL`/`ANIM` markers), and
  rasters under ~24 KB. Book assets are untouched; only the export differs,
  so PDF exports inherit the recompressed images.
- Inlined `@font-face` rules keep only their woff2 `src` entry when one is
  present (KaTeX otherwise ships woff2 + woff + ttf of every face); faces
  without a woff2 source are left untouched.

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

## Indexed terms

`==term==` is parsed by `indexedTermRule` in `src/renderer/markdown-renderer.js`
into `span.idx`; `==term|alias==` also sets `data-idx-alias` on the span and
renders only the term. Anchoring, grouping, and the index section live in
`src/core/indexed-terms.js` (`collectIndexedTerms`, `buildIndexSection`,
`rebuildIndexSection`); each span gets exactly one anchor even when it is
listed under several names. The app rebuilds through `rebuildIndexSection`,
the HTML exporter serializes the section's HTML, and the export viewer only
reads `.idx-link[data-target]` — so new entry shapes rarely need runtime
changes. The alias separator cannot work inside table cells (cells split on
`|` before inline parsing) and terms are never parsed inside code spans.
Each span also carries its hover data (`data-locations`, unioned across
every term listing the span) and an `aria-label` repeating the term and
locations, since data attributes are invisible to screen readers.
Scoped PDF runs get a filtered clone appended by `appendFilteredIndex` in
`tools/export-pdf.mjs`, which keeps only links whose target span is inside an
included section.

## Callout blockquotes

A blockquote whose first paragraph starts with a bold label carrying
parenthetical attributes — `**Heads up (icon=flame, color=amber):**` — becomes
a callout in `enhanceBlockquotes` (`src/renderer/content-enhancer.js`), parsed
by `parseAdmonitionAttrs`; unknown keys and values silently fall back to the
neutral look. Labels without attributes stay regular blockquotes.
`**Quote:**` is the one built-in callout: serif italic body, author named via
`by="..."` in the label attributes (rendered as the `.admonition-cite`
paragraph), or an em-dash / italic-only author paragraph gets
`.admonition-cite`. `icon=` accepts kebab-case
names from the curated set in `src/renderer/admonition-icons.js` (plus any
name registered in `src/core/icon.js`); unknown icons render no icon.
`color=` accepts a preset mapping to a CSS variable (blue, amber, green, red,
pink, violet, teal, gray) applied as an inline `--admonition-color` on the
blockquote; the rules in `src/styles/content.css` consume it (quote tints
only its frame). Custom icons are baked into exported HTML at export time, so
`src/export-runtime.js` never needs the curated set.

Curated icon names (105): anchor, atom, award, bell, binoculars, book,
book-open, bookmark, bot, box, brain, briefcase, bug, calculator, calendar,
camera, car, chart-column, check, clock, cloud, code, coffee, compass, crown,
database, download, eye, feather, file-question-mark, file-text,
fingerprint-pattern, flag, flame, footprints, gem, gift, globe,
graduation-cap, heart, help-circle, highlighter, history, hourglass, house,
image, inbox, key, languages, laptop, leaf, library, link, lock, mail, map,
map-pin, medal, megaphone, message-circle, mic, microscope, moon, mountain,
music, newspaper, palette, paperclip, paw-print, pen-tool, pencil, percent,
phone, plane, presentation, printer, puzzle, rocket, ruler, scale, scissors,
search, send, shield, shopping-cart, sprout, star, stethoscope, sun, tag,
target, telescope, thumbs-up, ticket, timer, train-front, tree-pine, trophy,
umbrella, users, watch, waypoints, wifi, wrench, zap. `history` aliases
ClockFading (Lucide dropped the old History glyph).

## Debugging rendering issues

1. Check the browser console for errors.
2. Inspect the rendered DOM in the browser dev tools.
3. Check if `ContentEnhancer.enhance()` completed successfully (Shiki, KaTeX, D2/SVG load asynchronously).
4. Verify CSS variables are resolving (check computed styles on the target element).

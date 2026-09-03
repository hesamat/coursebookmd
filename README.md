# CoursebookMD

A document-first authoring and presentation tool for course material written in Markdown.

Write connected Markdown chapters, present them with scroll-and-spotlight navigation, and publish the same content as a static HTML site for students.

## Why

Slide-based tools (PowerPoint, Keynote) force content into discrete pages, breaking the narrative thread between concepts. Students get slides they cannot read linearly. Instructors get layout work instead of content work.

CoursebookMD treats the chapter as the unit of content. You write a connected Markdown document — the same thing you would hand to a student as a reading. When you lecture, you present it with spotlight navigation that dims surrounding sections. When you publish, the same Markdown becomes a browsable HTML site.

- **Markdown rendering** — markdown-it with tables, strikethrough, and task lists
- **Syntax highlighting** — Shiki (VS Code TextMate grammars, inline styles, no theme CSS needed)
- **Math** — KaTeX for inline (`$...$`) and display (`$$...$$`) equations
- **Diagrams** — D2 for flowcharts, sequence diagrams, etc., plus raw SVG for custom visuals
- **CodeMirror editor** — syntax-highlighted Markdown editing with live preview sync, find/replace, folding, and undo/redo that survives chapter switches and walks across previously edited chapters when one chapter's history runs out
- **Live preview on save** — when a coursebook is opened from disk (Chrome/Edge), files edited and saved in an external editor are detected automatically and the preview re-renders just the changed section; unsaved in-app edits always win, and structural `coursebook.md` changes reload the coursebook
- **Indexed terms** — mark terms with `==double equals==` for a dotted underline; every occurrence is collected into a generated index with per-section links, hover tooltips ("Also in: …"), and a highlight flash when you navigate from the index
- **Link previews** — hover an external link to see a summary popup. Wikipedia links use the Wikipedia summary API; other links are fetched through r.jina.ai. Failed or sign-in-gated pages show a friendly "Preview unavailable" message instead of raw error text.
- **Link validation** — broken chapter links, missing images, and dead `#hash` targets are reported when a coursebook loads and before you save
- **Source jump** — in edit mode, clicking a heading or paragraph in the preview scrolls the editor to that line (highlighted with an accent tint)
- **Code-block Tab** — Tab/Shift+Tab indent and dedent inside fenced code blocks; Tab in prose keeps its browser focus role
- **Presentation mode** — fullscreen scroll-and-spotlight navigation with keyboard controls
- **Table of contents** — auto-generated from headings with hierarchical section numbering
- **Per-heading go-up links** — a `▲` button beside every H2 returns to the chapter top
- **Themes** — light/dark mode with three palettes (Warm Graphite, Cool Indigo, Blue Slate)
- **Settings modal** — theme and palette selection
- **Copy to clipboard** — one-click copy on every code block
- **Collapsible chapter groups** — group labels in the sidebar expand/collapse their chapters; state persists across sessions
- **Static export** — `npm run build` produces a standalone HTML site (reading aids, index, and link tooltips included)

## Quick Start

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:8200` in your browser.

## Project Structure

A coursebook is a folder with a parent Markdown file and a `chapters/` directory:

```
my-coursebook/
├── coursebook.md            # parent: course title, intro, chapter list
├── chapters/
│   ├── 01-introduction.md
│   ├── 02-variables.md
│   └── ...
└── assets/                  # images, diagrams
```

The parent `coursebook.md` is a normal Markdown file. The chapter list is a plain bullet list of links:

```markdown
# My Coursebook

Welcome to the course...

## Chapters

- [Getting Started](chapters/01-getting-started.md)
- [Writing Content](chapters/02-writing-content.md)
- [Rich Content](chapters/03-rich-content.md)
- [Present and Export](chapters/04-present-and-export.md)
```

No manifest, no JSON, no config. The link order defines the chapter order.

### Grouping chapters

An H2 or H3 heading immediately before chapter links becomes a collapsible group label in the sidebar. This lets you organize chapters into weeks, modules, or any grouping you like:

```markdown
# My Coursebook

## Chapters

### Week 1

- [Introduction](chapters/01-introduction.md)
- [Variables](chapters/02-variables.md)

### Week 2

- [Conditionals](chapters/03-conditionals.md)
- [Loops](chapters/04-loops.md)
```

Each group label is clickable — readers can collapse or expand its chapters. Collapsed state persists across sessions.

### Sample coursebook

This repo includes a sample coursebook in `docs/`:

```
docs/
├── coursebook.md            # parent file (CoursebookMD User Guide)
└── chapters/
    ├── 01-getting-started.md
    ├── 02-writing-content.md
    ├── 03-rich-content.md
    └── 04-present-and-export.md
```

The app loads `docs/coursebook.md` by default on startup.

## Development

```bash
npm run dev          # start dev server
npm run build        # build static HTML to dist/
npm run preview      # preview the build locally
npm run export:html  # export a coursebook to standalone HTML from the CLI
npm run lint            # run eslint
npm run format:check    # check formatting
npm run format:write    # fix formatting
npm run test:e2e:install # install Playwright Chromium browser
npm run test:e2e       # run Playwright end-to-end tests
```

## Link previews

CoursebookMD fetches previews for external links as soon as a coursebook loads and caches them in memory. Wikipedia links use the Wikipedia REST API; other links use the [Jina AI Reader](https://jina.ai/reader). The popup renders the summary as formatted Markdown, and sign-in or blocked pages are detected and do not produce a popup.

To pre-build a `previews.json` cache for faster loads and fewer API calls:

```bash
# Set JINA_API_KEY in .env for generic links (optional but recommended)
node --env-file=.env tools/build-previews.mjs docs/coursebook.md

# Or for a single chapter
node --env-file=.env tools/extract-previews.mjs chapters/01-introduction.md
```

The app will load `previews.json` from the coursebook directory automatically.

## Export to HTML from the CLI

Export HTML in the app produces a standalone HTML file you can share or upload (for example, to Teams). To generate the same file from the terminal:

```bash
node tools/export-html.mjs path/to/coursebook.md # writes the export to the current directory
node tools/export-html.mjs path/to/coursebook.md -o out.html
```

The script boots the dev server, opens the coursebook in headless Chromium, and saves the file produced by the app's own export action, so the output matches an in-browser export. Any `.md` file works — it does not have to be named `coursebook.md`.

## Tech Stack

| Layer               | Tool        |
| ------------------- | ----------- |
| Build               | Vite        |
| Markdown            | markdown-it |
| Syntax highlighting | Shiki       |
| Math                | KaTeX       |
| Diagrams            | D2 + SVG    |
| Icons               | Lucide      |

## Notes

- The D2 diagram runtime is lazy-loaded, so it is only downloaded when a page contains a `d2` code fence. The runtime chunk is large (~8 MB after minification) because it bundles the D2 compiler and layout engine entirely on the client.
- Exported HTML files do not re-render D2 or raw SVG diagrams when the user toggles the theme in the exported file. Diagrams are baked into the page using the theme active at export time.

## License

MIT

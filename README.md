# coursebookmd

A document-first authoring and presentation tool for course material written in Markdown.

Write connected Markdown chapters, present them with scroll-and-spotlight navigation, and publish the same content as a static HTML site for students.

## Why

Slide-based tools (PowerPoint, Keynote) force content into discrete pages, breaking the narrative thread between concepts. Students get slides they cannot read linearly. Instructors get layout work instead of content work.

coursebookmd treats the chapter as the unit of content. You write a connected Markdown document — the same thing you would hand to a student as a reading. When you lecture, you present it with spotlight navigation that dims surrounding sections. When you publish, the same Markdown becomes a browsable HTML site.

## Features

- **Markdown rendering** — markdown-it with tables, strikethrough, and task lists
- **Syntax highlighting** — Shiki (VS Code TextMate grammars, inline styles, no theme CSS needed)
- **Math** — KaTeX for inline (`$...$`) and display (`$$...$$`) equations
- **Diagrams** — Mermaid for flowcharts, sequence diagrams, etc.
- **Presentation mode** — fullscreen scroll-and-spotlight navigation with keyboard controls
- **Table of contents** — auto-generated from headings with hierarchical section numbering
- **Themes** — light/dark mode with three palettes (Warm Graphite, Cool Indigo, Blue Slate)
- **Settings modal** — theme and palette selection
- **Copy to clipboard** — one-click copy on every code block
- **Static export** — `npm run build` produces a standalone HTML site

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
# COMP 1510 — Programming Fundamentals

Welcome to the course...

## Chapters

- [Introduction](chapters/01-introduction.md)
- [Variables and Types](chapters/02-variables.md)
- [Control Flow](chapters/03-control-flow.md)
```

No manifest, no JSON, no config. The link order defines the chapter order.

### Sample coursebook

This repo includes a sample coursebook in `content/`:

```
content/
├── coursebook.md            # parent file (COMP 1510)
└── chapters/
    ├── 01-introduction.md
    ├── 02-variables.md
    └── 03-control-flow.md
```

The app loads `content/coursebook.md` by default on startup.

## Development

```bash
npm run dev          # start dev server
npm run build        # build static HTML to dist/
npm run preview      # preview the build locally
npm run lint         # run eslint
npm run format:check # check formatting
npm run format:write # fix formatting
```

## Tech Stack

| Layer               | Tool        |
| ------------------- | ----------- |
| Build               | Vite        |
| Markdown            | markdown-it |
| Syntax highlighting | Shiki       |
| Math                | KaTeX       |
| Diagrams            | Mermaid     |
| Icons               | Lucide      |

## License

MIT

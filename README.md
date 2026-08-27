# CoursebookMD

A document-first authoring and presentation tool for course material written in Markdown.

Write connected Markdown chapters, present them with scroll-and-spotlight navigation, and publish the same content as a static HTML site for students.

## Why

Slide-based tools (PowerPoint, Keynote) force content into discrete pages, breaking the narrative thread between concepts. Students get slides they cannot read linearly. Instructors get layout work instead of content work.

CoursebookMD treats the chapter as the unit of content. You write a connected Markdown document — the same thing you would hand to a student as a reading. When you lecture, you present it with spotlight navigation that dims surrounding sections. When you publish, the same Markdown becomes a browsable HTML site.

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
- **Collapsible chapter groups** — group labels in the sidebar expand/collapse their chapters; state persists across sessions
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

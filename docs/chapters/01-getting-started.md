# Getting Started

CoursebookMD turns a folder of Markdown files into a navigable coursebook. This chapter explains how to open, create, and save a coursebook.

## What is a coursebook?

A coursebook is a folder with two pieces:

- A parent `coursebook.md` file that contains the title, introduction, and a list of chapters
- A `chapters/` directory that holds one `.md` file per chapter

![Coursebook folder structure](/docs/assets/coursebook-structure.svg)

The parent file links to each chapter with a bullet list of Markdown links. Order matters: chapters appear in the sidebar in the same order they are listed.

## Opening a coursebook

The app loads `docs/coursebook.md` by default when it starts. If that file is found, the chapters listed inside it are loaded into the chapter sidebar on the left.

If no `coursebook.md` is found, the app falls back to a simple single-file editor. You can paste or type Markdown directly and see the preview update live.

## Creating a new coursebook

1. Create a folder for your coursebook.
2. Add a parent `coursebook.md` file with a `# Title`, some introduction text, and a `## Chapters` list.
3. Create a `chapters/` subdirectory.
4. Add chapter files inside `chapters/` and link to them from the parent.

Here is an example `coursebook.md`:

```markdown
# My Course

A short introduction.

## Chapters

- [First Chapter](chapters/01-first.md)
- [Second Chapter](chapters/02-second.md)
```

## Navigation

The app has three main areas: an editor on the left (toggle with **Edit**), a live preview in the center, and a chapter sidebar on the right with inline TOCs.

### Opening the editor

Click the **Edit** button in the top bar or press the editor shortcut to show the Markdown editor. You can type or paste Markdown directly and see the preview update in real time.

You can also embed remote images directly with Markdown or raw HTML. The example below uses raw HTML with inline styles so it works in any exported file without relying on app-specific classes:

<img
  src="https://www.python.org/static/img/python-logo.png"
  alt="Python logo"
  style="width: 120px; display: block; margin: 0 auto;"
/>

Once a coursebook is open, you can:

- Click a chapter in the left sidebar to jump to it
- Click a heading in the right sidebar to jump within the current chapter
- Click **Previous** or **Next** at the bottom of the page to move between chapters
- Press `Ctrl+Alt+P` (`⌘+⌃+P` on macOS) or click **Present** to toggle full-screen presentation mode

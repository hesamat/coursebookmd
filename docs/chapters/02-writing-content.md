# Writing Content

CoursebookMD uses standard Markdown. This chapter covers the most common elements: headings, lists, links, tables, and blockquotes.

## Headings

Use `#` for headings. The number of `#` characters sets the level:

```markdown
# Heading 1

## Heading 2

### Heading 3
```

The right sidebar shows `##` and `###` headings for in-chapter navigation, and headings are automatically numbered across the whole coursebook.

## Lists

Unordered lists use `-`, `*`, or `+`:

- First item
- Second item
  - Nested item
- Third item

Ordered lists use numbers:

1. Step one
2. Step two
3. Step three

Both kinds of ==lists== support ==nested items== up to three levels deep.

## Links and emphasis

You can add [links to other pages](https://en.wikipedia.org/wiki/Cat) or emphasize text with **bold** and _italic_.

### Inline code

Use backticks for file names, command flags, and other short fragments. For example, `coursebook.md` and `--help`.

### Link previews

Hovering an external link shows a popup summary. Wikipedia links use the Wikipedia API, and other public links are fetched through the Jina AI Reader. For example, try hovering [Sketch of the Analytical Engine](https://www.fourmilab.ch/babbage/sketch.html). The summary is rendered as formatted Markdown, so bold, lists, and other inline formatting appear correctly. Pages that require a sign-in or are blocked by a paywall are detected automatically and do not show a popup.

CoursebookMD fetches these previews as soon as a coursebook loads, so the popup appears instantly on hover. You can also pre-build a `previews.json` cache with `node tools/build-previews.mjs` to avoid any network calls while reading.

## Tables

| Feature     | Supported | Notes                     |
| ----------- | --------- | ------------------------- |
| Headings    | Yes       | Up to three levels        |
| Lists       | Yes       | Nested and numbered       |
| Tables      | Yes       | Standard Markdown         |
| Blockquotes | Yes       | Styled with a left border |

Compared to ==lists==, tables add a second dimension: each row can carry its own notes.

## Blockquotes

Use `>` for quoted or highlighted text:

> A Markdown coursebook should be readable in the editor and beautiful in the preview.

### Admonitions

Start a blockquote with a bold label — `**Warning:**`, `**Note:**`, `**Tip:**`, or `**Caution:**` — to render it as a styled admonition with a colored left border and tinted background:

> **Warning:** This action cannot be undone.

> **Note:** See the styling section for details.

> **Tip:** Keep your chapters short.

> **Caution:** Experimental feature.

## Mandatory headings

Prefix any heading title with `Mandatory:` to mark it as required. The heading gets a red left border and tinted background:

### Mandatory: Submit your lab

This is a live example of a mandatory heading.

## Terminal command blocks

Code fences with the `bash`, `shell`, or `sh` language render with a dark terminal theme and a `$` prompt, regardless of the app's light/dark mode:

```bash
npm install coursebookmd
```

## Figure captions

Any standalone image with alt text is automatically wrapped in a figure with a numbered caption:

![App layout diagram](/docs/assets/app-layout.svg)

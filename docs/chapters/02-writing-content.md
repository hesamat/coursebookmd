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

## Links and emphasis

You can add [links to other pages](https://example.com) or emphasize text with **bold** and _italic_.

Inline code like `CoursebookMD` is useful for short fragments.

## Tables

| Feature     | Supported | Notes                     |
| ----------- | --------- | ------------------------- |
| Headings    | Yes       | Up to three levels        |
| Lists       | Yes       | Nested and numbered       |
| Tables      | Yes       | Standard Markdown         |
| Blockquotes | Yes       | Styled with a left border |

## Blockquotes

Use `>` for quoted or highlighted text:

> A Markdown coursebook should be readable in the editor and beautiful in the preview.

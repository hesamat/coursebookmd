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

## Indexed terms

Mark a term with `==double equals==` and it gets a dotted underline plus a place in the ==index== that CoursebookMD builds automatically. This chapter has been doing it quietly: the word "lists" is marked in the Lists and Tables sections, and the index lists both spots. Hover a marked term to see where else it appears, and follow an index link to flash the term in place.

Source and effect side by side: writing `==concordance==` renders ==concordance== — once marked, the word's way into the index is already open. Aliases work the same way, and one term can carry several: `==alias|synonym|other name==` shows the word ==alias|synonym|other name== here and files this paragraph under "alias", "synonym", and "other name", all pointing at this one spot.

Try it yourself. Open the editor (`Ctrl+Alt+E`, `⌘+⌃E` on macOS), end a sentence with a `==marked term==`, and watch the index pick it up; add `|alias` inside the marks and the same spot gains a second name.

Mark purposefully: a few key terms per section are worth more than every repeated word. The index is built for a reader hunting a concept, not for a concordance of the text.

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

### Callouts

Start a blockquote with a bold label plus icon and color attributes to render it as a boxed annotation — `> **Heads up (icon=flame, color=amber):**`. The colors are blue, amber, green, red, pink, violet, teal, and gray; unknown names fall back to a neutral look. A bold label without attributes stays a regular blockquote:

> **Heads up (icon=flame, color=amber):** This action cannot be undone.

> **Remember (icon=bookmark, color=violet):** See the styling section for details.

The `icon` value is one of these 105 names:

- **Status & feedback:** `award`, `check`, `crown`, `flame`, `heart`, `medal`, `percent`, `shield`, `star`, `target`, `thumbs-up`, `trophy`, `zap`
- **Objects & everyday:** `bell`, `bookmark`, `box`, `coffee`, `feather`, `gem`, `gift`, `highlighter`, `key`, `link`, `lock`, `paperclip`, `pencil`, `puzzle`, `ruler`, `scale`, `scissors`, `shopping-cart`, `tag`
- **Time:** `calendar`, `clock`, `history`, `hourglass`, `timer`, `watch`
- **Media & communication:** `camera`, `image`, `mail`, `megaphone`, `message-circle`, `mic`, `music`, `newspaper`, `palette`, `pen-tool`, `phone`, `presentation`, `printer`, `send`
- **Places & travel:** `anchor`, `compass`, `footprints`, `globe`, `house`, `map`, `map-pin`, `moon`, `plane`, `rocket`, `telescope`, `ticket`, `train-front`, `umbrella`, `waypoints`
- **Science & nature:** `atom`, `binoculars`, `bot`, `brain`, `code`, `database`, `eye`, `fingerprint-pattern`, `leaf`, `microscope`, `mountain`, `paw-print`, `sprout`, `stethoscope`, `tree-pine`
- **Work & knowledge:** `book`, `book-open`, `briefcase`, `bug`, `calculator`, `car`, `chart-column`, `cloud`, `download`, `file-question-mark`, `file-text`, `flag`, `graduation-cap`, `help-circle`, `inbox`, `languages`, `laptop`, `library`, `search`, `sun`, `users`, `wifi`, `wrench`

Quotes are the exception — start the label with `**Quote:**` and the callout is set in a serif typeface with a gentle italic so it reads as quoted material. Name the author with `by="..."` in the label attributes, or end with an italic author line; a hand-typed em-dash line works too. Either way the attribution is set apart in the app's sans typeface:

> **Quote (by="Marie Curie"):** Nothing in life is to be feared, only understood.

> **Quote:** A Markdown coursebook should be readable in the editor and beautiful in the preview.
>
> _The CoursebookMD Team_

## Mandatory headings

Prefix any heading title with `Mandatory:` to mark it as required. The heading gets a red left border and tinted background:

### Mandatory: Submit your lab

This is a live example of a mandatory heading.

## Terminal command blocks

Code fences with the `bash`, `shell`, or `sh` language render with a `$` prompt and follow the app's light/dark mode:

```bash
npm install coursebookmd
```

## Figure captions

Any standalone image with alt text is automatically wrapped in a figure with a numbered caption:

![CoursebookMD with its chapter navigation, live preview, and Markdown editor showing the Rich Content chapter](/docs/assets/app-screenshot.png)

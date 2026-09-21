# Present and Export

Students can read the coursebook on their own, but the same material can also support teaching in the room or be exported as a portable file. This chapter covers presentation, export, and themes.

## Present to a room

One click opens a projector-friendly view of the same coursebook. Click **Present** in the floating cluster (bottom right) — or press `Ctrl+Alt+P` (`⌘+⌃+P` on macOS) — and a second window opens beside your editor. Put it on the projector display, keep the laptop for yourself, and teach from the book you wrote.

The two windows work as one:

- **The projector follows you.** Scroll or navigate in either window and the other keeps pace, anchored to the same block of content — so two differently sized screens always agree on what the room is looking at.
- **Nothing but content.** Sidebars, editor, and chrome disappear; the chapter centers itself and scales up for the back row.
- **Move at speaking pace.** The arrow keys walk the section outline, `N` / `P` jump chapters, and the overlay's Previous/Next buttons do the same — exactly like the main window.
- **Expand what matters.** Click any image, diagram, code block, or formula to blow it up full-size over a dimmed backdrop; a click closes it again.
- **Know where you are.** A slim overlay shows the current section, what comes next, and your progress ("Section 3 of 12").
- **Stagecraft, one key each.** `S` dims everything but the current section, `B` blacks the screen out for discussion (any key or click wakes it), `T` flips light/dark mid-lecture, `?` lists every shortcut, and `F` goes fullscreen — the window usually does that by itself; on macOS, keep "Displays have separate Spaces" enabled so your laptop stays usable while the projector is fullscreen.
- **When the talk is over**, press `Ctrl+Alt+P` again, press `Esc` (outside fullscreen), or simply close the window.

Chrome and Edge place the window on a second display automatically (the browser asks for permission once); other browsers open it next to your editor for you to drag into place — and remember where you put it next time.

## Export one file, carry the whole book

**Export HTML** bundles your entire coursebook into a single `.html` file that opens in any browser. No server, no install — and no JavaScript required: with scripts blocked, every chapter simply unfolds as one long, readable document.

That one file carries everything:

- all chapters, rendered with their section numbers and capped to a comfortable reading measure
- a header with the book title, a navigation toggle, and a search box
- a sidebar with the chapter list and the current chapter's contents, the active heading highlighted
- a floating action cluster with a theme button
- syntax highlighting for code in both themes (baked in, so dark mode re-skins instantly), with copy buttons
- KaTeX math and D2/SVG diagrams
- the index of marked terms, each entry linking to where the term appears
- images and diagrams that expand full-size on click or tap, over a dimmed backdrop
- reading keyboard shortcuts in a `?` sheet (arrows, `PageUp`/`PageDown`, `N` / `P` chapters, theme)

On a phone it rearranges itself for touch: the sidebar becomes a drawer that slides in from the header toggle, dims the page behind it, and closes when you pick a chapter or section, tap outside, or press Escape. Wide tables and long code lines scroll inside their own box instead of stretching the page, rows are sized for fingers, and navigation is announced to screen readers ("Writing Content. Chapter 2 of 6.").

It prints well, too: every chapter, light-colored code, one chapter per page.

## Light and dark

The theme button in the floating cluster flips between light and dark — in the app and in any export. An exported file opens with your system preference, remembers your choice for as long as it stays open, and keeps every exported book independent: darkening one never darkens another. Code ships with both themes built in, so the switch is instant. D2 and SVG diagrams keep the theme they were exported in; to make a diagram feel at home in dark mode, opt in with `dark-theme-id` in its D2 source.

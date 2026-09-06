# Present and Export

CoursebookMD is built for both reading and presenting. This chapter covers presentation mode, exporting a standalone HTML file, and switching themes.

## Presentation mode

Click the **Present** button in the floating action cluster (bottom right) or press `Ctrl+Alt+P` (`⌘+⌃+P` on macOS) to toggle presentation mode. In this mode:

- The sidebars, editor, and action cluster are hidden and the content is centered and enlarged for readability
- Use the arrow keys or on-screen controls to move between chapters
- The overlay at the bottom shows the current section, what comes next, and your progress ("Section 3 of 12")
- Press `S` to toggle spotlight dimming (or `Ctrl+Alt+S` / `⌘+⌃+S`)
- Press `B` to black out the screen for discussion; press any key or click to wake it
- Press `?` for the keyboard shortcuts sheet (it lists the shortcuts for the current mode)
- Press `Ctrl+Alt+P` (`⌘+⌃+P` on macOS) again or `Esc` to exit

Presenting takes the window fullscreen automatically, like other presentation tools — press `Esc` to leave, and exiting fullscreen (for example with `F11` or the browser's own control) also exits presentation mode.

The same presentation engine powers the exported HTML, so the keys, overlay, black-out, spotlight, and shortcuts sheet behave identically in both places.

## Exporting HTML

Click **Export HTML** to download a single `.html` file that contains:

- All chapters rendered with their section numbers, capped to a comfortable reading measure
- A header with the coursebook title and a `☰` toggle that slides the navigation sidebar in and out
- A left sidebar with the chapter list and the current chapter's table of contents (the active heading is highlighted)
- A floating action cluster with Present and theme buttons
- Syntax highlighting for code blocks in both themes
- KaTeX math and D2/SVG diagrams
- Copy buttons for code blocks
- The same presentation mode as the app, including the overlay and keyboard shortcuts sheet

The exported file works without a server — and even without JavaScript: with scripts blocked, every chapter unfolds as one sequential, readable document. It also prints well: all chapters, light-colored code, and one chapter per page.

## Themes

Use the theme button in the floating action cluster to toggle between light and dark themes. Exported files open in the viewer's own system preference (light or dark) and remember the choice until the file is closed; each exported book is independent, so toggling one never affects another.

The exported file highlights code with both themes baked in, so toggling dark mode re-skins code blocks instantly. D2 and SVG diagrams keep the export-time theme — they render light in both modes on a light panel. If you need diagrams to look native in dark mode, opt into a dark palette with `dark-theme-id` in the D2 source.

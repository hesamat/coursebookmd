# Present and Export

CoursebookMD is built for both reading and presenting. This chapter covers presentation mode, exporting a standalone HTML file, and switching themes.

## Presentation mode

Click the **Present** button in the floating action cluster (bottom right) or press `Ctrl+Alt+P` (`⌘+⌃+P` on macOS) to open a separate presentation window. The main window stays interactive for editing and navigation, and the presentation window can live on a second display (e.g. a projector) while your laptop keeps the editor.

- In Chrome/Edge, the window is placed on a second display automatically (the browser asks for permission once). Other browsers open it near the main window for you to drag into place; the position is remembered for next time.
- Scrolling either window mirrors the other: the projector follows the laptop and the laptop follows the projector, anchored to the same block of content so the two differently-sized windows stay aligned.
- The sidebars and editor are hidden and the content is centered and enlarged
- Use the arrow keys or on-screen controls to move between sections and chapters
- The overlay at the bottom shows the current section, what comes next, and your progress ("Section 3 of 12")
- Press `S` to toggle spotlight dimming
- Press `B` to black out the screen for discussion; press any key or click to wake it
- Press `T` to toggle the light/dark theme mid-presentation
- Press `?` for the keyboard shortcuts sheet
- Press `F` to toggle fullscreen. The window usually requests fullscreen automatically; on macOS, keep "Displays have separate Spaces" enabled in System Settings → Desktop & Dock so your other displays stay usable while the projector is fullscreen.
- Press `Ctrl+Alt+P` (`⌘+⌃+P` on macOS) again, `Esc` (outside fullscreen), or close the window to stop presenting

The presentation window and the exported HTML share the same navigation behaviour, so arrows, `N` / `P` chapter jumps, and the `?` shortcuts sheet feel the same in both places. The export is a read-only document: it has no presentation mode and never opens a separate window.

## Exporting HTML

Click **Export HTML** to download a single `.html` file that contains:

- All chapters rendered with their section numbers, capped to a comfortable reading measure
- A header with the coursebook title, a navigation toggle, and a search box
- A left sidebar with the chapter list and the current chapter's table of contents (the active heading is highlighted)
- A floating action cluster with a theme button
- Syntax highlighting for code blocks in both themes
- KaTeX math and D2/SVG diagrams
- Images and diagrams you can click or tap to expand full-size over a dimmed backdrop; `Esc` or a click closes the expanded view
- Copy buttons for code blocks
- Reading keyboard shortcuts, documented in a `?` sheet (arrows, `PageUp`/`PageDown`, `N` / `P` chapters, theme)

On a phone the export rearranges itself for touch: the sidebar becomes a drawer that slides in from the header toggle, dims the page behind it, and closes when you pick a chapter or section, tap outside, or press Escape. Wide tables and long code lines scroll inside their own box instead of stretching the page, chapter and section rows are sized for fingers, and navigation is announced to screen readers ("Writing Content. Chapter 2 of 6.").

The exported file works without a server — and even without JavaScript: with scripts blocked, every chapter unfolds as one sequential, readable document. It also prints well: all chapters, light-colored code, and one chapter per page.

## Themes

Use the theme button in the floating action cluster to toggle between light and dark themes. Exported files open in the viewer's own system preference (light or dark) and remember the choice until the file is closed; each exported book is independent, so toggling one never affects another.

The exported file highlights code with both themes baked in, so toggling dark mode re-skins code blocks instantly. D2 and SVG diagrams keep the export-time theme — they render light in both modes on a light panel. If you need diagrams to look native in dark mode, opt into a dark palette with `dark-theme-id` in the D2 source.

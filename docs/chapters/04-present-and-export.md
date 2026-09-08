# Present and Export

CoursebookMD is built for both reading and presenting. This chapter covers presentation mode, exporting a standalone HTML file, and switching themes.

## Presentation mode

Click the **Present** button in the floating action cluster (bottom right) or press `Ctrl+Alt+P` (`⌘+⌃+P` on macOS) to open a separate presentation window. The main window stays interactive for editing and navigation, and the presentation window can live on a second display (e.g. a projector) while your laptop keeps the editor.

- In Chrome/Edge, the window is placed on a second display automatically (the browser asks for permission once). Other browsers open it near the main window for you to drag into place; the position is remembered for next time.
- The sidebars and editor are hidden and the content is centered and enlarged
- Use the arrow keys or on-screen controls to move between sections and chapters
- The overlay at the bottom shows the current section, what comes next, and your progress ("Section 3 of 12")
- Press `S` to toggle spotlight dimming
- Press `B` to black out the screen for discussion; press any key or click to wake it
- Press `T` to toggle the light/dark theme mid-presentation
- Press `?` for the keyboard shortcuts sheet
- Press `F` to toggle fullscreen. The window usually requests fullscreen automatically; on macOS, keep "Displays have separate Spaces" enabled in System Settings → Desktop & Dock so your other displays stay usable while the projector is fullscreen.
- Press `Ctrl+Alt+P` (`⌘+⌃+P` on macOS) again, `Esc` (outside fullscreen), or close the window to stop presenting

The presentation window and the exported HTML run the same presentation engine, so the plain-key controls — arrows, `S`, `B`, `T`, `?`, `Esc` — the overlay, and the shortcuts sheet behave the same in both places.

## Exporting HTML

Click **Export HTML** to download a single `.html` file that contains:

- All chapters rendered with their section numbers, capped to a comfortable reading measure
- A header with the coursebook title; the sidebar collapses to a slim tab with a chevron at the screen edge (toggled from the sidebar's own header)
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

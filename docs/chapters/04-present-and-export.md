# Present and Export

CoursebookMD is built for both reading and presenting. This chapter covers presentation mode, exporting a standalone HTML file, and switching themes.

## Presentation mode

Click the **Present** button in the top bar or press `Ctrl+Alt+P` (`⌘+⌃+P` on macOS) to toggle full-screen presentation mode. In this mode:

- The sidebars and editor are hidden
- The content is centered and enlarged
- Use the arrow keys or on-screen controls to move between chapters
- Press `S` to toggle spotlight dimming (or `Ctrl+Alt+S` / `⌘+⌃+S`)
- Press `Ctrl+Alt+P` (`⌘+⌃+P` on macOS) again or `Esc` to exit

## Exporting HTML

Click **Export HTML** to download a single `.html` file that contains:

- All chapters rendered with their section numbers
- A left sidebar with the chapter list
- A right sidebar that shows the current chapter's table of contents
- Syntax highlighting for code blocks
- KaTeX math and D2/SVG diagrams
- Copy buttons for code blocks
- A theme toggle in the sidebar footer

The exported file works without a server. Open it in any browser and the content is fully navigable.

## Themes

Use the dark mode switch in the top bar to toggle between light and dark themes. The exported HTML has its own theme switch in the left sidebar. The coursebook content uses its own fixed palette, so it does not change when you switch the app’s accent palette.

D2 and SVG diagrams are rendered at export time using the current theme. If someone toggles the theme in the exported file, the surrounding page will change, but D2 and custom SVG diagrams will not re-render. If you need diagrams to look native in both themes, export in the theme you intend to share most often.

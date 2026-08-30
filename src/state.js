/**
 * state.js — Single mutable application-state object plus the default
 * standalone document. Holds every shared DOM reference and mutable so
 * app.js and the controllers read and write one consistent object. This is
 * the bottom of the layer graph: it must import nothing. Never destructure
 * it — always access properties via `state.x`.
 */

export const DEFAULT_CONTENT = `# Welcome to CoursebookMD

Write your course chapter in Markdown. Use **Present** to teach from it.

## Getting Started

- Edit the Markdown on the left (click **Edit**)
- The preview updates live on the right
- Press **Present** or \`Ctrl+Alt+P\` (\`⌘+⌃+P\` on macOS) to toggle presentation mode
- Use arrow keys to navigate between headings
- Press \`S\` while presenting (or \`Ctrl+Alt+S\` / \`⌘+⌃+S\`) to toggle spotlight dimming

## Features

| Feature | Status |
| ------- | ------ |
| Markdown rendering | Working |
| Code highlighting (Shiki) | Working |
| Math (KaTeX) | Working |
| Diagrams (D2 + SVG) | Working |
| Tables | Working |
| Live editor | Basic |
| Save / Open | Basic |
| Export HTML | Basic |
| Dark mode + palettes | Working |

### Code example

\`\`\`python
def greet(name):
    print(f"Hello, {name}!")

greet("COMP 1510")
\`\`\`

### Math example

The area of a rectangle: $A = w \\times h$

$$E = mc^2$$

### D2 diagram example

\`\`\`d2
direction: right

Write -> Review -> Publish
\`\`\`

### Custom SVG example

\`\`\`svg
<svg viewBox="0 0 560 200" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="560" height="200" rx="12" fill="#f8f9fa" stroke="#d1d5db" stroke-width="1" />
  <defs>
    <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#4b5563" />
    </marker>
  </defs>
  <rect x="30" y="65" width="130" height="60" rx="10" fill="#4a90d9" stroke="#2c5aa0" stroke-width="2" />
  <text x="95" y="100" text-anchor="middle" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="14" font-weight="500">Author</text>
  <path d="M 160 95 L 200 95" fill="none" stroke="#4b5563" stroke-width="2" marker-end="url(#arrowhead)" />
  <rect x="210" y="65" width="130" height="60" rx="10" fill="#5bb66d" stroke="#3a7d44" stroke-width="2" />
  <text x="275" y="100" text-anchor="middle" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="14" font-weight="500">Review</text>
  <path d="M 340 95 L 380 95" fill="none" stroke="#4b5563" stroke-width="2" marker-end="url(#arrowhead)" />
  <rect x="390" y="65" width="130" height="60" rx="10" fill="#e6a23c" stroke="#a36f1b" stroke-width="2" />
  <text x="455" y="100" text-anchor="middle" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="14" font-weight="500">Publish</text>
  <path d="M 455 125 C 455 175, 95 175, 95 125" fill="none" stroke="#4b5563" stroke-width="2" marker-end="url(#arrowhead)" />
  <text x="275" y="185" text-anchor="middle" fill="#374151" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="12">Iterate on feedback</text>
</svg>
\`\`\`

## Try It

1. Click **Edit** to show the editor pane.
2. Modify this text and watch the preview update.
3. Click **Present** to enter full-screen presentation mode.
4. Use arrow keys to navigate between sections.
5. Toggle dark mode with the switch in the top bar.
6. Switch palettes from **Settings** in the menu.
`;

export const state = {
  // ---- DOM refs ----
  contentEl: document.getElementById("content"),
  editorEl: document.getElementById("editor"),
  editorPane: document.getElementById("editorPane"),
  editorResizer: document.getElementById("editorResizer"),
  toggleEditBtn: document.getElementById("toggleEditBtn"),
  toggleEditLabel: document.getElementById("toggleEditLabel"),
  presentBtn: document.getElementById("presentBtn"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  toggleFullscreenBtn: document.getElementById("toggleFullscreenBtn"),
  menuBtn: document.getElementById("menuBtn"),
  menuDropdown: document.getElementById("menuDropdown"),
  menuOpenCoursebookBtn: document.getElementById("menuOpenCoursebookBtn"),
  menuOpenFileBtn: document.getElementById("menuOpenFileBtn"),
  menuToggleEditBtn: document.getElementById("menuToggleEditBtn"),
  menuExportHtmlBtn: document.getElementById("menuExportHtmlBtn"),
  menuSettingsBtn: document.getElementById("menuSettingsBtn"),
  overlayCurrent: document.getElementById("overlayCurrent"),
  overlayNext: document.getElementById("overlayNext"),
  overlayProgress: document.getElementById("overlayProgress"),
  tocPane: document.getElementById("tocPane"),
  tocToggleBtn: document.getElementById("tocToggleBtn"),
  settingsModal: document.getElementById("settingsModal"),
  settingsBackdrop: document.getElementById("settingsBackdrop"),
  settingsCloseBtn: document.getElementById("settingsCloseBtn"),
  settingsThemeToggle: document.getElementById("settingsThemeToggle"),
  settingsPaletteWarm: document.getElementById("settingsPaletteWarm"),
  settingsPaletteIndigo: document.getElementById("settingsPaletteIndigo"),
  settingsPaletteBlue: document.getElementById("settingsPaletteBlue"),
  chapterListEl: document.getElementById("chapterList"),
  chapterPaneTitle: document.getElementById("chapterPaneTitle"),
  chapterNav: document.getElementById("chapterNav"),
  prevChapterBtn: document.getElementById("prevChapterBtn"),
  nextChapterBtn: document.getElementById("nextChapterBtn"),
  chapterTitleEl: document.getElementById("chapterTitle"),
  previewPane: document.getElementById("previewPane"),
  openFolderModal: document.getElementById("openFolderModal"),
  openFolderBackdrop: document.getElementById("openFolderBackdrop"),
  openFolderCloseBtn: document.getElementById("openFolderCloseBtn"),
  openFolderSelectBtn: document.getElementById("openFolderSelectBtn"),
  openFolderMessage: document.getElementById("openFolderMessage"),
  saveBtn: document.getElementById("saveBtn"),
  menuSaveBtn: document.getElementById("menuSaveBtn"),
  menuSaveHint: document.getElementById("menuSaveHint"),

  // ---- Mutable app state ----
  sectionNavigator: null,
  editMode: false,
  markdownEditor: null,
  liveEditorInput: Promise.resolve(),
  currentMarkdown: DEFAULT_CONTENT,

  // Per-section EditorState cache so undo/redo history survives chapter
  // switches. Keys are String(sectionIdx) (0 = landing page, 1..N = chapters)
  // or "standalone" when no coursebook is loaded. Capped LRU: oldest entry
  // (by insertion order) is evicted beyond EDITOR_STATE_CACHE_LIMIT.
  editorStates: new Map(),
  EDITOR_STATE_CACHE_LIMIT: 30,
  // Key of the section whose state currently lives in the editor.
  currentEditorKey: null,

  // Order of chapters edited this session; lets an exhausted per-chapter undo
  // history spill into the previously edited chapter (cross-chapter undo).
  // Constructed in app.js: this module is the bottom layer and imports
  // nothing, so core/undo-trail cannot be reached from here.
  undoTrail: null,
  // One-shot flag: the next onEditorInput commit originates from an undo/redo
  // command, not from user typing, so it must not enter the trail (an undo
  // commit noted as a fresh edit would corrupt the trail's forward entries).
  suppressTrailNote: false,

  // Pending coursebook from "Open File" — stored while waiting for the user
  // to select the chapter folder via the modal.
  pendingCoursebook: null,

  // Local file handles for saving edited markdown back to disk.
  // Only populated when a coursebook is opened via the File System Access
  // API (showDirectoryPicker), which grants write access. The webkitdirectory
  // fallback cannot write, so save stays disabled in that case.
  localFileStore: null,

  // Relative paths (as keyed in localFileStore.handles) with unsaved edits.
  dirtyPaths: new Set(),

  // Object URLs for locally-loaded images, so they can be revoked on re-render.
  localImageUrls: [],

  /** @type {import("./core/coursebook-loader.js").Coursebook | null} */
  coursebook: null,
  currentChapterIdx: -1, // -1 means parent/landing page

  // Pre-loaded chapter markdowns and per-section heading/number data.
  // sectionHeadings[0] is the parent landing page, sectionHeadings[i+1] is chapter i.
  sectionMarkdowns: [],
  sectionHeadings: [],
  sectionNumbers: [],

  // Constructed in app.js, which wires it to the pieces defined there.
  scrollSpy: null,
};

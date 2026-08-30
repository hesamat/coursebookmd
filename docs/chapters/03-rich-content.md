# Rich Content

CoursebookMD can render more than plain text. This chapter shows code blocks with syntax highlighting, math with KaTeX, diagrams with D2 and raw SVG, and embedded iframes.

## Code blocks

Use triple backticks and a language name for syntax highlighting. CoursebookMD uses Shiki for code blocks.

```python
def greet(name):
    return f"Hello, {name}!"

print(greet("CoursebookMD"))
```

Each code block gets a **Copy** button in the top-right corner.

```javascript
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", next);
}
```

## Math with KaTeX

Inline math uses single dollar signs: $E = mc^2$.

Display math uses double dollar signs:

$$
\int_{a}^{b} f(x) \, dx = F(b) - F(a)
$$

You can also write multi-line equations:

$$
\sum_{i=1}^{n} x_i = x_1 + x_2 + \dots + x_n
$$

## Diagrams with D2

D2 code fences render as diagrams:

```d2
direction: right

Start: Start here
Decision: Should we proceed?
Action: Do the work
End: Done

Start -> Decision
Decision -> Action: yes
Decision -> End: no
Action -> End
```

Diagrams are rendered at 80% of the content width and capped at 75% of the viewport height so they stay readable on small screens.

## Custom SVG

For full visual control, write raw SVG code fences. The SVG is sanitized before rendering. You can define your own colors directly with `fill` and `stroke` attributes. The example below uses a fixed palette for a three-stage workflow with a feedback loop.

```svg
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
```

Replace the hex colors with your own palette to match your course.

## Iframes

CoursebookMD allows raw HTML, so you can embed iframes directly. This is useful for videos, maps, or external tools.

<iframe
  srcdoc='<h1>Hello from an iframe</h1><p>This content lives inside an inline frame.</p>'
  title="Sample iframe"
></iframe>

Use `srcdoc` for self-contained iframe content, or `src` to load an external page when the site permits embedding.

> **Note on `srcdoc`:** For security, CoursebookMD forces `sandbox=""` on any `srcdoc` iframe that does not already have a `sandbox` attribute. This makes the inline content run in a unique origin so it cannot access or influence the surrounding page. Add your own `sandbox` attribute only if you know exactly which permissions the content needs (for example, `sandbox="allow-scripts"`).

### External iframe

This example embeds a public demo page from httpbin. External `src` embeds are click-to-load: nothing is fetched until you click the placeholder.

<iframe
  src="https://httpbin.org/html"
  title="External demo page"
  loading="lazy"
></iframe>

> **Note on `src` iframes:** CoursebookMD does not automatically add `sandbox` to `src` iframes. Many embedded services (YouTube, maps, etc.) need to run scripts inside the frame, and an empty sandbox would break them. Add `sandbox` only if you specifically want to restrict the embedded site.

### Video embeds

You can embed videos from YouTube and other platforms using their embed URLs. External embeds are click-to-load — the placeholder fetches the video only when you click it, so no third-party scripts or cookies load until then.

<iframe
  src="https://www.youtube.com/embed/8mAITcNt710"
  title="Harvard CS50 — Full Computer Science University Course"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowfullscreen
></iframe>

> **Note:** Video embeds work in the live app and when the exported HTML is served over HTTP. When opening the exported file directly from disk (`file://` protocol), some browsers may block the embed for security reasons.

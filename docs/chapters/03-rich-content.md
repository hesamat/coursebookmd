# Rich Content

CoursebookMD can render more than plain text. This chapter shows code blocks with syntax highlighting, math with KaTeX, diagrams with Mermaid, and embedded iframes.

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

## Diagrams with Mermaid

Mermaid code fences render as diagrams:

```mermaid
graph LR
  A[Start] --> B{Decision}
  B -->|Yes| C[Action 1]
  B -->|No| D[Action 2]
  C --> E[End]
  D --> E
```

## Iframes

CoursebookMD allows raw HTML, so you can embed iframes directly. This is useful for videos, maps, or external tools.

<iframe
  srcdoc='<h1>Hello from an iframe</h1><p>This content lives inside an inline frame.</p>'
  title="Sample iframe"
></iframe>

Use `srcdoc` for self-contained iframe content, or `src` to load an external page when the site permits embedding.

### External iframe

This example embeds a public demo page from httpbin:

<iframe
  src="https://httpbin.org/html"
  title="External demo page"
  loading="lazy"
></iframe>

### Video embeds

You can embed videos from YouTube and other platforms using their embed URLs:

<iframe
  src="https://www.youtube.com/embed/M7lc1UVf-VE"
  title="YouTube video player"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowfullscreen
></iframe>

> **Note:** Video embeds work in the live app and when the exported HTML is served over HTTP. When opening the exported file directly from disk (`file://` protocol), some browsers may block the embed for security reasons.

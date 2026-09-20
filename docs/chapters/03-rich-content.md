# Rich Content

CoursebookMD can render more than plain text. This chapter shows code blocks with syntax highlighting, math with KaTeX, diagrams with D2 and raw SVG, and embedded iframes.

## Code blocks

Use triple backticks and a language name for syntax highlighting. CoursebookMD uses Shiki for code blocks.

```python run
def greet(name):
    return f"Hello, {name}!"

print(greet("CoursebookMD"))
```

Each code block gets a **Copy** button in the top-right corner. Fenced `python` and `javascript` blocks can also be made **runnable** by adding `run` to the fence info string: the marked block gets a **Run** button next to Copy, and the code runs entirely in your browser — nothing is sent anywhere. Python runs on WebAssembly, so the first run downloads the runtime (about 10 MB), and `input()` is not supported in the browser runner. Keep blocks that need files, packages, or the surrounding page non-runnable.

```javascript
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", next);
}
```

```javascript run
const total = [1, 2, 3, 4].reduce((sum, n) => sum + n, 0);
console.log(`Total: ${total}`);
```

REPL transcripts run too: the `>>>` prompts (and the shown output) are stripped, and only the statements execute.

```python run
>>> name = "CoursebookMD"
>>> print(f"Hello, {name}!")
Hello, CoursebookMD!
```

## Math with KaTeX

Math is written in LaTeX notation between dollar signs, and KaTeX renders it in the page. Inline math uses single dollar signs and stays inside the sentence: writing `$E = mc^2$` renders $E = mc^2$.

Display math uses double dollar signs on their own lines and gets a centered line of its own:

$$
\int_{a}^{b} f(x) dx = F(b) - F(a)
$$

A literal dollar sign is escaped with a backslash (`\$`) so it is not mistaken for the start of math: "the notebook costs \$5".

### Fractions, exponents, and roots

Fractions are written `\frac{a}{b}`, exponents and subscripts use `^` and `_`, and roots are `\sqrt`, with an optional degree in brackets. Writing `$\frac{a}{b} \leq \sqrt[3]{8}$` renders $\frac{a}{b} \leq \sqrt[3]{8}$, and display math handles the multi-part versions:

$$
\frac{a}{b} + \frac{1}{x+1} \qquad x^2 + 2x + 1 = (x+1)^2 \qquad \sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

### Symbols and Greek letters

Symbols have named commands: `\rightarrow`, `\infty`, `\approx`, `\pm`, and Greek letters like `\alpha`, `\beta`, `\pi`. Writing `$\alpha \pm \beta$` renders $\alpha \pm \beta$.

### Words inside formulas

Use `\text{...}` for words so they render upright instead of italic. Writing `$v = \frac{d}{t} \text{ where } d \text{ is distance}$` renders $v = \frac{d}{t} \text{ where } d \text{ is distance}$.

## Diagrams with D2

D2 code fences render as diagrams:

```d2 caption="Simple workflow"
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

Diagrams are rendered at up to 90% of the content width and capped at 75% of the viewport height so they stay readable on small screens.

Diagrams render with the light theme in both light and dark app modes; in dark mode they sit on a light panel so they stay readable. If you style shapes yourself, the diagram keeps your colors exactly as written. You can also opt into a dark palette for dark mode with `vars: { d2-config: { dark-theme-id: 200 } }`.

```d2 caption="Customized flowchart"
direction: right

read: Read
eval: Evaluate

read.style: { fill: "#bbdefb"; stroke: "#1976d2" }
eval.style: { fill: "#ffe0b2"; stroke: "#f57c00" }
read -> eval
```

Captions are specified as `caption="..."` in the fence info-string. Each captioned diagram gets a sequential numbered label (`Figure 1.`, `Figure 2.`) just like images.

## Custom SVG

For full visual control, write raw SVG code fences. The SVG is sanitized before rendering. You can define your own colors directly with `fill` and `stroke` attributes. The example below uses a fixed palette for a three-stage workflow with a feedback loop.

```svg caption="Three-stage workflow"
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

This example embeds a public demo page from httpbin:

<iframe
  src="https://httpbin.org/html"
  title="External demo page"
  loading="lazy"
></iframe>

> **Note on `src` iframes:** CoursebookMD does not automatically add `sandbox` to `src` iframes. Many embedded services (YouTube, maps, etc.) need to run scripts inside the frame, and an empty sandbox would break them. Add `sandbox` only if you specifically want to restrict the embedded site.

### Video embeds

You can embed videos from YouTube and other platforms using their embed URLs:

<iframe
  src="https://www.youtube.com/embed/8mAITcNt710"
  title="Harvard CS50 — Full Computer Science University Course"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowfullscreen
></iframe>

> **Note:** Video embeds work in the live app and when the exported HTML is served over HTTP. When opening the exported file directly from disk (`file://` protocol), some browsers may block the embed for security reasons.

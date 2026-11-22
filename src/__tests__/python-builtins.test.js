import { describe, it, expect } from "vitest";
import { renderMarkdown, sanitizeHtml } from "../renderer/markdown-renderer.js";
import {
  extractLinks,
  JinaReaderProvider,
  WikipediaProvider,
  previewProviders,
} from "../renderer/link-preview.js";
import { PYTHON_BUILTINS, PYTHON_DOCS_URL } from "../core/python-builtins.js";
import { parsePythonDocsHtml } from "../../tools/generate-python-docs.mjs";

describe("generated builtin docs dataset", () => {
  it("gives every builtin an anchor, official signature forms, and a summary", () => {
    const names = Object.keys(PYTHON_BUILTINS);
    expect(names.length).toBeGreaterThan(60);
    for (const [name, entry] of Object.entries(PYTHON_BUILTINS)) {
      expect(name, name).toMatch(/^[a-z_][a-z0-9_]*$/);
      expect(entry.anchor, name).toBeTruthy();
      expect(entry.anchor, name).not.toMatch(/^index-/);
      expect(Array.isArray(entry.signatures), name).toBe(true);
      expect(entry.signatures.length, name).toBeGreaterThan(0);
      for (const sig of entry.signatures) {
        expect(sig, name).toMatch(new RegExp(`^${name}\\(`));
        // The card's signature parser strips the outer parens.
        expect(sig.endsWith(")"), name).toBe(true);
      }
      expect(entry.summary, name).toBeTruthy();
      expect(entry.summary.includes("\n"), name).toBe(false);
    }
  });

  it("shows the official parameter defaults and every documented form", () => {
    expect(PYTHON_BUILTINS.print.signatures).toEqual([
      "print(*objects, sep=' ', end='\\n', file=None, flush=False)",
    ]);
    expect(PYTHON_BUILTINS.sorted.signatures[0]).toBe(
      "sorted(iterable, /, *, key=None, reverse=False)",
    );
    expect(PYTHON_BUILTINS.open.signatures[0]).toContain("mode='r'");
    expect(PYTHON_BUILTINS.open.signatures[0]).toContain("buffering=-1");
    expect(PYTHON_BUILTINS.max.signatures).toHaveLength(3);
    expect(PYTHON_BUILTINS.dict.signatures).toHaveLength(3);
    expect(PYTHON_BUILTINS.range.signatures).toEqual([
      "range(stop, /)",
      "range(start, stop, step=1, /)",
    ]);
  });

  it("uses documentation anchors where they differ from the name", () => {
    expect(PYTHON_BUILTINS.range.anchor).toBe("func-range");
    expect(PYTHON_BUILTINS.dict.anchor).toBe("func-dict");
    expect(PYTHON_BUILTINS.__import__.anchor).toBe("import__");
  });

  it("does not invent worked examples the docs page does not have", () => {
    expect(PYTHON_BUILTINS.len.example).toBeUndefined();
    expect(PYTHON_BUILTINS.zip.example).toBeUndefined();
  });
});

describe("parsePythonDocsHtml", () => {
  const html = `
    <dl class="py function">
      <dt class="sig sig-object py" id="len">
        <span class="sig-name descname"><span class="pre">len</span></span><span class="sig-paren">(</span><em class="sig-param"><span class="n"><span class="pre">object</span></span></em>, <em class="sig-param"><span class="positional-only-separator o"><span class="pre">/</span></span></em><span class="sig-paren">)</span><a class="headerlink" href="#len">¶</a>
      </dt>
      <dd><p>Return the length (the number of items) of an object.</p></dd>
    </dl>
    <dl class="py class" id="func-dict">
      <dt class="sig sig-object py"><span class="property"><span class="k"><span class="pre">class</span></span></span><span class="w"> </span><span class="sig-name descname"><span class="pre">dict</span></span><span class="sig-paren">(</span><em class="sig-param"><span class="o"><span class="pre">**</span></span><span class="n"><span class="pre">kwargs</span></span></em><span class="sig-paren">)</span></dt>
      <dt class="sig sig-object py"><span class="property"><span class="k"><span class="pre">class</span></span></span><span class="w"> </span><span class="sig-name descname"><span class="pre">dict</span></span><span class="sig-paren">(</span><em class="sig-param"><span class="n"><span class="pre">mapping</span></span></em>, <em class="sig-param"><span class="positional-only-separator o"><span class="pre">/</span></span></em><span class="sig-paren">)</span></dt>
      <dd><p>Create a new dictionary.</p></dd>
    </dl>
    <dl class="py function" id="index-2">
      <dt class="sig sig-object py" id="eval"><span class="sig-name descname"><span class="pre">eval</span></span><span class="sig-paren">(</span><em class="sig-param"><span class="n"><span class="pre">source</span></span></em><span class="sig-paren">)</span></dt>
      <dd><p>Evaluate an expression.</p></dd>
    </dl>
    <dl class="py class">
      <dt class="sig sig-object py" id="object"><span class="sig-name descname"><span class="pre">object</span></span></dt>
      <dd><p>The base class.</p></dd>
    </dl>
  `;

  it("maps anchors, class prefixes, multi-form signatures, and summaries", () => {
    const entries = parsePythonDocsHtml(html);
    expect(entries.len).toEqual({
      anchor: "len",
      signatures: ["len(object, /)"],
      summary: "Return the length (the number of items) of an object.",
    });
    expect(entries.dict.anchor).toBe("func-dict");
    expect(entries.dict.signatures).toEqual(["dict(**kwargs)", "dict(mapping, /)"]);
    expect(entries.dict.summary).toBe("Create a new dictionary.");
    // The wrapper's index-* id is not a stable docs anchor; use the dt id.
    expect(entries.eval.anchor).toBe("eval");
    // A signature without parentheses is not a callable form for a card.
    expect(entries.object).toBeUndefined();
  });
});

describe("renderMarkdown builtin links", () => {
  const render = (md) => renderMarkdown(md);

  it("wraps a bare builtin mention in a docs anchor", () => {
    const html = render("Use `len` here.");
    expect(html).toContain(`href="${PYTHON_DOCS_URL}#len"`);
    expect(html).toContain('class="doc-card"');
    expect(html).toContain('data-doc-card="python:len"');
    expect(html).toContain("<code>len</code>");
    // The existing link_open rule externalizes it too.
    expect(html).toContain('target="_blank"');
  });

  it("wraps a call form, anchoring to the function name", () => {
    const html = render("Call `len(name)` first.");
    expect(html).toContain(`href="${PYTHON_DOCS_URL}#len"`);
    expect(html).toContain("<code>len(name)</code>");
  });

  it("anchors classes to their documented ids", () => {
    const html = render("Build a `range` first.");
    expect(html).toContain(`href="${PYTHON_DOCS_URL}#func-range"`);
  });

  it("does not link trailing content (whole-call matcher)", () => {
    const html = render("`len(x) + len(y)` and `len(x).someMethod()` stay plain.");
    expect(html).not.toContain("doc-card");
    expect(html).toContain("<code>len(x) + len(y)</code>");
  });

  it("matches calls with inner whitespace and quoted parens", () => {
    expect(render("`len (x)`")).toContain('data-doc-card="python:len"');
    expect(render('`print("hi", end="")`')).toContain('data-doc-card="python:print"');
  });

  it("leaves non-builtin inline code alone", () => {
    const html = render("The `subtotal` and `for` tokens stay plain.");
    expect(html).not.toContain("doc-card");
    expect(html).toContain("<code>subtotal</code>");
  });

  it("leaves builtin mentions inside headings plain", () => {
    const html = render("# Use `len` here\n\nBut `len(x)` counts in prose.");
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.querySelector("h1")?.querySelectorAll("a")).toHaveLength(0);
    // Prose mentions in the same document still link.
    expect(container.querySelector("a.doc-card")).not.toBeNull();
  });

  it.each([
    ["an atx h2", "## Use `len` here"],
    ["a setext h1", "Use `len` here\n==="],
    ["a setext h2", "Use `len` here\n---"],
    ["a blockquote heading", "> ## Use `len` here"],
  ])("leaves builtin mentions inside %s plain", (_label, md) => {
    const html = render(md);
    expect(html).toContain("<code>len</code>");
    expect(html).not.toContain("doc-card");
    expect(html).not.toContain("<a ");
  });

  it("does not nest inside an existing link", () => {
    const html = render("[see `len`](https://example.com)");
    expect(html).not.toContain("doc-card");
    expect((html.match(/<a /g) || []).length).toBe(1);
    expect(html).toContain("<code>len</code>");
  });

  it("does not touch fenced code blocks", () => {
    const html = render("```python\nlen(x)\n```");
    expect(html).not.toContain("doc-card");
    expect(html).toContain("len(x)");
  });

  it("keeps builtin mentions through the sanitizer (export path)", () => {
    const html = sanitizeHtml(render("The `print` function prints."));
    expect(html).toContain('class="doc-card"');
    expect(html).toContain('data-doc-card="python:print"');
    expect(html).toContain(`${PYTHON_DOCS_URL}#print`);
  });

  it("excludes doc-card chips from extractLinks (no bake fetches)", () => {
    expect(extractLinks("Hover `zip` for details.")).toEqual([]);
  });

  it("still collects authored links to the same docs pages", () => {
    expect(extractLinks(`See [len](${PYTHON_DOCS_URL}#len).`)).toEqual([
      `${PYTHON_DOCS_URL}#len`,
    ]);
  });
});

describe("previewProviders", () => {
  it("holds only the network providers; doc cards resolve before the chain", () => {
    // Doc-card chips and registry URLs resolve by id/URL from the registry
    // (see link-preview.js registryEntryForLink) and never reach this chain.
    // tools/build-previews.mjs bakes from the same array; chip URLs are
    // excluded from collection entirely (extractLinks), so a docs.python.org
    // chip URL can never be baked as a network page summary again.
    expect(previewProviders).toHaveLength(2);
    expect(previewProviders[0]).toBeInstanceOf(WikipediaProvider);
    expect(previewProviders[1]).toBeInstanceOf(JinaReaderProvider);
  });
});

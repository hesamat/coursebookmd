import { describe, it, expect } from "vitest";
import { renderMarkdown, sanitizeHtml } from "../renderer/markdown-renderer.js";
import {
  extractLinks,
  PythonDocsProvider,
  JinaReaderProvider,
  WikipediaProvider,
  previewProviders,
} from "../renderer/link-preview.js";
import {
  PYTHON_BUILTINS,
  PYTHON_DOCS_URL,
  builtinDocHref,
  builtinForAnchor,
} from "../core/python-builtins.js";
import { parsePythonDocsHtml } from "../../tools/generate-python-docs.mjs";

const hrefFor = (anchor) => `${PYTHON_DOCS_URL}#${anchor}`;

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

  it("resolves anchors and legacy name anchors to the same entry", () => {
    expect(builtinForAnchor("func-range")).toBe(PYTHON_BUILTINS.range);
    expect(builtinForAnchor("range")).toBe(PYTHON_BUILTINS.range);
    expect(builtinForAnchor("import__")).toBe(PYTHON_BUILTINS.__import__);
    expect(builtinForAnchor("nope")).toBeNull();
    expect(builtinForAnchor("constructor")).toBeNull();
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

describe("builtinDocHref", () => {
  it("matches a bare builtin name", () => {
    expect(builtinDocHref("len")).toBe(hrefFor("len"));
    expect(builtinDocHref(" len ")).toBe(hrefFor("len"));
  });

  it("matches call forms, including nested calls", () => {
    expect(builtinDocHref("len()")).toBe(hrefFor("len"));
    expect(builtinDocHref("len(name)")).toBe(hrefFor("len"));
    expect(builtinDocHref('print("hi", end="")')).toBe(hrefFor("print"));
  });

  it("uses the documentation anchor for classes and dunders", () => {
    expect(builtinDocHref("range")).toBe(hrefFor("func-range"));
    expect(builtinDocHref("dict(zip(a, b))")).toBe(hrefFor("func-dict"));
    expect(builtinDocHref("__import__")).toBe(hrefFor("import__"));
  });

  it("rejects partial words, keywords, and non-mention spans", () => {
    expect(builtinDocHref("lenx")).toBeNull();
    expect(builtinDocHref("my_len()")).toBeNull();
    expect(builtinDocHref("for")).toBeNull();
    expect(builtinDocHref("")).toBeNull();
    expect(builtinDocHref("len(x) > 0")).toBeNull();
    expect(builtinDocHref("range")).not.toBeNull();
  });
});

describe("renderMarkdown builtin links", () => {
  const render = (md) => renderMarkdown(md);

  it("wraps a bare builtin mention in a docs anchor", () => {
    const html = render("Use `len` here.");
    expect(html).toContain(`href="${PYTHON_DOCS_URL}#len"`);
    expect(html).toContain('class="builtin-doc"');
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

  it("leaves non-builtin inline code alone", () => {
    const html = render("The `subtotal` and `for` tokens stay plain.");
    expect(html).not.toContain("builtin-doc");
    expect(html).toContain("<code>subtotal</code>");
  });

  it("leaves builtin mentions inside headings plain", () => {
    const html = render("# Use `len` here\n\nBut `len(x)` counts in prose.");
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.querySelector("h1")?.querySelectorAll("a")).toHaveLength(0);
    // Prose mentions in the same document still link.
    expect(container.querySelector("a.builtin-doc")).not.toBeNull();
  });

  it.each([
    ["an atx h2", "## Use `len` here"],
    ["a setext h1", "Use `len` here\n==="],
    ["a setext h2", "Use `len` here\n---"],
    ["a blockquote heading", "> ## Use `len` here"],
  ])("leaves builtin mentions inside %s plain", (_label, md) => {
    const html = render(md);
    expect(html).toContain("<code>len</code>");
    expect(html).not.toContain("builtin-doc");
    expect(html).not.toContain("<a ");
  });

  it("does not nest inside an existing link", () => {
    const html = render("[see `len`](https://example.com)");
    expect(html).not.toContain("builtin-doc");
    expect((html.match(/<a /g) || []).length).toBe(1);
    expect(html).toContain("<code>len</code>");
  });

  it("does not touch fenced code blocks", () => {
    const html = render("```python\nlen(x)\n```");
    expect(html).not.toContain("builtin-doc");
    expect(html).toContain("len(x)");
  });

  it("keeps builtin mentions through the sanitizer (export path)", () => {
    const html = sanitizeHtml(render("The `print` function prints."));
    expect(html).toContain("builtin-doc");
    expect(html).toContain(`${PYTHON_DOCS_URL}#print`);
  });

  it("exposes builtin links to extractLinks (preview pipeline)", () => {
    expect(extractLinks("Hover `zip` for details.")).toEqual([`${PYTHON_DOCS_URL}#zip`]);
  });
});

describe("PythonDocsProvider", () => {
  const provider = new PythonDocsProvider();

  it("handles known builtin anchors on the functions page", () => {
    expect(provider.canHandle(hrefFor("len"))).toBe(true);
    expect(provider.canHandle(hrefFor("func-range"))).toBe(true);
  });

  it("accepts legacy page paths and bare-name anchors", () => {
    expect(
      provider.canHandle("https://docs.python.org/3/library/functions.html#len"),
    ).toBe(true);
    expect(provider.canHandle(hrefFor("range"))).toBe(true);
  });

  it("rejects unknown names, other pages, other hosts", () => {
    expect(provider.canHandle(hrefFor("not-a-builtin"))).toBe(false);
    expect(
      provider.canHandle("https://docs.python.org/3/library/stdtypes.html#len"),
    ).toBe(false);
    expect(provider.canHandle(PYTHON_DOCS_URL)).toBe(false);
    expect(provider.canHandle("https://example.com/#len")).toBe(false);
    expect(provider.canHandle("not a url")).toBe(false);
  });

  it("resolves a preview from the generated dataset with no network", async () => {
    const preview = await provider.fetchPreview(hrefFor("len"));
    expect(preview).toEqual({
      title: "len(object, /)",
      signatureLines: ["len(object, /)"],
      summary: PYTHON_BUILTINS.len.summary,
      image: null,
      url: hrefFor("len"),
      domain: "docs.python.org",
    });
  });

  it("carries every signature form for multi-form builtins", async () => {
    const preview = await provider.fetchPreview(hrefFor("func-range"));
    expect(preview.signatureLines).toEqual(PYTHON_BUILTINS.range.signatures);
    expect(preview.title).toBe("range(stop, /)");
    expect(preview.example).toBeUndefined();
  });

  it("resolves dunder anchors to the right card", async () => {
    const preview = await provider.fetchPreview(hrefFor("import__"));
    expect(preview.title).toBe(
      "__import__(name, globals=None, locals=None, fromlist=(), level=0)",
    );
  });

  it("returns null for an unknown name and is always available", async () => {
    expect(await provider.fetchPreview(hrefFor("nope"))).toBeNull();
    expect(provider.isAvailable()).toBe(true);
  });

  it("leads the shared provider chain that preview builders bake from", () => {
    // tools/build-previews.mjs resolves exports through this same array; if
    // the docs provider ever stops leading it, every builtin chip in an
    // exported book bakes a whole-page network summary over its own card.
    expect(previewProviders[0]).toBeInstanceOf(PythonDocsProvider);
    expect(previewProviders[1]).toBeInstanceOf(WikipediaProvider);
    expect(previewProviders[2]).toBeInstanceOf(JinaReaderProvider);
  });
});

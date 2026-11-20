import { describe, it, expect } from "vitest";
import { renderMarkdown, sanitizeHtml } from "../renderer/markdown-renderer.js";
import {
  extractLinks,
  JinaReaderProvider,
  previewProviders,
  PythonDocsProvider,
  WikipediaProvider,
} from "../renderer/link-preview.js";
import {
  PYTHON_BUILTINS,
  PYTHON_DOCS_URL,
  builtinDocHref,
} from "../core/python-builtins.js";

describe("builtin docs dataset", () => {
  it("gives every builtin official signature forms and a one-line summary", () => {
    const names = Object.keys(PYTHON_BUILTINS);
    expect(names.length).toBeGreaterThan(20);
    for (const [name, entry] of Object.entries(PYTHON_BUILTINS)) {
      expect(name, name).toMatch(/^[a-z_][a-z0-9_]*$/);
      expect(Array.isArray(entry.signatures), name).toBe(true);
      expect(entry.signatures.length, name).toBeGreaterThan(0);
      for (const sig of entry.signatures) {
        expect(sig, name).toMatch(new RegExp(`^${name}\\(`));
        // The card's signature parser strips the outer parens.
        expect(sig.endsWith(")"), name).toBe(true);
      }
      if (entry.example !== undefined) {
        expect(typeof entry.example, name).toBe("string");
        expect(entry.example.includes("\n"), name).toBe(false);
        expect(entry.example, name).toContain("→");
      }
      expect(entry.summary, name).toBeTruthy();
      expect(entry.summary.includes("\n"), name).toBe(false);
    }
  });

  it("shows the official parameter defaults", () => {
    expect(PYTHON_BUILTINS.print.signatures).toEqual([
      "print(*objects, sep=' ', end='\\n', file=None, flush=False)",
    ]);
    expect(PYTHON_BUILTINS.open.signatures[0]).toContain("mode='r'");
    expect(PYTHON_BUILTINS.open.signatures[0]).toContain("buffering=-1");
    expect(PYTHON_BUILTINS.sorted.signatures[0]).toContain("key=None");
    expect(PYTHON_BUILTINS.round.signatures[0]).toBe("round(number, ndigits=None)");
  });

  it("keeps every documented form for multi-form builtins", () => {
    expect(PYTHON_BUILTINS.max.signatures).toHaveLength(3);
    expect(PYTHON_BUILTINS.range.signatures).toEqual([
      "range(stop, /)",
      "range(start, stop, step=1, /)",
    ]);
  });

  it("orders forms reader-first and curates examples", () => {
    // The form a student actually uses leads the card.
    expect(PYTHON_BUILTINS.dir.signatures[0]).toBe("dir(object, /)");
    expect(PYTHON_BUILTINS.help.signatures[0]).toBe("help(request)");
    // Examples only where the description alone stays abstract.
    for (const name of [
      "enumerate",
      "isinstance",
      "map",
      "range",
      "round",
      "sum",
      "zip",
    ]) {
      expect(PYTHON_BUILTINS[name].example, name).toBeTruthy();
    }
    for (const name of [
      "len",
      "print",
      "sorted",
      "str",
      "open",
      "bool",
      "chr",
      "int",
      "list",
    ]) {
      expect(PYTHON_BUILTINS[name].example, name).toBeUndefined();
    }
  });

  it("covers the builtins the coursebook mentions most", () => {
    for (const name of ["len", "print", "range", "input", "int", "zip", "sorted"]) {
      expect(PYTHON_BUILTINS[name], name).toBeDefined();
    }
  });
});

describe("builtinDocHref", () => {
  const hrefFor = (name) => `${PYTHON_DOCS_URL}#${name}`;

  it("matches a bare builtin name", () => {
    expect(builtinDocHref("len")).toBe(hrefFor("len"));
    expect(builtinDocHref(" len ")).toBe(hrefFor("len"));
  });

  it("matches call forms, including nested calls", () => {
    expect(builtinDocHref("len()")).toBe(hrefFor("len"));
    expect(builtinDocHref("len(name)")).toBe(hrefFor("len"));
    expect(builtinDocHref('print("hi", end="")')).toBe(hrefFor("print"));
    expect(builtinDocHref("dict(zip(a, b))")).toBe(hrefFor("dict"));
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

  it("leaves non-builtin inline code alone", () => {
    const html = render("The `subtotal` and `for` tokens stay plain.");
    expect(html).not.toContain("builtin-doc");
    expect(html).toContain("<code>subtotal</code>");
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
    expect(provider.canHandle(`${PYTHON_DOCS_URL}#len`)).toBe(true);
  });

  it("rejects unknown names, other pages, other hosts", () => {
    expect(provider.canHandle(`${PYTHON_DOCS_URL}#not-a-builtin`)).toBe(false);
    expect(
      provider.canHandle("https://docs.python.org/3/library/stdtypes.html#len"),
    ).toBe(false);
    expect(provider.canHandle("https://docs.python.org/3/library/functions.html")).toBe(
      false,
    );
    expect(provider.canHandle("https://example.com/#len")).toBe(false);
    expect(provider.canHandle("not a url")).toBe(false);
  });

  it("resolves a preview from the local dataset with no network", async () => {
    const preview = await provider.fetchPreview(`${PYTHON_DOCS_URL}#len`);
    expect(preview).toEqual({
      title: "len(object, /)",
      signatureLines: ["len(object, /)"],
      summary: PYTHON_BUILTINS.len.summary,
      image: null,
      url: `${PYTHON_DOCS_URL}#len`,
      domain: "docs.python.org",
    });
  });

  it("carries every signature form for multi-form builtins", async () => {
    const preview = await provider.fetchPreview(`${PYTHON_DOCS_URL}#range`);
    expect(preview.signatureLines).toEqual(PYTHON_BUILTINS.range.signatures);
    expect(preview.title).toBe("range(stop, /)");
    expect(preview.example).toBe(PYTHON_BUILTINS.range.example);
  });

  it("returns null for an unknown name and is always available", async () => {
    expect(await provider.fetchPreview(`${PYTHON_DOCS_URL}#nope`)).toBeNull();
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

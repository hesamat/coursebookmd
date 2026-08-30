import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

// state -> core -> renderer -> navigator -> editor -> controllers -> app
// (AGENTS.md). `editor/` is not listed there but is wired in directly by the
// top-level orchestrators, so it sits just below the controllers. An
// unmapped directory fails the scan test on purpose.
const LAYER_RANK = {
  state: 0,
  core: 1,
  renderer: 2,
  navigator: 3,
  editor: 4,
  controllers: 5,
  top: 6,
};

const REQUIRED_FILES = [
  "app.js",
  "export-runtime.js",
  "controllers/file-watcher.js",
  "controllers/menu-controller.js",
  "core/nav-groups.js",
  "core/utils.js",
  "editor/codemirror/editor-theme.js",
  "editor/markdown-editor.js",
  "navigator/section-navigator.js",
  "renderer/content-enhancer.js",
  "renderer/coursebook-exporter.js",
  "renderer/markdown-renderer.js",
  "state.js",
];

// Static `import ... from`, bare `import "..."`, and `export ... from`,
// including multi-line forms. The binding part only accepts word characters,
// braces, commas, whitespace, and `*`, so a match cannot span statements.
const IMPORT_RE = /\b(?:import|export)\s+(?:[\w$*{},\s]+?\s+from\s+)?["']([^"']+)["']/g;

function listSourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        files.push(join(dir, entry.name));
      }
    }
  };
  walk(SRC_ROOT);
  return files.sort();
}

// Returns the layer NAME so lookups stay consistent (a rank number here would
// make LAYER_RANK[layer] a double lookup that silently yields undefined).
function layerOf(pathFromSrc) {
  if (!pathFromSrc) return undefined;
  const segments = pathFromSrc.split("/");
  if (segments.length === 1) return "top";
  const first = segments[0];
  return Object.hasOwn(LAYER_RANK, first) ? first : undefined;
}

function extractRelativeImports(file) {
  const code = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => {
      // Drop whole-line comments: JSDoc usage examples read as imports
      // otherwise (e.g. the `import { icon } from ...` example in icon.js).
      const trimmed = line.trimStart();
      return !(
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*")
      );
    })
    .join("\n");

  const imports = [];
  for (const match of code.matchAll(IMPORT_RE)) {
    const spec = match[1].split("?")[0];
    if (!spec.startsWith(".")) continue;
    const target = resolve(dirname(file), spec);
    const fromSrc = relative(SRC_ROOT, target).split(sep).join("/");
    // Imports resolving outside src (e.g. ?raw dist bundles) carry no layer.
    if (!fromSrc.startsWith("..")) imports.push({ spec, fromSrc });
  }
  return imports;
}

function buildGraph() {
  return listSourceFiles().map((file) => {
    const fromSrc = relative(SRC_ROOT, file).split(sep).join("/");
    return {
      fromSrc,
      layer: layerOf(fromSrc),
      imports: extractRelativeImports(file),
    };
  });
}

describe("layering invariants", () => {
  const graph = buildGraph();

  it("maps every scanned source file to a known layer", () => {
    const unmapped = graph
      .filter((node) => node.layer === undefined)
      .map((node) => node.fromSrc);
    expect(
      unmapped,
      "every src/**/*.js file (except src/__tests__/) must map to a known layer; " +
        "add the new directory to LAYER_RANK",
    ).toEqual([]);

    const missing = REQUIRED_FILES.filter(
      (path) => !graph.some((node) => node.fromSrc === path),
    );
    expect(
      missing,
      "scan is missing expected files, which could let the other checks pass vacuously",
    ).toEqual([]);
  });

  it("never imports from a higher layer", () => {
    const violations = [];
    for (const node of graph) {
      if (node.layer === undefined) continue;
      for (const { spec, fromSrc } of node.imports) {
        const targetLayer = layerOf(fromSrc);
        if (targetLayer === undefined) {
          violations.push(
            `${node.fromSrc} -> ${spec} (target ${fromSrc} has no mapped layer)`,
          );
        } else if (LAYER_RANK[targetLayer] > LAYER_RANK[node.layer]) {
          violations.push(
            `${node.fromSrc} -> ${fromSrc} (${node.layer} -> ${targetLayer})`,
          );
        }
      }
    }
    expect(violations, "found imports from a lower layer to a higher layer").toEqual([]);
  });

  it("keeps lower layers free of imports from higher-layer locations", () => {
    // Explicit restatement of the per-layer rules; `editor/` and
    // `controllers/` extend the list from AGENTS.md because they also sit
    // below top.
    const FORBIDDEN = [
      {
        layer: "state",
        forbids: ["core", "renderer", "navigator", "editor", "controllers", "top"],
      },
      {
        layer: "core",
        forbids: ["renderer", "navigator", "editor", "controllers", "top"],
      },
      { layer: "renderer", forbids: ["navigator", "editor", "controllers", "top"] },
      { layer: "navigator", forbids: ["editor", "controllers", "top"] },
      { layer: "editor", forbids: ["controllers", "top"] },
      { layer: "controllers", forbids: ["top"] },
    ];

    const violations = [];
    for (const node of graph) {
      const rule = FORBIDDEN.find((entry) => entry.layer === node.layer);
      if (!rule) continue;
      for (const { fromSrc } of node.imports) {
        const targetLayer = layerOf(fromSrc);
        if (rule.forbids.includes(targetLayer)) {
          violations.push(
            `${node.fromSrc} -> ${fromSrc} (${node.layer} -> ${targetLayer})`,
          );
        }
      }
    }
    expect(violations, "a lower layer imports a layer it must never depend on").toEqual(
      [],
    );
  });
});

/**
 * Doc cards: a registry of code-span mentions that preview a local
 * documentation card instead of acting as an ordinary link.
 *
 * Every source feeds this one registry — the generated Python pack today,
 * author glossaries (doc-cards.md) from PR 3 onward. One matcher, one
 * resolution path, one snapshot: the renderer rule, the hover layer, the
 * exporter, and the exported viewer all read this module, so baked data can
 * never diverge from what rendering emitted (the PR #126 bug class).
 *
 * Book entries beat pack entries per match string (documented override);
 * duplicates within one precedence level are build errors. Export must stay
 * deterministic, so registry iteration order is sorted and never object
 * insertion order.
 */
import { PYTHON_BUILTINS, PYTHON_DOCS_URL } from "./python-builtins.js";
import { slugifyForId } from "./utils.js";

/**
 * @typedef {Object} DocCardEntry
 * @property {string} id Namespaced id (`python:len`, `book:count`).
 * @property {string} name Display name; the default exact match.
 * @property {string} url Absolute http(s) URL the chip points at.
 * @property {string[]} matches Exact match strings (name plus author extras).
 * @property {string[]} signatures Official signature forms, empty for terms.
 * @property {string} summary Card body text.
 * @property {string} [example] Optional call → result example line.
 * @property {"docs"|"term"} kind Signature-strip card vs plain-title card.
 * @property {string} group Source pack name or "book".
 */

// Call forms (`len(x)`) are generated only for identifier-ish names, so an
// entry literally named `COUNT(*)` gets exact matches only and can never
// produce `COUNT(*)(...)`.
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*$/;

/** Which named packs the registry includes, in build order. */
const KNOWN_PACKS = ["python"];

/**
 * The generated Python pack, normalized to the shared entry shape. The
 * dataset itself is produced by tools/generate-python-docs.mjs; this only
 * maps its `{anchor, signatures, summary}` records.
 */
function pythonPackEntries() {
  return Object.entries(PYTHON_BUILTINS).map(([name, entry]) => ({
    name,
    url: `${PYTHON_DOCS_URL}#${entry.anchor}`,
    matches: [name],
    signatures: entry.signatures,
    summary: entry.summary,
  }));
}

function docCardId(group, name) {
  const slug = slugifyForId(name).replace(/-+/g, "-");
  // slugifyForId falls back to a counter for unusable names; a doc-card id
  // must be stable across builds, so an unusable name is a build error.
  return /^[\w-]+$/.test(slug) ? `${group}:${slug}` : null;
}

/** An http(s) URL is required; anything else is a build error. */
function validateEntryUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return null;
    return `unsupported URL scheme "${parsed.protocol}"`;
  } catch {
    return "not an absolute URL";
  }
}

/**
 * Validate and normalize one raw entry. Returns `{ entry }` or
 * `{ error: string }`; `source` is quoted verbatim in error messages.
 */
export function normalizeEntry(raw, { group, source = "entry" }) {
  const fail = (problem) => ({ error: `${source}: ${problem}` });
  if (!raw || typeof raw !== "object") return fail("entry is not an object");
  if (typeof raw.name !== "string" || !raw.name.trim()) return fail("missing name");
  const name = raw.name.trim();
  if (typeof raw.url !== "string" || !raw.url.trim()) return fail(`${name}: missing url`);
  const urlProblem = validateEntryUrl(raw.url.trim());
  if (urlProblem) return fail(`${name}: ${urlProblem}`);
  if (typeof raw.summary !== "string" || !raw.summary.trim())
    return fail(`${name}: missing summary`);

  const id = docCardId(group, name);
  if (!id) return fail(`${name}: name does not produce a usable id`);

  const signatures = Array.isArray(raw.signatures)
    ? raw.signatures.filter((s) => typeof s === "string" && s.trim())
    : [];
  const matches = [name];
  if (Array.isArray(raw.matches)) {
    for (const match of raw.matches) {
      if (typeof match === "string" && match.trim() && !matches.includes(match.trim())) {
        matches.push(match.trim());
      }
    }
  }

  /** @type {DocCardEntry} */
  const entry = {
    id,
    name,
    url: raw.url.trim(),
    matches,
    signatures,
    summary: raw.summary.trim(),
    kind: signatures.length ? "docs" : "term",
    group,
  };
  if (typeof raw.example === "string" && raw.example.trim()) {
    entry.example = raw.example.trim();
  }
  return { entry };
}

/**
 * Build the registry snapshot. `packs` selects named pack sources (default:
 * the Python pack), `bookEntries` are author-provided raw entries that
 * override pack matches. The result is plain data — safe to JSON-embed —
 * with `errors` (must block export) and `warnings` (visible diagnostics).
 *
 * @returns {{ entries: DocCardEntry[], exactMap: Map<string, DocCardEntry>,
 *   callNames: Map<string, DocCardEntry>, urlMap: Map<string, DocCardEntry>,
 *   idMap: Map<string, DocCardEntry>, errors: string[], warnings: string[] }}
 */
export function buildRegistry({ packs = KNOWN_PACKS, bookEntries = [] } = {}) {
  const registry = emptyRegistry();

  const addEntry = (entry, level) => {
    if (registry.idMap.has(entry.id)) {
      registry.errors.push(`duplicate doc card id "${entry.id}"`);
      return;
    }
    // A book entry over a pack match is a documented override, applied
    // silently; the map simply re-points at the winning entry. A conflict
    // within one precedence level is a build error and that match is dropped.
    const matches = entry.matches.filter((match) => {
      const existing = registry.exactMap.get(match);
      if (existing && existing.group === level) {
        registry.errors.push(
          `doc card match "${match}" is claimed by both "${existing.id}" and "${entry.id}"`,
        );
        return false;
      }
      return true;
    });
    indexEntry(registry, { ...entry, matches });
  };

  if (packs.includes("python")) {
    for (const raw of pythonPackEntries()) {
      const result = normalizeEntry(raw, { group: "python" });
      if (result.error) registry.errors.push(result.error);
      else addEntry(result.entry, "python");
    }
  }

  for (const raw of bookEntries) {
    const result = normalizeEntry(raw, { group: "book" });
    if (result.error) registry.errors.push(result.error);
    else addEntry(result.entry, "book");
  }

  return finalizeRegistry(registry);
}

function emptyRegistry() {
  return {
    entries: [],
    exactMap: new Map(),
    callNames: new Map(),
    urlMap: new Map(),
    idMap: new Map(),
    errors: [],
    warnings: [],
  };
}

function indexEntry(registry, entry) {
  registry.idMap.set(entry.id, entry);
  registry.entries.push(entry);
  for (const match of entry.matches) {
    registry.exactMap.set(match, entry);
  }
  if (IDENTIFIER_PATTERN.test(entry.name)) {
    registry.callNames.set(entry.name, entry);
  }
  if (!registry.urlMap.has(entry.url)) {
    registry.urlMap.set(entry.url, entry);
  } else {
    registry.warnings.push(
      `doc card url "${entry.url}" is shared by "${registry.urlMap.get(entry.url).id}" and "${entry.id}"`,
    );
  }
}

function finalizeRegistry(registry) {
  // Sorted iteration keeps chip emission and export bytes deterministic.
  registry.entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return registry;
}

/**
 * Rebuild lookup maps from already-normalized entries — the export payload
 * path: buildHtmlDocument embeds `entries`, the exported viewer rehydrates.
 * Trusted input; it was validated when the registry was built. Book entries
 * are indexed after pack entries so their per-match override survives the
 * round-trip even though the embedded list is sorted by id.
 */
export function hydrateRegistry(entries) {
  const registry = emptyRegistry();
  const list = (entries ?? []).filter((e) => e && typeof e === "object");
  for (const entry of list) {
    if (entry.group !== "book") indexEntry(registry, entry);
  }
  for (const entry of list) {
    if (entry.group === "book") indexEntry(registry, entry);
  }
  return finalizeRegistry(registry);
}

export function getDocCardById(id) {
  if (typeof id !== "string" || !id) return null;
  return getActiveDocCards().idMap.get(id) ?? null;
}

export function getDocCardByUrl(url) {
  if (typeof url !== "string" || !url) return null;
  return getActiveDocCards().urlMap.get(url) ?? null;
}

// ---- Active snapshot ----
// One snapshot per render/export epoch. Live changes (PR 3) build a new
// registry and re-render; tests reset between cases.

let activeRegistry = null;

export function setActiveDocCards(registry) {
  activeRegistry = registry;
}

export function getActiveDocCards() {
  if (!activeRegistry) activeRegistry = buildRegistry();
  return activeRegistry;
}

export function resetDocCardsForTests() {
  activeRegistry = null;
}

/**
 * The entry an inline code span should link to, or null. A mention is the
 * exact match string, or an identifier-ish name followed by one whole call:
 * `len`, `len()`, `len(f(x))`, `len("a(b)")` match; `len(x) + len(y)`,
 * `len(x).someMethod()`, and `len(unclosed` fail closed.
 */
export function matchDocCard(codeText) {
  if (typeof codeText !== "string" || !codeText.trim()) return null;
  const registry = getActiveDocCards();
  const text = codeText.trim();
  const exact = registry.exactMap.get(text);
  if (exact) return exact;

  const call = text.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/);
  if (!call) return null;
  const entry = registry.callNames.get(call[1]);
  if (!entry) return null;
  // call[0] ends at the opening paren; scan from there to the span's end.
  return isWholeCall(text.slice(call[0].length - 1)) ? entry : null;
}

function isWholeCall(text) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) return i === text.length - 1;
      if (depth < 0) return false;
    }
  }
  return false;
}

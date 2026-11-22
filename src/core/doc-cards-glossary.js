/**
 * The author-facing doc-cards.md glossary: a Markdown file that doubles as
 * the per-coursebook doc card source and (optionally) an appendix chapter.
 *
 * Grammar — one H2 per entry, role-labeled paragraphs:
 *
 *   ## COUNT
 *   https://www.postgresql.org/docs/current/functions-aggregate.html
 *   Matches: `COUNT`, `COUNT(*)`, `count(*)`
 *
 *   Signatures:
 *
 *   ```
 *   COUNT(*)
 *   COUNT(expression)
 *   ```
 *
 *   Counts rows, or non-null values of `expression`, across the input rows.
 *
 *   Example:
 *
 *   ```sql
 *   SELECT COUNT(*) FROM orders;
 *   ```
 *
 * Every other paragraph is summary prose. A URL can be absolute http(s), a
 * coursebook-relative path (resolved against the glossary's directory), or a
 * `#anchor`-less entry, which anchors to the glossary's own chapter section
 * and therefore requires doc-cards.md to be listed as a chapter.
 *
 * Config rides in a leading HTML comment (`<!-- doc-cards: packs=none -->`),
 * which renders invisibly in every pipeline — the app, the export, the
 * editor, and saves all see ordinary Markdown, so no raw/body split is
 * needed anywhere.
 *
 * Parsing uses a dedicated minimal markdown-it instance (no linkify, no HTML)
 * and never the book renderer, so `Matches:` code spans are not turned into
 * chips while parsing. Summaries render through a second minimal instance
 * with links and images disabled, so a summary can never produce an anchor.
 */
import MarkdownIt from "markdown-it";
import { buildRegistry } from "./doc-cards.js";
import { getBaseDir, resolveLink } from "./coursebook-loader.js";

const mdGlossary = new MarkdownIt({ html: false, linkify: false });

const mdSummary = new MarkdownIt({ html: false, linkify: false });
mdSummary.disable("link");
mdSummary.disable("image");
// linkify:false does not disable the autolink rule, which still turns
// `<https://x>` spans into anchors — summaries must never produce links.
mdSummary.disable("autolink");

/**
 * Render a card summary as inline HTML. Emphasis and inline code survive;
 * links, images, raw HTML, and autolinks are structurally impossible.
 */
export function renderDocCardSummary(text) {
  return mdSummary.renderInline(text ?? "").trim();
}

/**
 * Split a leading `<!-- doc-cards: ... -->` config comment off the top of a
 * glossary file. The whole spec is the packs value (`packs=none`, `packs=python, custom`,
 * `packs=[python]`); anything else is a warning. No comment, malformed, or
 * unclosed means no config and the file stays body. The comment line becomes
 * a blank line so token.map line numbers stay aligned with the original file.
 */
function splitDocCardsConfig(markdown, { sourcePath, warnings }) {
  const lines = markdown.split("\n");
  let first = 0;
  while (first < lines.length && lines[first].trim() === "") first++;
  const match = lines[first]?.match(/^\s*<!--\s*doc-cards:\s*(.*?)\s*-->$/);
  if (!match) return { packs: null, body: markdown };

  const spec = match[1].trim();
  const body = [...lines.slice(0, first), "", ...lines.slice(first + 1)].join("\n");
  const valueMatch = spec.match(/^packs\s*=\s*(.+)$/);
  if (!valueMatch) {
    warnings.push(
      `${sourcePath}:${first + 1}: doc-cards config must look like "doc-cards: packs=none" or "doc-cards: packs=python, custom" — ignoring "${spec}"`,
    );
    return { packs: null, body };
  }
  const value = valueMatch[1].trim();
  const packs =
    value === "none"
      ? []
      : value
          .replace(/^\[|\]$/g, "")
          .split(/[,\s]+/)
          .filter(Boolean);
  return { packs, body };
}

function paragraphText(inline) {
  let text = "";
  for (const child of inline.children ?? []) {
    if (child.type === "text" || child.type === "code_inline") text += child.content;
    else if (child.type === "softbreak") text += " ";
  }
  return text;
}

// A body line that is exactly one URL: absolute, anchor, or a coursebook
// path that carries a real file extension (so prose like "and/or", "24/7",
// "TCP/IP", or "C/C++" is never mistaken for a link).
const BARE_URL_LINE = /^(?:https?:\/\/\S+|#\S+|\/\S+|\.\.?\/\S+|\S+\.\w{2,8}(?:\/\S*)?)$/;

const LABEL_PATTERN = /^(matches|signatures|example):\s*/i;

/** Inline-code spans of a raw glossary line (`Matches: \`COUNT\`, \`COUNT(*)\``). */
function codeSpansOfLine(rawLine) {
  const spans = [];
  for (const match of rawLine.matchAll(/`([^`]+)`/g)) {
    if (match[1].trim()) spans.push(match[1]);
  }
  return spans;
}

/**
 * Parse a glossary file into raw entries plus the pack configuration.
 * Entries are unresolved: `url` is null for URL-less entries, relative
 * paths are relative to the glossary's directory, and normalization happens
 * in buildGlossaryRegistry once the loader knows the glossary's context.
 */
export function parseGlossary(markdown, { sourcePath = "doc-cards.md" } = {}) {
  const errors = [];
  const warnings = [];
  const { packs, body } = splitDocCardsConfig(markdown, { sourcePath, warnings });

  const fail = (line, message) => errors.push(`${sourcePath}:${line + 1}: ${message}`);
  const warn = (line, message) => warnings.push(`${sourcePath}:${line + 1}: ${message}`);

  const bodyLines = body.split("\n");
  const tokens = mdGlossary.parse(body, {});
  const entries = [];
  let current = null;
  let pendingFence = null;

  const closeEntry = () => {
    if (!current) return;
    if (current.summary.trim() === "") {
      warn(current.source.line, `entry "${current.name}" has no summary`);
    }
    entries.push(current);
    current = null;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "heading_open") {
      const level = Number(token.tag[1]);
      if (level < 2) {
        if (current) warn(token.map[0], `unexpected H1 inside entry "${current.name}"`);
        closeEntry();
        continue;
      }
      const inline = tokens[i + 1];
      const name = (inline ? paragraphText(inline) : "").trim();
      if (level > 2) {
        if (current)
          warn(token.map[0], `unexpected H${level} inside entry "${current.name}"`);
        continue;
      }
      closeEntry();
      if (!name) {
        fail(token.map[0], "glossary entry heading has no name");
        continue;
      }
      current = {
        name,
        url: null,
        matches: [],
        signatures: [],
        summary: "",
        example: null,
        source: { path: sourcePath, line: token.map[0] },
      };
      continue;
    }

    if (token.type === "fence") {
      if (!current) {
        warn(token.map[0], "code fence outside of an entry");
        continue;
      }
      if (pendingFence === "signatures") {
        current.signatures = token.content
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        pendingFence = null;
      } else if (pendingFence === "example") {
        current.example = token.content.trim();
        pendingFence = null;
      } else {
        warn(
          token.map[0],
          `unlabeled code fence in entry "${current.name}" — label it with "Signatures:" or "Example:"`,
        );
      }
      continue;
    }

    if (token.type === "paragraph_open") {
      i += 2; // consume the paragraph's inline + close tokens
      if (!current) {
        warn(token.map[0], "paragraph outside of an entry");
        continue;
      }
      if (pendingFence) {
        warn(
          token.map[0],
          `"${pendingFence === "signatures" ? "Signatures:" : "Example:"}" must be followed by a code fence`,
        );
        pendingFence = null;
      }
      // Entry bodies are line-oriented, and the RAW authored lines are kept
      // for summaries so emphasis and inline code survive into the rendered
      // card. Every line of a paragraph is one of a bare URL, a role label,
      // or summary prose; adjacent lines form one paragraph.
      const summaryLines = [];
      for (const rawLine of bodyLines.slice(token.map[0], token.map[1])) {
        const text = rawLine.trim();
        if (!text) continue;
        const label = text.match(LABEL_PATTERN);
        if (label) {
          const kind = label[1].toLowerCase();
          if (kind === "matches") {
            for (const match of codeSpansOfLine(text)) {
              if (current.matches.includes(match)) {
                warn(
                  token.map[0],
                  `duplicate match "${match}" in entry "${current.name}"`,
                );
              } else {
                current.matches.push(match);
              }
            }
          } else {
            pendingFence = kind === "signatures" ? "signatures" : "example";
          }
          continue;
        }
        if (BARE_URL_LINE.test(text)) {
          if (current.url) {
            warn(
              token.map[0],
              `entry "${current.name}" already has a docs link — ignoring this one`,
            );
          } else {
            current.url = text;
          }
          continue;
        }
        summaryLines.push(text);
      }
      if (summaryLines.length > 0) {
        if (current.summary) current.summary += "\n\n";
        current.summary += summaryLines.join("\n");
      }
      continue;
    }

    if (pendingFence && token.type !== "paragraph_close" && token.type !== "inline") {
      warn(
        token.map ? token.map[0] : 0,
        `"${pendingFence === "signatures" ? "Signatures:" : "Example:"}" must be followed by a code fence`,
      );
      pendingFence = null;
    }
  }
  if (pendingFence) {
    warn(
      0,
      `"${pendingFence === "signatures" ? "Signatures:" : "Example:"}" must be followed by a code fence`,
    );
  }
  closeEntry();

  const seen = new Map();
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      fail(entry.source.line, `duplicate glossary entry "${entry.name}"`);
    }
    seen.set(entry.name, entry);
  }

  return { packs, entries, errors, warnings };
}

/**
 * Resolve raw glossary entries into registry-ready book entries: URL-less
 * entries anchor to the glossary's own chapter (and are dropped with an
 * error when the glossary is not a chapter — a dead chip is worse), and
 * relative paths resolve against the glossary's directory, rejecting paths
 * that escape the coursebook root.
 */
export function resolveGlossaryEntries(
  entries,
  // sourcePath is accepted for call-site symmetry; error messages carry each
  // entry's own source path instead.
  {
    sourcePath: _sourcePath = "doc-cards.md",
    glossaryChapterSlug = null,
    baseDir = "",
  } = {},
) {
  const out = [];
  const errors = [];
  const warnings = [];
  for (const entry of entries) {
    const at = `${entry.source.path}:${entry.source.line + 1}`;
    let url = entry.url;
    if (url === null) {
      if (!glossaryChapterSlug) {
        errors.push(
          `${at}: entry "${entry.name}" has no docs link and doc-cards.md is not a chapter — add a URL or list doc-cards.md in coursebook.md`,
        );
        continue;
      }
      url = `#${glossaryChapterSlug}`;
    } else if (!/^https?:\/\//i.test(url) && !url.startsWith("#")) {
      const resolved = resolveLink(url, baseDir);
      if (!resolved) {
        errors.push(
          `${at}: entry "${entry.name}" has a relative URL that escapes the coursebook root`,
        );
        continue;
      }
      url = resolved;
    }
    out.push({ ...entry, url });
  }
  return { entries: out, errors, warnings };
}

/**
 * Parse, resolve, and build the registry for one glossary file — the shared
 * entry point for the app controller and the Node-side tools, so both sides
 * always agree on what the author wrote.
 */
export function buildGlossaryRegistry({
  markdown,
  sourcePath = "doc-cards.md",
  glossaryChapterSlug = null,
  baseDir = getBaseDir(sourcePath),
} = {}) {
  const parsed = parseGlossary(markdown, { sourcePath });
  const problems = { errors: [...parsed.errors], warnings: [...parsed.warnings] };
  const resolved = resolveGlossaryEntries(parsed.entries, {
    sourcePath,
    glossaryChapterSlug,
    baseDir,
  });
  problems.errors.push(...resolved.errors);
  problems.warnings.push(...resolved.warnings);
  const registry = buildRegistry({ packs: parsed.packs, bookEntries: resolved.entries });
  problems.errors.push(...registry.errors);
  problems.warnings.push(...registry.warnings);
  return { registry, problems, packs: parsed.packs };
}

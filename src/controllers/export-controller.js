/**
 * export-controller.js — HTML/Markdown export actions and the link-preview
 * cache, composed by app.js via injected dependencies. Controllers never
 * import each other; cross-controller calls are routed through deps.
 */
import {
  exportCoursebookHtml,
  exportSingleHtml,
} from "../renderer/coursebook-exporter.js";
import { LinkPreview, extractLinks, resolvePreview } from "../renderer/link-preview.js";
import {
  getBaseDir,
  buildChapterSlugMap,
  resolveLink,
} from "../core/coursebook-loader.js";
import { readFileFromDirectory } from "../core/fs.js";

export function createExportController(deps) {
  const { state, localAssets, showToast, flushEditor } = deps;

  function safeFilename(title, ext, fallback = "untitled") {
    const base = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `${base || fallback}.${ext}`;
  }

  function downloadTextFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Images are inlined as base64 data URIs with no recompression, so a book
  // with large screenshots can produce a very heavy single file. Warn the
  // author rather than silently degrading image quality.
  const LARGE_EXPORT_BYTES = 15 * 1024 * 1024;

  function formatMegabytes(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1);
  }

  async function exportHtml() {
    await flushEditor();

    const assetResolver = state.localFileStore ? localAssets.resolveAsset : undefined;
    let html;
    let filename;
    if (state.coursebook) {
      html = await exportCoursebookHtml(
        state.coursebook,
        assetResolver,
        state.linkPreviews,
      );
      filename = safeFilename(state.coursebook.title, "html", "coursebook");
    } else {
      const markdown = state.markdownEditor?.getValue() ?? state.currentMarkdown;
      html = await exportSingleHtml(
        state.chapterTitleEl.textContent,
        markdown,
        assetResolver,
        state.linkPreviews,
      );
      filename = safeFilename(state.chapterTitleEl.textContent, "html", "chapter");
    }
    downloadTextFile(filename, html, "text/html");
    if (html.length > LARGE_EXPORT_BYTES) {
      showToast(
        `Exported ${formatMegabytes(html.length)} MB — consider compressing large images to shrink the file.`,
      );
    }
  }

  function rewriteMarkdownChapterLinks(markdown, sourcePath, chapterSlugMap) {
    const baseDir = getBaseDir(sourcePath);
    const lines = markdown.split("\n");
    let inCodeFence = false;
    const linkRegex = /(?<!!)\[([^\]]*)\]\(([^)\s]*)\)/g;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        inCodeFence = !inCodeFence;
        continue;
      }
      if (inCodeFence) continue;

      lines[i] = lines[i].replace(linkRegex, (match, text, target) => {
        const hashIndex = target.indexOf("#");
        const filePart = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
        if (!filePart.toLowerCase().endsWith(".md")) return match;
        const resolved = resolveLink(filePart, baseDir);
        if (!resolved || !chapterSlugMap.has(resolved)) return match;
        return `[${text}](#${chapterSlugMap.get(resolved)})`;
      });
    }

    return lines.join("\n");
  }

  async function exportMarkdown() {
    await flushEditor();

    let markdown;
    let filename;
    if (state.coursebook) {
      const chapterSlugMap = buildChapterSlugMap(state.coursebook);

      const parts = [];
      const parentMd = rewriteMarkdownChapterLinks(
        state.coursebook.markdown,
        state.coursebook.parentPath,
        chapterSlugMap,
      );
      parts.push(parentMd);

      for (let i = 0; i < state.coursebook.chapters.length; i++) {
        const md = state.sectionMarkdowns[i + 1] ?? state.coursebook.chapters[i].markdown;
        if (md === null || md === undefined) continue;
        const sourcePath = state.coursebook.chapters[i].resolvedPath;
        parts.push(rewriteMarkdownChapterLinks(md, sourcePath, chapterSlugMap));
      }

      markdown = parts.join("\n\n---\n\n");
      filename = safeFilename(state.coursebook.title, "md", "coursebook");
    } else {
      markdown = state.markdownEditor?.getValue() ?? state.currentMarkdown;
      filename = safeFilename(state.chapterTitleEl.textContent, "md", "chapter");
    }

    downloadTextFile(filename, markdown, "text/markdown");
  }

  function collectCoursebookUrls(coursebook) {
    if (!coursebook) return [];
    const markdowns = [
      coursebook.markdown,
      ...coursebook.chapters.map((c) => c.markdown),
    ];
    const all = new Set();
    for (const md of markdowns) {
      for (const url of extractLinks(md)) {
        all.add(url);
      }
    }
    return [...all];
  }

  async function preloadMissingLinkPreviews(loadedCoursebook) {
    if (loadedCoursebook !== state.coursebook) return;

    const urls = collectCoursebookUrls(loadedCoursebook);
    if (urls.length === 0) return;

    const missing = urls.filter((url) => !state.linkPreviews.hasOwnProperty(url));
    if (missing.length === 0) return;

    showToast("Building link previews...");

    let builtCount = 0;
    let rateLimited = false;
    // Fetch a few at a time to avoid hammering the network.
    const CONCURRENCY = 3;
    let index = 0;
    const jinaApiKey = import.meta.env?.JINA_API_KEY;

    async function worker() {
      while (index < missing.length) {
        const url = missing[index++];
        try {
          const preview = await resolvePreview(url, { apiKey: jinaApiKey });
          if (loadedCoursebook !== state.coursebook) return;
          if (preview) {
            state.linkPreviews[url] = preview;
            LinkPreview.setPreviews(state.linkPreviews);
            builtCount++;
          }
        } catch (e) {
          if (loadedCoursebook !== state.coursebook) return;
          if (e?.rateLimited || String(e?.message).includes("429")) {
            // The preview provider is now in its own cooldown: the remaining
            // URLs fail fast without touching the network, so drain the queue
            // rather than retrying and turning one limit into a 429 storm.
            rateLimited = true;
          }
          // Other failures (403, DNS, …) are reported in the summary below.
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // The user moved to another coursebook while previews were building; its
    // own preload run reports for it, so stay quiet here.
    if (loadedCoursebook !== state.coursebook) return;

    if (builtCount > 0) showToast("Link previews ready");
    const notBuilt = urls.filter((url) => !state.linkPreviews.hasOwnProperty(url));
    if (notBuilt.length > 0) {
      // Keep the log to one line: a wall of URLs is what made a rate limit
      // look like a crash.
      const sample = notBuilt.slice(0, 3).join(", ");
      const more = notBuilt.length > 3 ? ` (+${notBuilt.length - 3} more)` : "";
      console.warn(
        `Link previews unavailable for ${notBuilt.length} of ${missing.length} URL(s)` +
          (rateLimited ? " (rate limited; they will retry later)" : "") +
          `: ${sample}${more}`,
      );
      if (rateLimited) {
        showToast("Link previews rate-limited — will retry in a few minutes.");
      }
    }
  }

  async function loadPreviewsForCoursebook(parentPath) {
    if (!parentPath) return {};
    const baseDir = getBaseDir(parentPath);
    const previewPath = baseDir ? `${baseDir}/previews.json` : "previews.json";

    try {
      if (state.localFileStore?.dirHandle) {
        const { file } = await readFileFromDirectory(
          state.localFileStore.dirHandle,
          previewPath,
          { quiet: true },
        );
        return JSON.parse(await file.text());
      }

      if (state.localFileStore?.fileMap) {
        const f =
          state.localFileStore.fileMap.get(previewPath) ??
          state.localFileStore.fileMapLower?.get(previewPath.toLowerCase());
        if (!f) return {};
        return JSON.parse(await f.text());
      }

      const res = await fetch(previewPath);
      if (!res.ok) return {};
      return await res.json();
    } catch {
      return {};
    }
  }

  return {
    exportHtml,
    exportMarkdown,
    preloadMissingLinkPreviews,
    loadPreviewsForCoursebook,
  };
}

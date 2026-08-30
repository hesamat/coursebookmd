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
    // Fetch a few at a time to avoid hammering the network.
    const CONCURRENCY = 3;
    let index = 0;
    // A rate limit (HTTP 429) pauses every worker with an escalating backoff
    // and re-queues the URL; if the limit persists across MAX_429_BACKOFFS
    // pauses, the remaining URLs are given up for this session and retried on
    // the next coursebook open.
    const MAX_429_BACKOFFS = 3;
    let backoffCount = 0;
    let backoffTimer = null;
    let rateLimited = false;

    function backoffAfter429() {
      if (!backoffTimer) {
        if (backoffCount >= MAX_429_BACKOFFS) {
          rateLimited = true;
          backoffTimer = Promise.resolve();
        } else {
          backoffCount += 1;
          const delay = Math.min(5000 * 2 ** (backoffCount - 1), 30000);
          backoffTimer = new Promise((resolve) => setTimeout(resolve, delay)).then(() => {
            backoffTimer = null;
          });
        }
      }
      return backoffTimer;
    }

    const jinaApiKey = import.meta.env?.JINA_API_KEY;

    async function worker() {
      while (index < missing.length && !rateLimited) {
        const url = missing[index++];
        try {
          const preview = await resolvePreview(url, { apiKey: jinaApiKey });
          if (loadedCoursebook !== state.coursebook) return;
          if (preview) {
            state.linkPreviews[url] = preview;
            LinkPreview.setPreviews(state.linkPreviews);
            builtCount++;
            backoffCount = 0;
          }
        } catch (e) {
          if (loadedCoursebook !== state.coursebook) return;
          if (String(e?.message).includes("429")) {
            // Re-queue at the front and pause every worker before retrying.
            missing.splice(index, 0, url);
            await backoffAfter429();
          }
          // Other failures (403, DNS, …) are reported in the summary below.
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    if (builtCount > 0) showToast("Link previews ready");
    const notBuilt = missing.filter((url) => !state.linkPreviews.hasOwnProperty(url));
    if (notBuilt.length > 0) {
      console.warn(
        `Link previews unavailable for ${notBuilt.length} of ${missing.length} URL(s)` +
          (rateLimited
            ? " (rate limited; they will be retried the next time the coursebook is opened)"
            : "") +
          `: ${notBuilt.join(", ")}`,
      );
      if (rateLimited && builtCount === 0) {
        showToast("Link previews rate-limited — they'll be retried next time.");
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

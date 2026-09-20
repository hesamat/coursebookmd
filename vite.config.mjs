import { defineConfig } from "vite";
import { resolve, extname } from "node:path";
import { existsSync, readFileSync, statSync, cpSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

/**
 * Map common file extensions to their MIME type so images and other
 * static assets served from /courses/ get the correct Content-Type.
 * Markdown files default to text/markdown.
 */
const MIME_TYPES = {
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
};

/**
 * Vite plugin that serves .md files from outside the project root via
 * a `/courses/` URL prefix mapped to ../myCourses/.
 *
 * Without this, Vite's SPA fallback returns index.html for any path
 * that isn't a static file in the project, so external coursebook
 * files can't be fetched. The browser also normalizes ../ in URLs,
 * so ?coursebook=../myCourses/... can't work — /courses/ provides a
 * clean prefix that stays within the URL path.
 *
 * Example: /courses/COMP1510/coursebook.md → ../myCourses/COMP1510/coursebook.md
 */
function resolveNodeModulesIfLinked() {
  const nodeModules = resolve(__dirname, "node_modules");
  if (!existsSync(nodeModules)) return nodeModules;
  try {
    return realpathSync(nodeModules);
  } catch {
    return nodeModules;
  }
}

function copyDocsToDist() {
  const docsDir = resolve(__dirname, "docs");
  const distDocsDir = resolve(__dirname, "dist", "docs");
  return {
    name: "copy-docs-to-dist",
    writeBundle() {
      if (!existsSync(docsDir)) return;
      cpSync(docsDir, distDocsDir, { recursive: true, force: true });
    },
  };
}

function serveExternalCoursebooks() {
  const coursesDir = resolve(__dirname, "../myCourses");
  return {
    name: "serve-external-coursebooks",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        const url = new URL(req.url, "http://localhost");
        const pathname = decodeURIComponent(url.pathname);
        if (!pathname.startsWith("/courses/")) return next();
        const relPath = pathname.slice("/courses/".length);
        const filePath = resolve(coursesDir, relPath);
        // Prevent path traversal outside coursesDir
        if (!filePath.startsWith(coursesDir)) return next();
        if (!existsSync(filePath)) return next();
        const stat = statSync(filePath);
        if (!stat.isFile()) return next();
        try {
          const ext = extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
          const isBinary = ext !== ".md";
          const content = await readFile(filePath, isBinary ? null : "utf-8");
          res.setHeader("Content-Type", contentType);
          res.end(content);
        } catch {
          next();
        }
      });
    },
  };
}

/**
 * Vite plugin (dev server only) that keeps dist/export-runtime.iife.js fresh
 * while `npm run dev` is running.
 *
 * The HTML exporter embeds the built viewer via a `?raw` import of
 * dist/export-runtime.iife.js (see coursebook-exporter.js). That bundle is
 * produced by `npm run build:export-runtime`: the predev hook runs it once,
 * but nothing rebuilds it when src/ changes, and Vite keeps serving the
 * cached ?raw string even after an out-of-band rebuild — so exports from a
 * long-running dev server silently shipped a stale viewer. This plugin
 * watches src/, rebuilds the bundle in the background, and when the bundle's
 * bytes actually changed, invalidates the cached ?raw module and reloads the
 * page so the next export embeds the current viewer. No restart needed.
 */
function refreshExportRuntime() {
  const runtimeFile = resolve(__dirname, "dist", "export-runtime.iife.js");
  const srcDir = resolve(__dirname, "src");
  const DEBOUNCE_MS = 500;
  let rebuilding = false;
  let rerunAfterBuild = false;
  let lastServed = null;
  let timer = null;

  const rebuild = (server) => {
    if (rebuilding) {
      rerunAfterBuild = true;
      return;
    }
    rebuilding = true;
    server.config.logger.info("[export-runtime] rebuilding viewer bundle…");
    const child = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", "build:export-runtime"],
      { cwd: __dirname, stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("exit", (code) => {
      rebuilding = false;
      if (code !== 0) {
        server.config.logger.error(
          `[export-runtime] rebuild failed (exit ${code}):\n${stderr.trim()}`,
        );
      } else {
        try {
          const next = readFileSync(runtimeFile);
          if (!lastServed || !next.equals(lastServed)) {
            lastServed = next;
            // The browser caches the evaluated ?raw module, and Vite caches
            // its transform; without invalidation even a full reload would
            // re-serve the stale string.
            const modules = server.moduleGraph.getModulesByFile(runtimeFile) ?? [];
            for (const mod of modules) server.moduleGraph.invalidateModule(mod);
            server.ws.send({ type: "full-reload" });
            server.config.logger.info(
              "[export-runtime] viewer bundle rebuilt — exports now embed the current viewer",
            );
          }
        } catch {
          // dist file unreadable; the next triggered rebuild retries
        }
      }
      if (rerunAfterBuild) {
        rerunAfterBuild = false;
        rebuild(server);
      }
    });
  };

  return {
    name: "refresh-export-runtime",
    apply: "serve",
    configureServer(server) {
      try {
        lastServed = readFileSync(runtimeFile);
      } catch {
        lastServed = null;
      }
      const schedule = (path) => {
        if (!path.startsWith(srcDir + "/")) return;
        clearTimeout(timer);
        timer = setTimeout(() => rebuild(server), DEBOUNCE_MS);
      };
      server.watcher.on("change", schedule);
      server.watcher.on("add", schedule);
      server.watcher.on("unlink", schedule);
    },
  };
}

export default defineConfig({
  envPrefix: "JINA_",
  plugins: [copyDocsToDist(), serveExternalCoursebooks(), refreshExportRuntime()],
  // The code runner worker uses importScripts() to load Pyodide, which only
  // exists in classic workers — force IIFE in dev as well as build.
  worker: {
    format: "iife",
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        present: resolve(__dirname, "present.html"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 8200,
    open: "/index.html",
    fs: {
      allow: [
        // Project root
        resolve(__dirname),
        // Allow loading coursebooks from sibling directories
        resolve(__dirname, "../myCourses"),
        // If node_modules is a symlink to another project, Vite serves those
        // files through /@fs/ and needs the resolved real path to be allowed.
        resolveNodeModulesIfLinked(),
      ],
    },
  },
});

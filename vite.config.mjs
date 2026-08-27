import { defineConfig } from "vite";
import { resolve, extname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";

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
          const isText = ext === ".md";
          const content = await readFile(filePath, isText ? "utf-8" : null);
          res.setHeader("Content-Type", contentType);
          res.end(content);
        } catch {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [serveExternalCoursebooks()],
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
      ],
    },
  },
});

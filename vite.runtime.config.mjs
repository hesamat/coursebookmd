import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/**
 * Vite configuration for the standalone export runtime bundle.
 *
 * The runtime is a small IIFE that is inlined into exported HTML files.
 * It contains only the read-only viewer logic (navigation, present mode,
 * theme, scroll-spy) and reuses the same core modules as the live app.
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/export-runtime.js"),
      name: "CoursebookExport",
      formats: ["iife"],
      fileName: "export-runtime",
    },
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});

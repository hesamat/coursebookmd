import { chromium } from "@playwright/test";

/**
 * Warm the dev server before the parallel specs start.
 *
 * The first page load is what makes Vite discover and pre-bundle its
 * dependencies. When that happens while specs are already running, Vite
 * broadcasts a full reload that can wipe an in-flight test — the documented
 * cause of the intermittent file-watcher (OPFS) and diagram failures. Loading
 * the app once here, and waiting for the lazily-loaded enhancers (Shiki,
 * KaTeX, D2) to pull their chunks, gets that out of the way first.
 *
 * A failure here is reported and ignored: warming the cache is an
 * optimisation, never a reason to fail the suite.
 */
export default async function globalSetup({ baseURL }) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(baseURL ?? "http://127.0.0.1:8208/");
    await page.locator("#chapterNav").waitFor({ state: "visible", timeout: 120000 });
    // The enhancers import their libraries on demand; give those chunks a
    // moment to be requested and pre-bundled.
    await page.waitForTimeout(2000);
  } catch (error) {
    console.warn(`[global-setup] warm-up skipped: ${error.message}`);
  } finally {
    await browser.close();
  }
}

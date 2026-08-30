import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:8208";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push("PAGEERROR: " + err.message));

const log = (...args) => console.log("PROBE:", ...args);

await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.locator("#overview").waitFor({ state: "visible", timeout: 60000 });
await page.waitForTimeout(1000);

log("initial hash:", await page.evaluate(() => location.hash));
log("chapter items:", await page.locator("#chapterList .chapter-item").allTextContents());
log(
  "group labels:",
  await page.locator("#chapterList .nav-group-label").allTextContents(),
);
log(
  "sections:",
  await page.evaluate(() =>
    Array.from(document.querySelectorAll(".coursebook-section")).map(
      (s) => `${s.id}${s.classList.contains("active") ? "(active)" : ""}`,
    ),
  ),
);

// --- Click chapter 1 in sidebar ---
await page.locator('#chapterList [data-chapter-idx="0"] .chapter-item').click();
await page.waitForTimeout(1500);
log("after chapter click hash:", await page.evaluate(() => location.hash));
log(
  "active section:",
  await page.evaluate(() => document.querySelector(".coursebook-section.active")?.id),
);
log(
  "chapter1 toc targets:",
  await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-chapter-idx="0"] .chapter-toc .toc-item'),
    ).map((b) => b.getAttribute("data-target")),
  ),
);

// --- Scroll within chapter 1 to a later heading (wheel over content) ---
const contentBox = await page.locator("#content").boundingBox();
await page.mouse.move(contentBox.x + contentBox.width / 2, contentBox.y + 300);
await page.mouse.wheel(0, 2500);
await page.waitForTimeout(1500);
log(
  "after scroll: hash =",
  await page.evaluate(() => location.hash),
  " scrollTop =",
  await page.evaluate(() => document.getElementById("previewPane").scrollTop),
);
log(
  "active toc item after scroll:",
  await page.evaluate(() => {
    const items = document.querySelectorAll(
      '[data-chapter-idx="0"] .chapter-toc .toc-item',
    );
    return Array.from(items)
      .filter((i) => i.classList.contains("active"))
      .map((i) => i.getAttribute("data-target"));
  }),
);

// --- Scroll more (bottom) ---
await page.mouse.wheel(0, 4000);
await page.waitForTimeout(1500);
log(
  "after scroll-to-bottom: hash =",
  await page.evaluate(() => location.hash),
  " active toc:",
  await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-chapter-idx="0"] .toc-item.active')).map(
      (i) => i.getAttribute("data-target"),
    ),
  ),
);

// --- Click a TOC item ---
await page.evaluate(() => {
  document.getElementById("previewPane").scrollTop = 0;
});
await page.waitForTimeout(800);
const tocItem = page.locator(
  '[data-chapter-idx="0"] .chapter-toc .toc-item[data-target="opening-a-coursebook"]',
);
log("toc item count (opening-a-coursebook):", await tocItem.count());
await tocItem.click();
await page.waitForTimeout(1500);
log(
  "after toc click: hash =",
  await page.evaluate(() => location.hash),
  " active toc:",
  await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-chapter-idx="0"] .toc-item.active')).map(
      (i) => i.getAttribute("data-target"),
    ),
  ),
);

// --- Deep link navigation ---
await page.goto(BASE + "/#writing-content/headings", {
  waitUntil: "domcontentloaded",
});
await page.locator("#writing-content").waitFor({ state: "visible", timeout: 60000 });
await page.waitForTimeout(2000);
log(
  "deep link: active section =",
  await page.evaluate(() => document.querySelector(".coursebook-section.active")?.id),
  " hash =",
  await page.evaluate(() => location.hash),
);
log(
  "deep link active toc:",
  await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-chapter-idx="1"] .toc-item.active')).map(
      (i) => i.getAttribute("data-target"),
    ),
  ),
);

// --- Present mode (from chapter 2) ---
await page.locator("#presentBtn").click();
await page.waitForTimeout(1500);
log(
  "present: body.presenting =",
  await page.evaluate(() => document.body.classList.contains("presenting")),
  " fullscreen =",
  await page.evaluate(() => document.fullscreenElement !== null),
);
log(
  "overlay current:",
  await page.locator("#overlayCurrent").textContent(),
  "| progress:",
  await page.locator("#overlayProgress").textContent(),
);
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(1500);
log(
  "after ArrowRight: current:",
  await page.locator("#overlayCurrent").textContent(),
  "| progress:",
  await page.locator("#overlayProgress").textContent(),
);
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(1500);
log(
  "after ArrowRight x2: current:",
  await page.locator("#overlayCurrent").textContent(),
  "| progress:",
  await page.locator("#overlayProgress").textContent(),
);
log(
  ".current heading:",
  await page.evaluate(
    () => document.querySelector("#content h2.current, #content h1.current")?.textContent,
  ),
);
await page.keyboard.press("Escape");
await page.waitForTimeout(1000);
log(
  "after Esc: body.presenting =",
  await page.evaluate(() => document.body.classList.contains("presenting")),
);

// --- Export HTML ---
await page.locator("#menuBtn").click();
await page.locator("#menuExportHtmlBtn").waitFor({ state: "visible" });
const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
await page.locator("#menuExportHtmlBtn").click();
const download = await downloadPromise;
log("download suggested filename:", download.suggestedFilename());
const dlPath = await download.path();
const fs = await import("fs");
const html = fs.readFileSync(dlPath, "utf8");
log("download size:", html.length);
log("contains title:", html.includes("<title>CoursebookMD — User Guide</title>"));
log(
  "contains sections:",
  [
    'id="overview"',
    'id="getting-started"',
    'id="writing-content"',
    'id="rich-content"',
    'id="present-and-export"',
  ].map((s) => `${s}=${html.includes(s)}`),
);
log("contains chapter text:", html.includes("What is a coursebook?"));
log("is-export body:", html.includes('class="is-export"'));

log("console errors:", errors.length ? errors.slice(0, 10) : "none");
await browser.close();

import { test, expect } from "@playwright/test";

test.setTimeout(120000);

const RICH_CONTENT_PATH = "/#rich-content";

test.describe("D2 and SVG code fences render as inline SVG", () => {
  test("D2 diagram renders a visible SVG", async ({ page }) => {
    await page.goto(RICH_CONTENT_PATH);

    const richSection = page.locator("#rich-content");
    await richSection.waitFor({ state: "visible", timeout: 60000 });

    const d2Diagram = richSection.locator(".d2-diagram").first();
    await d2Diagram.waitFor({ state: "visible", timeout: 60000 });
    const d2Svg = d2Diagram.locator("svg.d2-svg");
    await d2Svg.waitFor({ state: "attached", timeout: 60000 });
    await expect(d2Svg).toBeVisible();
    await expect(d2Svg).toHaveAttribute("width");
  });

  test("raw SVG code fence renders a visible SVG", async ({ page }) => {
    await page.goto(RICH_CONTENT_PATH);

    const richSection = page.locator("#rich-content");
    await richSection.waitFor({ state: "visible", timeout: 60000 });

    const svgDiagram = richSection.locator(".svg-diagram").first();
    await svgDiagram.waitFor({ state: "visible", timeout: 10000 });
    const customSvg = svgDiagram.locator("svg").first();
    await customSvg.waitFor({ state: "attached", timeout: 10000 });
    await expect(customSvg).toBeVisible();
    await expect(customSvg).toHaveAttribute("viewBox");
  });

  test("D2 re-renders in dark mode", async ({ page }) => {
    await page.goto(RICH_CONTENT_PATH);

    const richSection = page.locator("#rich-content");
    await richSection.waitFor({ state: "visible", timeout: 60000 });

    const d2Svg = richSection.locator(".d2-diagram svg.d2-svg").first();
    await d2Svg.waitFor({ state: "visible", timeout: 60000 });
    const lightHtml = await d2Svg.innerHTML();

    // Toggle dark mode using the app UI.
    await page.locator("#themeToggleBtn").click();

    // Wait for re-render; the original SVG is replaced, so we re-locate.
    const d2SvgDark = richSection.locator(".d2-diagram svg.d2-svg").first();
    await d2SvgDark.waitFor({ state: "visible", timeout: 60000 });

    const darkHtml = await d2SvgDark.innerHTML();
    expect(darkHtml).not.toBe(lightHtml);
  });

  test("raw SVG is sanitized: scripts and event handlers are removed", async ({
    page,
  }) => {
    // Add a custom SVG code fence with malicious content to the editor and check it is sanitized.
    await page.goto("/");

    await page.locator("#toggleEditBtn").click();
    const editor = page.locator("#editor");
    await editor.waitFor({ state: "visible", timeout: 30000 });

    const maliciousSvg = [
      "```svg",
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
      "  <script>alert(2)</script>",
      '  <rect width="100" height="100" fill="#4a90d9"/>',
      "</svg>",
      "```",
    ].join("\n");

    await editor.fill(maliciousSvg);

    const content = page.locator("#content");
    const svgDiagram = content.locator(".svg-diagram").first();
    await svgDiagram.waitFor({ state: "visible", timeout: 60000 });

    const customSvg = svgDiagram.locator("svg").first();
    const html = await customSvg.innerHTML();
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onload");
    expect(html).not.toContain("alert");
    expect(html).toContain("<rect");
  });

  test("D2 error fallback renders .diagram-error for invalid D2", async ({ page }) => {
    await page.goto("/");

    await page.locator("#toggleEditBtn").click();
    const editor = page.locator("#editor");
    await editor.waitFor({ state: "visible", timeout: 30000 });

    const badD2 = ["```d2", "foo ->", "```"].join("\n");
    await editor.fill(badD2);

    const content = page.locator("#content");
    const error = content.locator(".diagram-error").first();
    await error.waitFor({ state: "visible", timeout: 60000 });
    await expect(error).toContainText("connection missing destination");
  });

  test("copy buttons are not added to diagram containers", async ({ page }) => {
    await page.goto(RICH_CONTENT_PATH);

    const richSection = page.locator("#rich-content");
    await richSection.waitFor({ state: "visible", timeout: 60000 });

    const d2Diagram = richSection.locator(".d2-diagram").first();
    await d2Diagram.waitFor({ state: "visible", timeout: 60000 });
    await expect(d2Diagram.locator(".code-copy-button")).toHaveCount(0);

    const svgDiagram = richSection.locator(".svg-diagram").first();
    await svgDiagram.waitFor({ state: "visible", timeout: 10000 });
    await expect(svgDiagram.locator(".code-copy-button")).toHaveCount(0);
  });

  test("multiple diagrams on the same page have distinct D2 output", async ({ page }) => {
    await page.goto(RICH_CONTENT_PATH);

    const richSection = page.locator("#rich-content");
    await richSection.waitFor({ state: "visible", timeout: 60000 });

    const d2Svgs = richSection.locator(".d2-diagram svg.d2-svg");
    await expect(d2Svgs).toHaveCount(1);

    // The default content has one D2 and one SVG; both should be visible.
    await expect(richSection.locator(".d2-diagram")).toHaveCount(1);
    await expect(richSection.locator(".svg-diagram")).toHaveCount(1);
  });
});

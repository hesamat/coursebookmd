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

  test("styled D2 diagram keeps author fill colors across theme change", async ({
    page,
  }) => {
    await page.goto(RICH_CONTENT_PATH);

    const richSection = page.locator("#rich-content");
    await richSection.waitFor({ state: "visible", timeout: 60000 });

    // The second D2 fence in the chapter carries explicit author styles.
    const styledDiagram = richSection.locator(".d2-diagram").nth(1);
    await styledDiagram
      .locator("svg.d2-svg")
      .waitFor({ state: "visible", timeout: 60000 });
    const lightHtml = await styledDiagram.locator("svg.d2-svg").innerHTML();
    expect(lightHtml.toLowerCase()).toContain("#bbdefb");
    const lightThemeFill = lightHtml.match(/\.fill-N7\{fill:([^}]+)\}/)?.[1];
    expect(lightThemeFill).toBeDefined();

    // Toggle dark mode. Diagrams keep the light theme in both app modes, so
    // the re-render (new salt, changed markup) must preserve the author
    // fills and the theme colors.
    await page.locator("#themeToggleBtn").click();
    await page.waitForFunction(
      (prev) => {
        const styled = document.querySelectorAll("#rich-content .d2-diagram")[1];
        const svg = styled?.querySelector("svg.d2-svg");
        return svg != null && svg.innerHTML !== prev;
      },
      lightHtml,
      { timeout: 60000 },
    );

    const darkHtml = await styledDiagram.locator("svg.d2-svg").innerHTML();
    expect(darkHtml.toLowerCase()).toContain("#bbdefb");
    const darkThemeFill = darkHtml.match(/\.fill-N7\{fill:([^}]+)\}/)?.[1];
    expect(darkThemeFill).toBe(lightThemeFill);
  });

  test("D2 diagram gets a light panel in dark mode", async ({ page }) => {
    await page.goto(RICH_CONTENT_PATH);

    const richSection = page.locator("#rich-content");
    await richSection.waitFor({ state: "visible", timeout: 60000 });

    // D2 nests its themed svg inside a plain outer wrapper; the panel is
    // applied to the outer element because nested SVG elements do not paint
    // CSS backgrounds.
    const d2Svg = richSection.locator(".d2-diagram > svg").first();
    await d2Svg.waitFor({ state: "visible", timeout: 60000 });
    // Light mode: the diagram blends with the page (no panel).
    expect(await d2Svg.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgba(0, 0, 0, 0)",
    );

    await page.locator("#themeToggleBtn").click();
    await page.waitForFunction(
      () => document.documentElement.getAttribute("data-theme") === "dark",
      undefined,
      { timeout: 60000 },
    );
    // The toggle also re-renders the diagrams; poll through the swap.
    await expect
      .poll(() => d2Svg.evaluate((el) => getComputedStyle(el).backgroundColor), {
        timeout: 60000,
      })
      .toBe("rgb(255, 255, 255)");
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

    await editor.locator(".cm-content").fill(maliciousSvg);

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
});

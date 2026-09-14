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

  test("D2 diagrams never render larger than their natural size", async ({ page }) => {
    await page.goto(RICH_CONTENT_PATH);

    const richSection = page.locator("#rich-content");
    await richSection.waitFor({ state: "visible", timeout: 60000 });

    // The second D2 fence in the chapter is small enough to fit the column
    // unscaled; the sizing CSS must not stretch it to the column width.
    const styledDiagram = richSection.locator(".d2-diagram").nth(1);
    const svg = styledDiagram.locator("svg").first();
    await svg.waitFor({ state: "attached", timeout: 60000 });

    const size = await svg.evaluate((el) => ({
      naturalW: Number(el.getAttribute("width")),
      naturalH: Number(el.getAttribute("height")),
      renderedW: el.getBoundingClientRect().width,
      renderedH: el.getBoundingClientRect().height,
    }));
    expect(size.naturalW).toBeGreaterThan(0);
    expect(size.naturalH).toBeGreaterThan(0);
    expect(size.renderedW).toBeLessThanOrEqual(size.naturalW + 1);
    expect(size.renderedH).toBeLessThanOrEqual(size.naturalH + 1);
    // The box keeps the diagram's aspect ratio (no height-only clamping).
    const naturalRatio = size.naturalW / size.naturalH;
    const renderedRatio = size.renderedW / size.renderedH;
    expect(renderedRatio).toBeCloseTo(naturalRatio, 1);
  });

  test("tall D2 diagrams scale to the height cap without a scrollbar and honor height=", async ({
    page,
  }) => {
    // A real chapter, like the edit-flicker spec: the bare "/" overview page
    // does not live-refresh its preview on editor changes.
    await page.goto("/#getting-started");
    await page.locator("#getting-started").waitFor({ state: "visible", timeout: 60000 });

    await page.locator("#toggleEditBtn").click();
    const editor = page.locator("#editor");
    await editor.waitFor({ state: "visible", timeout: 30000 });

    const chain = Array.from({ length: 15 }, (_, i) => `n${i + 1}`).join(" -> ");
    // No heading: replacing the chapter H1 suppresses the live preview
    // update, so the fences go in as bare chapter content (like the
    // sanitization test above).
    const markdown = ["```d2", chain, "```", "", "```d2 height=300", chain, "```"].join(
      "\n",
    );
    await editor.locator(".cm-content").fill(markdown);

    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("#content .d2-diagram")].filter((cont) => {
          const svg = cont.querySelector(":scope > svg");
          return svg && svg.getBoundingClientRect().height > 0;
        }).length >= 2,
      undefined,
      { timeout: 60000 },
    );

    const result = await page.evaluate(() => {
      // Other chapters are pre-rendered in hidden containers that also match;
      // measure only diagrams that are actually displayed.
      const rendered = [...document.querySelectorAll("#content .d2-diagram")].filter(
        (cont) => {
          const svg = cont.querySelector(":scope > svg");
          return svg && svg.getBoundingClientRect().height > 0;
        },
      );
      const measure = (cont) => {
        const svg = cont.querySelector(":scope > svg");
        return {
          renderedH: svg.getBoundingClientRect().height,
          cap: parseFloat(getComputedStyle(svg).maxHeight),
          containerOverflow: getComputedStyle(cont).overflowY,
          overrideVar: cont.style.getPropertyValue("--diagram-max-height"),
        };
      };
      return {
        defaultCap: measure(rendered[0]),
        override: measure(rendered[1]),
      };
    });

    // The default cap applies, the diagram scales proportionally into it,
    // and the container never becomes its own scroller.
    expect(result.defaultCap.containerOverflow).toBe("visible");
    expect(result.defaultCap.cap).toBeGreaterThan(0);
    expect(result.defaultCap.renderedH).toBeLessThanOrEqual(result.defaultCap.cap + 1);
    expect(result.defaultCap.renderedH).toBeGreaterThanOrEqual(
      result.defaultCap.cap * 0.9,
    );

    expect(result.override.overrideVar).toBe("300px");
    expect(result.override.renderedH).toBeLessThanOrEqual(301);

    await page.locator("#toggleEditBtn").click();
  });
});

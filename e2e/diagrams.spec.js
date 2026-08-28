import { test, expect } from "@playwright/test";

test.setTimeout(120000);

test("D2 and SVG code fences render as inline SVG", async ({ page }) => {
  // Navigate directly to the "Rich Content" chapter, which contains
  // example D2 and raw SVG diagrams.
  await page.goto("/#rich-content");

  const richSection = page.locator("#rich-content");
  await richSection.waitFor({ state: "visible", timeout: 60000 });

  const d2Diagram = richSection.locator(".d2-diagram").first();
  await d2Diagram.waitFor({ state: "visible", timeout: 60000 });
  const d2Svg = d2Diagram.locator("svg.d2-svg");
  await d2Svg.waitFor({ state: "attached", timeout: 60000 });
  await expect(d2Svg).toBeVisible();
  await expect(d2Svg).toHaveAttribute("width");

  const svgDiagram = richSection.locator(".svg-diagram").first();
  await svgDiagram.waitFor({ state: "visible", timeout: 10000 });
  const customSvg = svgDiagram.locator("svg").first();
  await customSvg.waitFor({ state: "attached", timeout: 10000 });
  await expect(customSvg).toBeVisible();
  await expect(customSvg).toHaveAttribute("viewBox");
});

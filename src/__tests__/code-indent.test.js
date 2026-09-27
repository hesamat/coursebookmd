import { describe, it, expect } from "vitest";
import { __test } from "../renderer/content-enhancer.js";

const { makeLeadingIndentUnbreakable } = __test;

function pre(html) {
  const el = document.createElement("pre");
  el.innerHTML = html;
  return el;
}

// Shiki line structure: <code><span class="line">…</span>\n<span class="line">…</span></code>
describe("makeLeadingIndentUnbreakable", () => {
  it("converts leading spaces inside the first token span to no-break spaces", () => {
    const el = pre(
      '<code><span class="line"><span style="color:#005CC5">    print</span>' +
        '<span style="color:#24292E">(letter)</span></span>\n' +
        '<span class="line"><span style="color:#24292E">print("Done")</span></span></code>',
    );
    makeLeadingIndentUnbreakable(el);

    const firstLineText = el.querySelector(".line").textContent;
    expect(firstLineText.startsWith("\u00A0\u00A0\u00A0\u00A0print")).toBe(true);
    // Non-indented line and interior text stay untouched
    expect(el.querySelectorAll(".line")[1].textContent).toBe('print("Done")');
    expect(el.querySelector(".line").textContent.endsWith("(letter)")).toBe(true);
  });

  it("converts leading spaces in a bare text node", () => {
    const el = pre('<code><span class="line">    return x</span></code>');
    makeLeadingIndentUnbreakable(el);

    expect(el.querySelector(".line").textContent).toBe(
      "\u00A0\u00A0\u00A0\u00A0return x",
    );
  });

  it("leaves blank lines and non-whitespace-leading lines unchanged", () => {
    const el = pre(
      '<code><span class="line"></span>\n' +
        '<span class="line">word = "Code"</span></code>',
    );
    makeLeadingIndentUnbreakable(el);

    const lines = el.querySelectorAll(".line");
    expect(lines[0].textContent).toBe("");
    expect(lines[1].textContent).toBe('word = "Code"');
  });

  it("leaves tab-led lines untouched", () => {
    const el = pre('<code><span class="line">\t    x</span></code>');
    makeLeadingIndentUnbreakable(el);

    expect(el.querySelector(".line").textContent).toBe("\t    x");
  });
});

import { describe, it, expect } from "vitest";
import { computeSectionNumbers } from "../core/section-numbering.js";

/** Helper to create a fake heading element with a given tag name. */
function makeHeading(tagName) {
  const el = { tagName };
  return el;
}

describe("section-numbering", () => {
  describe("computeSectionNumbers", () => {
    it("numbers a single h1", () => {
      const headings = [makeHeading("H1")];
      expect(computeSectionNumbers(headings)).toEqual(["1"]);
    });

    it("numbers sequential h1s", () => {
      const headings = [makeHeading("H1"), makeHeading("H1"), makeHeading("H1")];
      expect(computeSectionNumbers(headings)).toEqual(["1", "2", "3"]);
    });

    it("numbers h2 under h1", () => {
      const headings = [makeHeading("H1"), makeHeading("H2"), makeHeading("H2")];
      expect(computeSectionNumbers(headings)).toEqual(["1", "1.1", "1.2"]);
    });

    it("numbers h3 under h2 under h1", () => {
      const headings = [
        makeHeading("H1"),
        makeHeading("H2"),
        makeHeading("H3"),
        makeHeading("H3"),
      ];
      expect(computeSectionNumbers(headings)).toEqual(["1", "1.1", "1.1.1", "1.1.2"]);
    });

    it("resets h2 counter when h1 increments", () => {
      const headings = [
        makeHeading("H1"),
        makeHeading("H2"),
        makeHeading("H2"),
        makeHeading("H1"),
        makeHeading("H2"),
      ];
      expect(computeSectionNumbers(headings)).toEqual(["1", "1.1", "1.2", "2", "2.1"]);
    });

    it("resets h3 counter when h2 increments", () => {
      const headings = [
        makeHeading("H1"),
        makeHeading("H2"),
        makeHeading("H3"),
        makeHeading("H2"),
        makeHeading("H3"),
      ];
      expect(computeSectionNumbers(headings)).toEqual([
        "1",
        "1.1",
        "1.1.1",
        "1.2",
        "1.2.1",
      ]);
    });

    it("resets both h2 and h3 counters when h1 increments", () => {
      const headings = [
        makeHeading("H1"),
        makeHeading("H2"),
        makeHeading("H3"),
        makeHeading("H1"),
        makeHeading("H2"),
        makeHeading("H3"),
      ];
      expect(computeSectionNumbers(headings)).toEqual([
        "1",
        "1.1",
        "1.1.1",
        "2",
        "2.1",
        "2.1.1",
      ]);
    });

    it("handles h2 without preceding h1", () => {
      const headings = [makeHeading("H2"), makeHeading("H2")];
      expect(computeSectionNumbers(headings)).toEqual(["0.1", "0.2"]);
    });

    it("handles h3 without preceding h1 or h2", () => {
      const headings = [makeHeading("H3")];
      expect(computeSectionNumbers(headings)).toEqual(["0.0.1"]);
    });

    it("returns empty string for unsupported heading levels (h4+)", () => {
      const headings = [makeHeading("H1"), makeHeading("H4"), makeHeading("H2")];
      expect(computeSectionNumbers(headings)).toEqual(["1", "", "1.1"]);
    });

    it("returns empty array for empty input", () => {
      expect(computeSectionNumbers([])).toEqual([]);
    });

    it("handles a complex realistic document structure", () => {
      const headings = [
        makeHeading("H1"), // 1
        makeHeading("H2"), // 1.1
        makeHeading("H3"), // 1.1.1
        makeHeading("H2"), // 1.2
        makeHeading("H3"), // 1.2.1
        makeHeading("H3"), // 1.2.2
        makeHeading("H1"), // 2
        makeHeading("H2"), // 2.1
        makeHeading("H1"), // 3
        makeHeading("H2"), // 3.1
        makeHeading("H2"), // 3.2
        makeHeading("H3"), // 3.2.1
      ];
      expect(computeSectionNumbers(headings)).toEqual([
        "1",
        "1.1",
        "1.1.1",
        "1.2",
        "1.2.1",
        "1.2.2",
        "2",
        "2.1",
        "3",
        "3.1",
        "3.2",
        "3.2.1",
      ]);
    });

    it("output length matches input length", () => {
      const headings = [
        makeHeading("H1"),
        makeHeading("H2"),
        makeHeading("H3"),
        makeHeading("H4"),
        makeHeading("H1"),
      ];
      const numbers = computeSectionNumbers(headings);
      expect(numbers).toHaveLength(headings.length);
    });
  });
});

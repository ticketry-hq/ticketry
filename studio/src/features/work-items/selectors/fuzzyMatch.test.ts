import { describe, expect, it } from "vitest";
import { fuzzyMatches } from "./fuzzyMatch";

describe("fuzzyMatches", () => {
  const hay = "meml-34 implementation child";

  it("keeps substring matches", () => {
    expect(fuzzyMatches(hay, "meml-34")).toBe(true);
    expect(fuzzyMatches(hay, "34")).toBe(true);
    expect(fuzzyMatches(hay, "implementation child")).toBe(true);
  });

  it("matches ordered subsequences per word", () => {
    expect(fuzzyMatches(hay, "impl chld")).toBe(true);
    expect(fuzzyMatches(hay, "mplmnttn")).toBe(true);
    expect(fuzzyMatches(hay, "child impl")).toBe(true);
  });

  it("rejects out-of-order or missing letters", () => {
    expect(fuzzyMatches(hay, "dlihc")).toBe(false);
    expect(fuzzyMatches(hay, "implz")).toBe(false);
    expect(fuzzyMatches(hay, "impl zebra")).toBe(false);
  });
});

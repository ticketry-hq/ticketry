import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function testFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("overhaul acceptance gate", () => {
  it("keeps the acceptance matrix and executable markers in parity", () => {
    const matrixIds = Array.from(
      readFileSync(
        join(process.cwd(), "docs", "overhaul-acceptance.md"),
        "utf8",
      ).matchAll(/^\|\s*(\d+)\s*\|/gm),
      (match) => match[1].padStart(2, "0"),
    );
    const counts = new Map<string, number>();
    for (const file of testFiles(join(process.cwd(), "src", "test"))) {
      const source = readFileSync(file, "utf8");
      // Two digits or more: the matrix passed one hundred cases, and a
      // two-digit-only pattern would silently fold `overhaul-100` into `10`.
      for (const match of source.matchAll(/\[overhaul-(\d{2,})\]/g)) {
        counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
      }
    }

    expect(
      Array.from(counts)
        .filter(([, count]) => count > 1)
        .map(([id]) => id),
    ).toEqual([]);
    expect(Array.from(counts.keys()).sort((a, b) => Number(a) - Number(b)))
      .toEqual(matrixIds);
  });
});

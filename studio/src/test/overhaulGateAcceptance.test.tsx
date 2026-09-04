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
  it("keeps one executable acceptance case for each formerly manual behavior", () => {
    const counts = new Map<string, number>();
    for (const file of testFiles(join(process.cwd(), "src", "test"))) {
      const source = readFileSync(file, "utf8");
      // Two digits or more: the matrix passed one hundred cases, and a
      // two-digit-only pattern would silently fold `overhaul-100` into `10`.
      for (const match of source.matchAll(/\[overhaul-(\d{2,})\]/g)) {
        counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
      }
    }

    expect(Object.fromEntries(counts)).toEqual(
      Object.fromEntries(
        Array.from({ length: 231 }, (_, index) => [
          String(index + 1).padStart(2, "0"),
          1,
        ]),
      ),
    );
  });
});

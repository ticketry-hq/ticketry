import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string, pattern: RegExp): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "target" ? [] : sourceFiles(path, pattern);
    }
    return pattern.test(entry.name) ? [path] : [];
  });
}

// A few cases are behaviors of the Rust crates rather than the Studio UI, so
// their marker lives with the Rust test that exercises them. The gate counts
// both places, which is what keeps one marker per case honest.
function markedFiles(): string[] {
  return [
    ...sourceFiles(join(process.cwd(), "src", "test"), /\.test\.tsx?$/),
    ...sourceFiles(join(process.cwd(), "src-tauri", "crates"), /\.rs$/),
  ];
}

describe("overhaul acceptance gate", () => {
  it("keeps one executable acceptance case for each formerly manual behavior", () => {
    const counts = new Map<string, number>();
    for (const file of markedFiles()) {
      const source = readFileSync(file, "utf8");
      // Two digits or more: the matrix passed one hundred cases, and a
      // two-digit-only pattern would silently fold `overhaul-100` into `10`.
      for (const match of source.matchAll(/\[overhaul-(\d{2,})\]/g)) {
        counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
      }
    }

    expect(Object.fromEntries(counts)).toEqual(
      Object.fromEntries(
        Array.from({ length: 335 }, (_, index) => [
          String(index + 1).padStart(2, "0"),
          1,
        ]),
      ),
    );
  });
});

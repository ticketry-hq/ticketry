import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import {
  findNonZeroRadii,
  findRoundedUtilities,
  type CornerFinding,
} from "./squareCornerScan";

// T664: Studio should read like a terminal — every surface is square. Rounded
// corners are eliminated at two seams: our own source declares no radius, and
// the global stylesheet flattens the third-party CSS we do not own.
// T674: the scan itself lives in ./squareCornerScan so the gate reads styling
// context rather than the English word "rounded".

const SRC_ROOT = join(process.cwd(), "src");
const STYLESHEET = join(SRC_ROOT, "app/styles/tailwind.css");
// Specs are not shipped surfaces, and acceptance specs (including this one)
// must be free to name the forbidden patterns in order to assert their absence.
const SPEC_ROOT = join(SRC_ROOT, "test");

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".css"];

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return path === SPEC_ROOT ? [] : collectSourceFiles(path);
    }
    if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      return [];
    }
    return [path];
  });
}

function offendingLines(
  scan: (source: string) => CornerFinding[],
): string[] {
  return collectSourceFiles(SRC_ROOT).flatMap((path) =>
    scan(readFileSync(path, "utf8")).map(
      (finding) => `${relative(SRC_ROOT, path)}:${finding.line}: ${finding.text}`,
    ),
  );
}

describe("overhaul acceptance — square corners", () => {
  it("[overhaul-89] declares no rounded-corner utility anywhere in Studio source", () => {
    expect(offendingLines(findRoundedUtilities)).toEqual([]);
  });

  it("declares no explicit corner radius anywhere in Studio source", () => {
    expect(offendingLines(findNonZeroRadii)).toEqual([]);
  });

  it("flattens corners globally so third-party CSS cannot round a surface", () => {
    const stylesheet = readFileSync(STYLESHEET, "utf8");

    expect(stylesheet).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*border-radius:\s*0\b/);
  });
});

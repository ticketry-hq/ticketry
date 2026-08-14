import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../..");

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (/\.(?:ts|tsx)$/.test(name)) found.push(path);
  }
  return found;
}

describe("query-key registry", () => {
  it("does not build TanStack query keys inline", () => {
    const inlineKey =
      /queryKey\s*:\s*\[|(?:setQueryData|getQueryData|removeQueries|cancelQueries|invalidateQueries|fetchQuery)\s*\(\s*\[|\[\s*\.\.\.queryKeys/;
    const violations = sourceFiles(SRC)
      .filter((path) => !path.includes(".test."))
      .filter((path) => relative(SRC, path) !== "shared/query/keys.ts")
      .filter((path) => inlineKey.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path).replace(/\\/g, "/"));

    expect(violations).toEqual([]);
  });
});

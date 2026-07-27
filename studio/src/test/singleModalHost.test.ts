import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// CODIN-915 regression: the default entry owns the one global host over the
// shared modal stack. This source-level guard keeps that ownership explicit.

const SRC = resolve(__dirname, "..");

function renders(file: string): boolean {
  return /<ModalHost\b/.test(readFileSync(resolve(SRC, file), "utf8"));
}

describe("single ModalHost over the shared modalStack (CODIN-915)", () => {
  it("the default entry renders the one global ModalHost", () => {
    expect(renders("main.tsx")).toBe(true);
  });
});

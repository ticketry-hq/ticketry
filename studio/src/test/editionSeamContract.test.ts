import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { expect, it } from "vitest";

const STUDIO = resolve(__dirname, "../..");
const EDITION_MODULE = "src/shared/config/edition.ts";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts|mjs|js)$/.test(name) ? [path] : [];
  });
}

const frontendSources = () => [
  ...sourceFiles(join(STUDIO, "src")),
  ...readdirSync(STUDIO).filter((name) => /^vite(st)?(\..+)?\.config\.ts$/.test(name)).map((name) => join(STUDIO, name)),
].map((path) => ({ path: relative(STUDIO, path), text: readFileSync(path, "utf8") }))
  .filter(({ path }) => path !== "src/test/editionSeamContract.test.ts");

it("only the frontend edition module reads the compiled edition define", () => {
  const readers = frontendSources().filter(({ text }) => text.includes("__TICKETRY_EDITION__")).map(({ path }) => path);
  expect(readers).toEqual([EDITION_MODULE]);
});

it("no Roadmap availability switch remains in frontend source or Vite/Vitest configuration", () => {
  const stale = frontendSources()
    .filter(({ text }) => /ROADMAP_ENABLED|roadmapAvailability|roadmap-build-policy|roadmap-off/.test(text))
    .map(({ path }) => path);
  expect(stale).toEqual([]);
});

it("the host-reported edition is informational: only the runtime contract and its validator touch it", () => {
  // Gating reads editionHas(); a frontend that consulted the host's edition
  // could render a different edition than the one it was compiled as.
  const readers = frontendSources()
    .filter(({ path }) => !/\.test\.tsx?$/.test(path))
    .filter(({ text }) => /\.edition\b|\[["']edition["']\]|\{[^}]*\bedition\b[^}]*\}\s*=/.test(text))
    .map(({ path }) => path);
  expect(readers).toEqual(["src/runtime/desktopRuntimeConfiguration.ts"]);
});

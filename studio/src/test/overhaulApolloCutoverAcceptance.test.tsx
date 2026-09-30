import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const STUDIO = join(process.cwd());
const SOURCE = join(STUDIO, "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

describe("Apollo cutover acceptance", () => {
  it("[overhaul-163] leaves Apollo as Studio's only server-state client", () => {
    const files = sourceFiles(SOURCE);
    const tanstackPackage = ["@tanstack", "react-query"].join("/");
    const foundationClient = ["graphql-foundation", "foundationClient"].join("/");
    const tanstackReferences = files.flatMap((path) =>
      readFileSync(path, "utf8").includes(tanstackPackage)
        ? [relative(STUDIO, path)]
        : [],
    );
    const retiredFoundationClient = files.flatMap((path) =>
      readFileSync(path, "utf8").includes(foundationClient)
        ? [relative(STUDIO, path)]
        : [],
    );
    const packageManifest = readFileSync(join(STUDIO, "package.json"), "utf8");

    expect(tanstackReferences).toEqual([]);
    expect(retiredFoundationClient).toEqual([]);
    expect(packageManifest).not.toContain(tanstackPackage);
  });

  it("[overhaul-167] leaves Apollo as Studio's only application-state owner", () => {
    const files = sourceFiles(SOURCE);
    const retiredStateLibrary = ["zu", "stand"].join("");
    const retiredReferences = files.flatMap((path) =>
      readFileSync(path, "utf8").toLowerCase().includes(retiredStateLibrary)
        ? [relative(STUDIO, path)]
        : [],
    );
    const packageManifest = readFileSync(join(STUDIO, "package.json"), "utf8");
    const localState = readFileSync(
      join(SOURCE, "shared", "apollo", "localState.ts"),
      "utf8",
    );

    expect(retiredReferences).toEqual([]);
    expect(packageManifest.toLowerCase()).not.toContain(retiredStateLibrary);
    expect(localState).toContain("studioApolloClient().cache.writeFragment");
  });
});

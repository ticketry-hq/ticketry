import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Profiles, feature flags, and recent-project lists are gone from live code.
 *
 * A Module's folder is its own typed ModuleLink row, and this version ships one
 * installation project with no gates over it. This test fails when any of those
 * retired concepts reappears in a shipping source file, which is the cheapest
 * way to keep the removal from being undone one convenient import at a time.
 *
 * Historical migration remains legal: the Rust host still reads a legacy
 * `profiles.json` so a previous install's links can be imported once. Nothing
 * in the frontend does.
 */

// Vitest runs from the Studio workspace root.
const STUDIO_ROOT = process.cwd();
const SOURCE_ROOT = join(STUDIO_ROOT, "src");

/** Directories that are not shipping frontend code. */
const SKIPPED_DIRECTORIES = new Set(["generated", "node_modules", "test"]);

/** The generated contract is regenerated, never hand-edited, so it is checked
 * separately and by name rather than by pattern. */
const GENERATED_SDL = join(
  STUDIO_ROOT,
  "src/graphql-foundation/generated/schema.graphql",
);

const RETIRED_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "profile transport", pattern: /profileTransport/ },
  { name: "local settings profile graph", pattern: /local_settings|LocalProfile/ },
  { name: "profile selection", pattern: /recent_profile_index|recentProfileIndex/ },
  { name: "per-project recent module map", pattern: /recent_module_ids/ },
  { name: "recent-project list", pattern: /recentProjects|recent_project_id/ },
  { name: "feature flags", pattern: /replace_feature_flags|LocalFeatureFlags/ },
  { name: "feature gate reads", pattern: /features\.(sidebar|projects)\b/ },
  { name: "sidebar feature gate", pattern: /isSidebarEnabled/ },
  { name: "config store", pattern: /studio\/stores\/configStore/ },
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry) ? [] : sourceFiles(path);
    }
    return /\.(ts|tsx|graphql)$/.test(entry) ? [path] : [];
  });
}

describe("profile and feature removal", () => {
  const files = sourceFiles(SOURCE_ROOT);

  it("finds shipping frontend sources to search", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(RETIRED_PATTERNS)(
    "carries no $name in live frontend code",
    ({ pattern }) => {
      const offenders = files.filter((path) =>
        pattern.test(readFileSync(path, "utf8")),
      );

      expect(offenders.map((path) => relative(STUDIO_ROOT, path))).toEqual([]);
    },
  );

  it("publishes no profile or feature-flag operations in the generated contract", () => {
    const sdl = readFileSync(GENERATED_SDL, "utf8");

    expect(sdl).not.toMatch(/LocalSettings|LocalProfile|LocalFeatureFlags/);
    expect(sdl).not.toMatch(/local_settings|_local_profile|replace_feature_flags/);
    // The typed link that replaced them is the published contract.
    expect(sdl).toMatch(/ModuleLink/);
  });
});

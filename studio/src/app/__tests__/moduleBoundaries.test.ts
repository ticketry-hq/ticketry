import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SRC = resolve(__dirname, "../..");
const PRODUCT_ROOTS = [
  "features/agents",
  "features/studio",
  "features/projects",
  "features/settings",
  "features/work-items",
  "features/workflows",
] as const;

// Deliberately small product interfaces. Heavy UI files are also explicit
// entrypoints because React.lazy() must name a literal, statically analyzable
// module instead of pulling a broad barrel into the initial chunk.
const PUBLIC_ENTRYPOINTS = new Set([
  "features/agents/api/agentApi",
  "features/agents/lifecycle",
  "features/agents/status",
  "features/agents/status/stream/statusStreamFeed",
  "features/agents/terminal",
  "features/agents/terminal/appNavigation",
  "features/agents/terminal/create/launchTerminalCreate",
  "features/agents/terminal/create/types",
  "features/agents/terminal/AgentPicker",
  "features/agents/terminal/ModuleFolder",
  "features/agents/terminal/ModuleFolderSelection",
  "features/agents/terminal/PromptInput",
  "features/agents/types",
  "features/agents/worktrees",
  "features/studio/lib/liveTerminalCycle",
  "features/studio/lib/defaultProject",
  "features/studio/lib/planeUrl",
  "features/work-items",
  "features/studio/lib/types",
  "features/studio/modals/AddModule",
  "features/studio/modals/AddProject",
  "features/studio/modals/KeyboardShortcutsModal",
  "features/studio/modals/ParentUpdate",
  "features/studio/modals/PlanFeature",
  "features/studio/modals/SettingsModal",
  "features/studio/modals/StatusUpdate",
  "features/studio/stores/configStore",
  "state/clientStore",
  "features/projects",
  "features/settings",
  "features/settings/changeLedger",
  "features/settings/store",
  "features/work-items",
  "features/workflows",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const pattern = /(?:from\s+|import\s*\(\s*|vi\.(?:mock|importActual)\s*\(\s*)["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    if (match[1].startsWith(".")) out.push(match[1]);
  }
  return out;
}

function productRoot(path: string): string | null {
  return PRODUCT_ROOTS.find(
    (root) => path === root || path.startsWith(`${root}/`),
  ) ?? null;
}

describe("module boundaries", () => {
  it("keeps headless WorkTracker features independent of app UI", () => {
    const violations: string[] = [];
    for (const root of ["projects", "work-items", "workflows"] as const) {
      for (const file of walk(join(SRC, "features", root))) {
        if (file.includes(".test.")) continue;
        const importer = relative(SRC, file).replace(/\\/g, "/");
        for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
          const target = relative(SRC, resolve(dirname(file), specifier)).replace(/\\/g, "/");
          if (target.startsWith("app/")) violations.push(`${importer} imports app UI ${target}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("makes app consumers use WorkTracker feature indexes", () => {
    const violations: string[] = [];
    const workTrackerRoots = [
      "features/projects",
      "features/work-items",
      "features/workflows",
    ];
    for (const file of walk(join(SRC, "app"))) {
      if (file.includes("/__tests__/") || file.includes(".test.")) continue;
      const importer = relative(SRC, file).replace(/\\/g, "/");
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        const target = relative(SRC, resolve(dirname(file), specifier))
          .replace(/\\/g, "/")
          .replace(/\.(?:ts|tsx)$/, "");
        for (const root of workTrackerRoots) {
          if (target.startsWith(`${root}/`)) {
            violations.push(`${importer} reaches past ${root}/index.ts into ${target}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps the WorkTracker data-layer shape explicit", () => {
    for (const root of ["projects", "work-items", "workflows"] as const) {
      for (const directory of ["operations", "generated", "queries", "selectors"] as const) {
        expect(statSync(join(SRC, "features", root, directory)).isDirectory()).toBe(true);
      }
      expect(statSync(join(SRC, "features", root, "index.ts")).isFile()).toBe(true);
    }
  });

  it("makes the visible Studio composition readable from the app tree", () => {
    const expectedImports: Record<string, string[]> = {
      "app/StudioApp.tsx": ["./shell/StudioShell"],
      "app/shell/StudioShell.tsx": ["./StudioLayout"],
      "app/shell/StudioLayout.tsx": [
        "./sidebar/StudioSidebar",
        "./ticket-workspace/TicketWorkspace",
      ],
      "app/shell/ticket-workspace/TicketWorkspace.tsx": [
        "./tasks/TasksPane",
        "./selected-ticket/SelectedTicket",
      ],
    };

    for (const [file, imports] of Object.entries(expectedImports)) {
      const source = readFileSync(join(SRC, file), "utf8");
      for (const specifier of imports) expect(source).toContain(specifier);
    }
  });

  it("keeps shared modules independent of app and product code", () => {
    const violations: string[] = [];
    for (const file of walk(join(SRC, "shared"))) {
      const importer = relative(SRC, file).replace(/\\/g, "/");
      if (importer.includes(".test.")) continue;
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        const target = relative(SRC, resolve(dirname(file), specifier)).replace(/\\/g, "/");
        if (target.startsWith("app/") || target.startsWith("features/")) {
          violations.push(`${importer} imports upward into ${target}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("cross-product imports use an explicit public entrypoint", () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const importer = relative(SRC, file).replace(/\\/g, "/");
      if (importer.startsWith("test/") || importer.includes("/__tests__/") || importer.includes(".test.")) continue;
      const importerRoot = productRoot(importer);
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        const target = relative(SRC, resolve(dirname(file), specifier))
          .replace(/\\/g, "/")
          .replace(/\.(?:ts|tsx)$/, "");
        const targetRoot = productRoot(target);
        if (!targetRoot || targetRoot === importerRoot) continue;
        if (!PUBLIC_ENTRYPOINTS.has(target)) {
          violations.push(`${importer} imports private module ${target}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("contains no legacy catch-all or pre-boundary directories", () => {
    const legacy = [
      "agentstatus", "studio", "docs", "fields", "issue", "kit", "lib", "lifecycle",
      "modal", "prompts", "shell", "stores", "terminal", "workitems", "worktree",
    ];
    const present = legacy.filter((name) => {
      try {
        return statSync(join(SRC, name)).isDirectory();
      } catch {
        return false;
      }
    });
    expect(present).toEqual([]);
  });

  it("uses named interfaces instead of export-star barrels", () => {
    const violations = walk(SRC)
      .filter((file) => {
        const path = relative(SRC, file).replace(/\\/g, "/");
        return !path.startsWith("test/") && !path.includes("/__tests__/") && !path.includes(".test.");
      })
      .filter((file) => /\bexport\s+(?:type\s+)?\*/.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file).replace(/\\/g, "/"));
    expect(violations).toEqual([]);
  });
});

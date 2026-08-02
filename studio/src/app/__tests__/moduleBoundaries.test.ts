import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SRC = resolve(__dirname, "../..");
const PRODUCT_ROOTS = [
  "features/agents",
  "features/studio",
  "features/documents",
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
  "features/agents/status/statusFeed",
  "features/agents/stores/configStore",
  "features/agents/terminal",
  "features/agents/terminal/appNavigation",
  "features/agents/terminal/create/launchTerminalCreate",
  "features/agents/terminal/create/types",
  "features/agents/terminal/AgentPicker",
  "features/agents/terminal/ModuleFolder",
  "features/agents/terminal/ModuleFolderSelection",
  "features/agents/terminal/PromptInput",
  "features/agents/terminal/WorkspaceTerminalHost",
  "features/agents/types",
  "features/agents/worktrees",
  "features/studio/components/ModuleTabStrip",
  "features/studio/lib/api",
  "features/studio/lib/liveTerminalCycle",
  "features/studio/lib/planeUrl",
  "features/studio/lib/taskTree",
  "features/studio/modals/AddModule",
  "features/studio/modals/AddProject",
  "features/studio/modals/KeyboardShortcutsModal",
  "features/studio/modals/ParentUpdate",
  "features/studio/modals/PlanFeature",
  "features/studio/modals/SettingsModal",
  "features/studio/modals/StatusUpdate",
  "features/studio/pages/modules/ModulesPane",
  "features/studio/pages/projects/ProjectsPane",
  "features/studio/pages/tasks/storiesFocus",
  "features/studio/pages/tasks/TasksPane",
  "features/studio/pages/tasks/hooks/useTaskTree",
  "features/studio/pages/workspace/TicketWorkspace",
  "features/studio/stores/configStore",
  "features/studio/stores/tasksStore",
  "features/studio/stores/uiStore",
  "features/studio/workflowApi",
  "features/documents/DescriptionEditor",
  "features/documents/WorkspaceDocTab",
  "features/projects",
  "features/projects/store",
  "features/settings/changeLedger",
  "features/settings/store",
  "features/work-items",
  "features/work-items/issue-detail",
  "features/work-items/issue-detail/appNavigation",
  "features/work-items/stores/selectionStore",
  "features/workflows/ModelConfigurationPanel",
  "features/workflows/LaunchDefaultPicker",
  "features/workflows/launchBindingValidation",
  "features/workflows/launchProviderCatalog",
  "features/workflows/StateConfigurationPanel",
  "features/workflows/WorkflowSettingsPanel",
  "features/workflows/stateCatalogSync",
  "features/workflows/workflowEditorStore",
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

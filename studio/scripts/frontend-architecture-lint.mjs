import fs from "node:fs";
import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(studioRoot, "src");

// Existing shell dependencies, including the workspace compatibility split.
// Each exception permits only this importer/target pair.
const existingFeatureToAppImports = new Set([
  "features/agents/actions/agentRunActions.ts -> app/navigation/actionIds",
  "features/agents/terminal/AgentPicker.tsx -> app/modal/ModalShell",
  "features/agents/terminal/AgentPicker.tsx -> app/modal/modalStore",
  "features/agents/terminal/AgentPicker.tsx -> app/navigation/keymapRegistry",
  "features/agents/terminal/ModuleFolder.tsx -> app/modal/ModalShell",
  "features/agents/terminal/ModuleFolder.tsx -> app/modal/modalStore",
  "features/agents/terminal/ModuleFolder.tsx -> app/navigation/keymapRegistry",
  "features/agents/terminal/PromptInput.tsx -> app/modal/ModalShell",
  "features/agents/terminal/PromptInput.tsx -> app/modal/modalStore",
  "features/agents/terminal/PromptInput.tsx -> app/navigation/keymapRegistry",
  "features/agents/terminal/internal/modalOcclusion.ts -> app/modal/modalStore",
  "features/agents/terminal/internal/modalOcclusion.ts -> app/shell/dialogStore",
  "features/agents/terminal/internal/nativeRenderRecovery.ts -> app/startup/reloadStudio",
  "features/module-tabs/moduleJumpBadgeState.ts -> app/navigation/keymapRegistry",
  "features/module-tabs/useModuleJumpBadges.ts -> app/navigation/chordLabel",
  "features/module-tabs/useModuleJumpBadges.ts -> app/navigation/keymapRegistry",
  "features/launchkey/launchkeyController.ts -> app/navigation/actionIds",
  "features/launchkey/launchkeyController.ts -> app/navigation/keymapRegistry",
  "features/studio/lib/liveTerminalCycle.ts -> app/shell/ticket-workspace/tasks/TasksPane",
  "features/studio/modals/AddModule.tsx -> app/modal/ModalShell",
  "features/studio/modals/AddModule.tsx -> app/modal/modalStore",
  "features/studio/modals/AddModule.tsx -> app/navigation/keymapRegistry",
  "features/studio/modals/AddModule.tsx -> app/onboarding/onboardingTourStore",
  "features/studio/modals/AddProject.tsx -> app/modal/ModalShell",
  "features/studio/modals/AddProject.tsx -> app/modal/modalStore",
  "features/studio/modals/AddProject.tsx -> app/navigation/keymapRegistry",
  "features/studio/modals/KeybindingSettings.tsx -> app/navigation/keymapRegistry",
  "features/studio/modals/KeybindingSettings.tsx -> app/navigation/keymapSettings",
  "features/studio/modals/KeyboardSettingsPanel.tsx -> app/navigation/keymapRegistry",
  "features/studio/modals/KeyboardShortcutsModal.tsx -> app/modal/ModalShell",
  "features/studio/modals/KeyboardShortcutsModal.tsx -> app/navigation/keymapRegistry",
  "features/studio/modals/KeyboardShortcutsModal.tsx -> app/navigation/three-zone/threeZoneNavigation",
  "features/studio/modals/ParentUpdate.tsx -> app/modal/ModalShell",
  "features/studio/modals/ParentUpdate.tsx -> app/modal/modalStore",
  "features/studio/modals/ParentUpdate.tsx -> app/navigation/keymapRegistry",
  "features/studio/modals/PlanFeature.tsx -> app/modal/modalStore",
  "features/studio/modals/SettingsModal.tsx -> app/modal/modalStore",
  "features/studio/modals/StatusUpdate.tsx -> app/modal/ModalShell",
  "features/studio/modals/StatusUpdate.tsx -> app/modal/modalStore",
  "features/studio/modals/StatusUpdate.tsx -> app/navigation/keymapRegistry",
  "features/workspace-state/moduleSelection.ts -> app/modal/modalStore",
  "features/workspace-state/shellCompatibility.ts -> app/shell/dialogStore",
  "features/workspace-state/shellCompatibility.ts -> app/shell/toastStore",
  "features/workspace-state/types.ts -> app/shell/dialogStore",
  "features/workspace-state/types.ts -> app/shell/toastStore",
  "features/workspace-state/workspaceStore.ts -> app/shell/dialogStore",
  "features/workspace-state/workspaceStore.ts -> app/shell/toastStore"
]);

const existingDocumentUiFiles = new Set([
  "app/shell/ticket-workspace/selected-ticket/documents/DescriptionEditor.tsx",
  "app/shell/ticket-workspace/selected-ticket/documents/DocViewer.tsx",
  "app/shell/ticket-workspace/selected-ticket/documents/RichMarkdownEditor.tsx",
  "app/shell/ticket-workspace/selected-ticket/documents/WorkspaceDocument.tsx",
  "app/shell/ticket-workspace/selected-ticket/documents/codeMirrorDarkTheme.ts",
  "app/shell/ticket-workspace/selected-ticket/documents/markdown.ts",
  "app/shell/ticket-workspace/selected-ticket/documents/queries.ts",
]);

function importedSpecifiers(source) {
  const specifiers = [];
  const syntax = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      specifiers.push(node.arguments[0].text);
    } else if (ts.isExternalModuleReference(node) && node.expression && ts.isStringLiteral(node.expression)) {
      specifiers.push(node.expression.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
        && ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return specifiers;
}

function targetPath(importer, specifier) {
  if (specifier.startsWith("@/")) {
    return path.posix.normalize(specifier.slice(2));
  }
  if (!specifier.startsWith(".")) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
}

export function architectureViolations(entries) {
  const violations = [];
  for (const { file, source } of entries) {
    const normalizedFile = file.split(path.sep).join("/");
    if (
      normalizedFile.startsWith("app/shell/ticket-workspace/selected-ticket/documents/")
      && !existingDocumentUiFiles.has(normalizedFile)
    ) {
      violations.push(`${normalizedFile}: document UI belongs in features/documents`);
    }
    for (const specifier of importedSpecifiers(source)) {
      const target = targetPath(normalizedFile, specifier);
      if (!target) continue;
      if (
        normalizedFile.startsWith("state/")
        && target.replace(/\.(?:ts|tsx)$/, "") === "shared/api/types"
      ) {
        violations.push(`${normalizedFile}: client state may not import server record types`);
      }
      if (
        normalizedFile.startsWith("shared/")
        && /^(?:app|features|state)\//.test(target)
      ) {
        violations.push(`${normalizedFile}: shared code may not depend on app, features, or state`);
      }
      if (
        normalizedFile.startsWith("features/")
        && target.startsWith("app/")
        && !existingFeatureToAppImports.has(`${normalizedFile} -> ${target}`)
      ) {
        violations.push(`${normalizedFile}: feature code may not add a dependency on app`);
      }
    }
  }
  return violations;
}

function applicationSources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "generated" || entry.name === "test") return [];
      return applicationSources(absolute);
    }
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.test\.(?:ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [{
      file: path.relative(sourceRoot, absolute),
      source: fs.readFileSync(absolute, "utf8"),
    }];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = architectureViolations(applicationSources(sourceRoot));
  if (violations.length > 0) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  }
}

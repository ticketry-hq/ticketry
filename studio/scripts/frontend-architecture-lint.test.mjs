import assert from "node:assert/strict";
import test from "node:test";

import { architectureViolations } from "./frontend-architecture-lint.mjs";

test("accepts dependency directions owned by the feature", () => {
  assert.deepEqual(architectureViolations([
    {
      file: "features/documents/Viewer.tsx",
      source: 'import { documentUrl } from "./documentUrl";',
    },
  ]), []);
});

test("resolves alternate relative spellings before checking state imports", () => {
  assert.deepEqual(architectureViolations([
    {
      file: "state/nested/store.ts",
      source: 'import type { WorkItem } from "../../shared/api/../api/types";',
    },
  ]), [
    "state/nested/store.ts: client state may not import server record types",
  ]);
});

test("rejects new feature-to-app dependencies and shell-owned document UI", () => {
  assert.deepEqual(architectureViolations([
    {
      file: "features/new-domain/panel.ts",
      source: 'import { ModalShell } from "../../app/modal/ModalShell";',
    },
    {
      file: "app/shell/ticket-workspace/selected-ticket/documents/Editor.tsx",
      source: "export const Editor = null;",
    },
  ]), [
    "features/new-domain/panel.ts: feature code may not add a dependency on app",
    "app/shell/ticket-workspace/selected-ticket/documents/Editor.tsx: document UI belongs in features/documents",
  ]);
});

test("checks side-effect, dynamic, re-export, and type-only imports", () => {
  for (const source of [
    'import "../../app/startup";',
    'void import("../../app/startup");',
    'export { start } from "../../app/startup";',
    'type Start = import("../../app/startup").Start;',
    'import startup = require("../../app/startup");',
  ]) {
    assert.equal(architectureViolations([{ file: "features/new/Thing.ts", source }]).length, 1, source);
  }
});

test("grandfathers only existing importer and target pairs", () => {
  const file = "features/agents/terminal/AgentPicker.tsx";
  assert.deepEqual(architectureViolations([{ file, source: 'import { useModalStore } from "../../../app/modal/modalStore";' }]), []);
  assert.equal(architectureViolations([{ file, source: 'import "../../../app/startup";' }]).length, 1);
});

test("ignores comments and strings that resemble imports", () => {
  assert.deepEqual(architectureViolations([{
    file: "features/new/Thing.ts",
    source: '// import "../../app/startup";\nconst example = `import "../../app/startup";`;'
  }]), []);
});

test("task workspace callers use the rendered or navigation public entry", () => {
  const file = "app/shell/Workspace.tsx";
  for (const target of ["features/task-workspace", "features/task-workspace/index.ts", "features/task-workspace/navigation"]) {
    assert.deepEqual(architectureViolations([{ file, source: `import "@/${target}";` }]), []);
  }
  for (const target of ["features/task-workspace/internal/useWorkspaceTabActions", "features/task-workspace/TaskWorkspace", "features/task-workspace/types"]) {
    assert.deepEqual(architectureViolations([{ file, source: `import "@/${target}";` }]), [
      `${file}: task workspace callers must use its public entry`,
    ]);
  }
  assert.deepEqual(architectureViolations([{
    file: "features/task-workspace/TaskWorkspace.tsx",
    source: 'import "./internal/useWorkspaceTabActions";',
  }]), []);
});

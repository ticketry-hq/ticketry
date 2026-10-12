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

test("requires new feature and app consumers to use the document conversion seam", () => {
  for (const file of ["features/new/Thing.ts", "app/new/Thing.ts"]) {
    for (const helper of ["publicWorktrackerId", "compactWorktrackerId", "publicWorktrackerTimestamp"]) {
      assert.deepEqual(architectureViolations([{
        file,
        source: `import { ${helper} as convert } from "@/shared/api/generatedWorktracker";`,
      }]), [`${file}: ${helper} must be accessed through the WorkTracker document conversion seam`]);
    }
  }
});

test("cannot bypass the helper guard through namespace, dynamic, or re-export access", () => {
  const file = "features/new/Thing.ts";
  for (const source of [
    'import * as helpers from "../../shared/api/../api/generatedWorktracker.ts";',
    'void import("@/shared/api/generatedWorktracker");',
    'export * from "@/shared/api/generatedWorktracker";',
    'export * as helpers from "@/shared/api/generatedWorktracker";',
    'import helpers = require("@/shared/api/generatedWorktracker");',
    'const helpers = require("@/shared/api/generatedWorktracker");',
    'type Helpers = typeof import("@/shared/api/generatedWorktracker");',
  ]) {
    assert.equal(architectureViolations([{ file, source }]).length, 3, source);
  }
  for (const source of [
    'export { publicWorktrackerId as convert } from "@/shared/api/generatedWorktracker";',
    'import { publicWorktrackerId as convert } from "@/shared/api/barrel";',
  ]) {
    assert.equal(architectureViolations([{ file, source }]).length, 1, source);
  }
});

test("grandfathers only each existing importer and helper pair", () => {
  const file = "features/agents/status/stream/workItemInvalidation.ts";
  assert.deepEqual(architectureViolations([{
    file,
    source: 'import { compactWorktrackerId as compact } from "../../shared/api/generatedWorktracker";',
  }]), []);
  assert.equal(architectureViolations([{
    file,
    source: 'import { publicWorktrackerId } from "../../shared/api/generatedWorktracker";',
  }]).length, 1);
  assert.equal(architectureViolations([{
    file: "features/work-items/newTransport.ts",
    source: 'import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";',
  }]).length, 1);
});

test("preserves optimistic and shared normalization consumers and allows the document seam", () => {
  assert.deepEqual(architectureViolations([
    {
      file: "features/work-items/internal/optimisticTransition.ts",
      source: 'import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";',
    },
    {
      file: "features/work-items/internal/optimisticCreation.ts",
      source: 'import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";',
    },
    {
      file: "features/work-items/planMutation.ts",
      source: 'import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";',
    },
    {
      file: "features/work-items/planWriteGuard.ts",
      source: 'import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";',
    },
    {
      file: "shared/apollo/cacheKeys.ts",
      source: 'import { compactWorktrackerId } from "../api/generatedWorktracker";',
    },
    {
      file: "shared/persistence/route.ts",
      source: 'import { publicWorktrackerId } from "../api/generatedWorktracker";',
    },
    {
      file: "features/new/Thing.ts",
      source: 'import { publicResult, serverVariables } from "@/shared/api/worktrackerConversion";',
    },
    {
      file: "app/new/Thing.ts",
      source: '// import { publicWorktrackerId } from "@/shared/api/generatedWorktracker";\nconst example = `import { compactWorktrackerId } from "@/shared/api/generatedWorktracker";`;'
    },
  ]), []);
});


test("work-item writes must use generated document conversion instead of helper exceptions", () => {
  for (const file of [
    "features/work-items/mutationTransport.ts",
    "features/work-items/mutations.ts",
  ]) {
    assert.deepEqual(architectureViolations([{
      file,
      source: 'import { compactWorktrackerId } from "@/shared/api/generatedWorktracker";',
    }]), [`${file}: compactWorktrackerId must be accessed through the WorkTracker document conversion seam`]);
  }
});


test("client state cannot import generated contracts or feature record views", () => {
  for (const target of [
    "features/projects/generated/projects.documents",
    "features/work-items/generated/workItems.documents",
    "features/workflows/generated/workflows.documents",
    "graphql-foundation/generated/schemaTypes",
    "features/projects/types", "features/projects",
    "features/work-items/types", "features/work-items",
    "features/workflows/types", "features/workflows",
  ]) {
    for (const source of [
      `import type { Record } from "@/${target}";`,
      `export * from "../../${target}.ts";`,
      `type Record = import("@/${target}").Record;`,
    ]) {
      assert.deepEqual(architectureViolations([{ file: "state/nested/store.ts", source }]), [
        "state/nested/store.ts: client state may not import server record types",
      ], source);
    }
  }
  assert.deepEqual(architectureViolations([{
    file: "state/store.ts",
    source: 'import type { Settings } from "@/features/settings/providerCatalogTypes";',
  }]), []);
});

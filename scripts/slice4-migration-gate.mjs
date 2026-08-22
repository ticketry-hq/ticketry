import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const includePackagedSmoke = process.argv.includes("--packaged");

const rustTests = [
  "design_document_adoption",
  "design_document_generated_mutation_audit",
  "design_document_graphql",
  "document_discovery",
  "document_save",
  "document_watch",
  "slice4_ownership_handoff",
  "workspace_operation_journal",
  "worktree_creation",
  "worktree_discard",
  "worktree_generated_mutation_audit",
  "worktree_integration",
  "worktree_live_status",
  "worktree_metadata_adoption",
];

function run(label, command, args, environment = process.env) {
  console.log(`\n[Slice 4 gate] ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with ${code ?? signal}`));
    });
  });
}

const isolatedData = await mkdtemp(path.join(tmpdir(), "ticketry-slice4-gate-"));
try {
  await run(
    "focused Rust adoption, GraphQL, crash, security, concurrency, and one-writer tests",
    "cargo",
    [
      "test",
      "--manifest-path",
      "studio/src-tauri/Cargo.toml",
      ...rustTests.flatMap((test) => ["--test", test]),
      "--no-fail-fast",
    ],
  );
  await run(
    "deterministic SDL, TypeScript, entity, and operation generation",
    "npm",
    ["run", "graphql:drift", "--workspace", "@worktracker/studio"],
  );
  await run(
    "Python write-ownership boundary",
    "backend/.venv/bin/pytest",
    [
      "-q",
      "backend/apps/documents/tests/test_workspace_write_ownership.py",
      "backend/studio_server/tests/test_terminal_retirement.py",
    ],
    { ...process.env, MUXED_DATA_DIR: isolatedData },
  );
  await run(
    "numbered Studio overhaul acceptance",
    "npm",
    ["run", "test:overhaul", "--workspace", "@worktracker/studio"],
  );
  await run(
    "focused Studio document and worktree units",
    "npm",
    [
      "exec",
      "--workspace",
      "@worktracker/studio",
      "--",
      "vitest",
      "run",
      "src/test/DocViewer.test.tsx",
      "src/features/documents",
      "src/features/agents/worktrees",
    ],
  );
  await run(
    "document and scratch browser acceptance",
    "npm",
    [
      "exec",
      "--workspace",
      "@worktracker/studio",
      "--",
      "playwright",
      "test",
      "e2e/onboarding.setup.ts",
      "e2e/documents-and-scratch.spec.ts",
    ],
  );
  if (includePackagedSmoke) {
    await run(
      "packaged desktop startup and asset smoke",
      "npm",
      ["run", "desktop:smoke:packaged"],
    );
  }
} finally {
  await rm(isolatedData, { recursive: true, force: true });
}

console.log(`\nSlice 4 migration gate passed${includePackagedSmoke ? " with packaged smoke" : ""}.`);

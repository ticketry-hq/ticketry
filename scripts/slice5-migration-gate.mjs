import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const includePackagedAcceptance = process.argv.includes("--packaged");

const focusedRustTests = [
  "agent_run_lifecycle",
  "automation_attempts",
  "crash_safe_launch_reconciliation",
  "launch_policy_resolution",
  "prepared_launch_effects",
  "provider_catalog",
  "run_launch_paths",
  "runs_persistence",
  "terminal_cleanup",
  "terminal_launch",
  "terminal_lifecycle_harness",
  "terminal_persistence_adoption",
  "terminal_reconciliation",
  "terminal_resume_launch",
  "terminal_resume_query",
  "terminal_session_graphql",
  "viewer_ownership",
];

const focusedRustUnitFilters = [
  "hook_spool::tests::",
  "launch_planning::golden_tests::",
  "terminal_lifecycle::runtime::tests::",
  "terminal_persistence::adoption::tests::",
  "tmux_adapter::session_records::tests::",
];

const realTmuxTests = [
  "native_terminal_scroll_bridge",
  "tmux_adapter",
  "tmux_viewer",
];

function run(label, command, args, environment = process.env) {
  console.log(`\n[Slice 5 gate] ${label}`);
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

const isolatedData = await mkdtemp(path.join(tmpdir(), "ticketry-slice5-gate-"));
try {
  for (const filter of focusedRustUnitFilters) {
    await run(`focused Rust unit tests: ${filter}`, "cargo", [
      "test",
      "--locked",
      "--manifest-path",
      "studio/src-tauri/Cargo.toml",
      "--lib",
      filter,
    ]);
  }
  await run(
    "focused Rust terminal lifecycle, recovery, adoption, and GraphQL tests",
    "cargo",
    [
      "test",
      "--locked",
      "--manifest-path",
      "studio/src-tauri/Cargo.toml",
      ...focusedRustTests.flatMap((test) => ["--test", test]),
      "--no-fail-fast",
    ],
  );
  await run(
    "generated entity, SDL, operation, and TypeScript drift",
    "npm",
    ["run", "graphql:drift", "--workspace", "@worktracker/studio"],
  );
  await run(
    "locked Rust check",
    "cargo",
    ["check", "--locked", "--manifest-path", "studio/src-tauri/Cargo.toml"],
  );
  await run(
    "Python terminal retirement and packaged exclusion boundary",
    "backend/.venv/bin/pytest",
    [
      "-q",
      "backend/studio_server/tests/test_terminal_retirement.py",
      "backend/packaging/tests/test_packaging_recipe.py",
    ],
    { ...process.env, MUXED_DATA_DIR: isolatedData },
  );
  await run(
    "Studio and generated SDK typecheck",
    "npm",
    ["run", "typecheck"],
  );
  await run(
    "numbered Studio overhaul acceptance",
    "npm",
    ["run", "test:overhaul", "--workspace", "@worktracker/studio"],
  );
  await run(
    "terminal frontend tests",
    "npm",
    [
      "exec",
      "--workspace",
      "@worktracker/studio",
      "--",
      "vitest",
      "run",
      "src/features/agents/terminal",
      "src/test/terminal",
    ],
  );
  await run(
    "real-tmux integration tests",
    "cargo",
    [
      "test",
      "--locked",
      "--manifest-path",
      "studio/src-tauri/Cargo.toml",
      ...realTmuxTests.flatMap((test) => ["--test", test]),
      "--no-fail-fast",
    ],
  );
  if (includePackagedAcceptance) {
    await run(
      "unsigned packaged desktop artifact build",
      "npm",
      [
        "run",
        "release:build",
        "--workspace",
        "@worktracker/studio",
        "--",
        "--allow-unsigned",
      ],
    );
    await run(
      "installed-artifact terminal recovery acceptance",
      "npm",
      ["run", "release:acceptance", "--workspace", "@worktracker/studio"],
    );
  }
} finally {
  await rm(isolatedData, { recursive: true, force: true });
}

console.log(
  `\nSlice 5 migration gate passed${includePackagedAcceptance ? " with packaged acceptance" : ""}.`,
);

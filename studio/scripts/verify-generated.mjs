import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  generateFoundationArtifacts,
  studioRoot,
} from "./graphql-foundation-generation.mjs";

async function files(directory, prefix = "") {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.name === "generation.sqlite3") continue;
    if (entry.isDirectory()) {
      found.push(...await files(join(directory, entry.name), relative));
    } else {
      found.push(relative);
    }
  }
  return found.sort();
}

async function assertSameFile(left, right, label) {
  const [leftBytes, rightBytes] = await Promise.all([readFile(left), readFile(right)]);
  if (!leftBytes.equals(rightBytes)) {
    throw new Error(`${label} differs:\n  ${left}\n  ${right}`);
  }
}

async function assertSameTree(left, right, label) {
  const [leftFiles, rightFiles] = await Promise.all([files(left), files(right)]);
  if (JSON.stringify(leftFiles) !== JSON.stringify(rightFiles)) {
    throw new Error(`${label} file lists differ`);
  }
  for (const relative of leftFiles) {
    await assertSameFile(join(left, relative), join(right, relative), `${label}/${relative}`);
  }
}

const scratch = await mkdtemp(join(tmpdir(), "ticketry-graphql-verify-"));
const first = join(scratch, "first");
const second = join(scratch, "second");
try {
  await generateFoundationArtifacts(first);
  await generateFoundationArtifacts(second);
  await assertSameTree(first, second, "deterministic generation");

  await assertSameTree(
    join(first, "entities"),
    join(studioRoot, "src-tauri/src/entities/foundation"),
    "SeaORM entity drift",
  );
  const generatedDirectory = join(studioRoot, "src/graphql-foundation/generated");
  for (const name of ["schema.graphql", "taurpc.ts", "operations.ts"]) {
    await assertSameFile(
      join(first, name),
      join(generatedDirectory, name),
      `${name} drift`,
    );
  }
  for (const feature of ["projects", "work-items", "workflows"]) {
    await assertSameFile(
      join(first, "worktracker", feature, "manifest.ts"),
      join(studioRoot, "src/features", feature, "generated/manifest.ts"),
      `${feature} operation manifest drift`,
    );
  }
  await assertSameFile(
    join(first, "settings/keybindings.ts"),
    join(studioRoot, "src/features/settings/generated/keybindings.ts"),
    "settings keybinding operation drift",
  );
  await assertSameFile(
    join(first, "settings/profileSettings.ts"),
    join(studioRoot, "src/features/settings/generated/profileSettings.ts"),
    "settings profile operation drift",
  );
  await assertSameFile(
    join(first, "settings/providerCatalog.ts"),
    join(studioRoot, "src/features/settings/generated/providerCatalog.ts"),
    "settings provider catalogue operation drift",
  );
  await assertSameFile(
    join(first, "agent-status/attempts.ts"),
    join(studioRoot, "src/features/agents/status/generated/attempts.ts"),
    "agent status automation attempt operation drift",
  );
  await assertSameFile(
    join(first, "agent-status/statusStream.ts"),
    join(studioRoot, "src/features/agents/status/generated/statusStream.ts"),
    "agent status stream subscription operation drift",
  );
  await assertSameFile(
    join(first, "worktrees/worktreeStatus.ts"),
    join(studioRoot, "src/features/agents/worktrees/generated/worktreeStatus.ts"),
    "worktree live status operation drift",
  );
  await assertSameFile(
    join(first, "worktrees/worktreeCreate.ts"),
    join(studioRoot, "src/features/agents/worktrees/generated/worktreeCreate.ts"),
    "worktree creation operation drift",
  );
  await assertSameFile(
    join(first, "worktrees/worktreeDiscard.ts"),
    join(studioRoot, "src/features/agents/worktrees/generated/worktreeDiscard.ts"),
    "worktree discard operation drift",
  );
  await assertSameFile(
    join(first, "documents/documentRegistry.ts"),
    join(studioRoot, "src/features/documents/generated/documentRegistry.ts"),
    "document registry operation drift",
  );
  await assertSameFile(
    join(first, "documents/documentSave.ts"),
    join(studioRoot, "src/features/documents/generated/documentSave.ts"),
    "document save operation drift",
  );
  console.log("GraphQL foundation generation is deterministic and drift-free");
} finally {
  await rm(scratch, { recursive: true, force: true });
}

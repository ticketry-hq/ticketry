import { copyFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  generateFoundationArtifacts,
  studioRoot,
} from "./graphql-foundation-generation.mjs";

const scratch = await mkdtemp(join(tmpdir(), "ticketry-graphql-generate-"));
try {
  await generateFoundationArtifacts(scratch);
  const entityTarget = join(
    studioRoot,
    "src-tauri/src/entities/foundation",
  );
  const frontendTarget = join(studioRoot, "src/graphql-foundation/generated");
  await mkdir(entityTarget, { recursive: true });
  await mkdir(frontendTarget, { recursive: true });
  for (const name of ["migration_probes.rs", "mod.rs", "prelude.rs"]) {
    await copyFile(join(scratch, "entities", name), join(entityTarget, name));
  }
  const executionEntityTarget = join(
    studioRoot,
    "src-tauri/src/entities/execution",
  );
  await mkdir(executionEntityTarget, { recursive: true });
  for (const name of ["graph_run.rs", "launch_claim.rs"]) {
    await copyFile(
      join(scratch, "execution-entities", name),
      join(executionEntityTarget, name),
    );
  }
  const terminalEntityTarget = join(
    studioRoot,
    "src-tauri/src/entities/terminals",
  );
  await mkdir(terminalEntityTarget, { recursive: true });
  await copyFile(
    join(scratch, "terminal-entities/agent_run.rs"),
    join(studioRoot, "src-tauri/src/entities/runs/agent_run.rs"),
  );
  await copyFile(
    join(scratch, "terminal-entities/session.rs"),
    join(terminalEntityTarget, "session.rs"),
  );
  for (const name of ["schema.graphql", "taurpc.ts", "operations.ts"]) {
    await copyFile(join(scratch, name), join(frontendTarget, name));
  }
  for (const feature of ["projects", "work-items", "workflows"]) {
    const target = join(studioRoot, "src/features", feature, "generated");
    await mkdir(target, { recursive: true });
    await copyFile(
      join(scratch, "worktracker", feature, "manifest.ts"),
      join(target, "manifest.ts"),
    );
  }
  const settingsTarget = join(studioRoot, "src/features/settings/generated");
  await mkdir(settingsTarget, { recursive: true });
  for (const name of ["keybindings.ts", "profileSettings.ts", "providerCatalog.ts"]) {
    await copyFile(
      join(scratch, "settings", name),
      join(settingsTarget, name),
    );
  }
  const agentStatusTarget = join(
    studioRoot,
    "src/features/agents/status/generated",
  );
  await mkdir(agentStatusTarget, { recursive: true });
  for (const name of ["attempts.ts", "statusStream.ts"]) {
    await copyFile(join(scratch, "agent-status", name), join(agentStatusTarget, name));
  }
  const worktreeTarget = join(
    studioRoot,
    "src/features/agents/worktrees/generated",
  );
  await mkdir(worktreeTarget, { recursive: true });
  for (const name of ["worktreeStatus.ts", "worktreeCreate.ts"]) {
    await copyFile(join(scratch, "worktrees", name), join(worktreeTarget, name));
  }
  const documentTarget = join(studioRoot, "src/features/documents/generated");
  await mkdir(documentTarget, { recursive: true });
  for (const name of ["documentRegistry.ts", "documentSave.ts"]) {
    await copyFile(join(scratch, "documents", name), join(documentTarget, name));
  }
  const terminalTarget = join(
    studioRoot,
    "src/features/agents/terminal/generated",
  );
  await mkdir(terminalTarget, { recursive: true });
  for (const name of ["terminalSessions.ts", "viewerLeases.ts"]) {
    await copyFile(join(scratch, "terminals", name), join(terminalTarget, name));
  }
  const executionTarget = join(studioRoot, "src/features/execution/generated");
  await mkdir(executionTarget, { recursive: true });
  await copyFile(
    join(scratch, "execution/graphRuns.ts"),
    join(executionTarget, "graphRuns.ts"),
  );
  console.log("generated GraphQL foundation entities, SDL, TauRPC, and operations");
} finally {
  await rm(scratch, { recursive: true, force: true });
}

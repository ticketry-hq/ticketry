import { copyFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  generateFoundationArtifacts,
  studioRoot,
} from "./graphql-foundation-generation.mjs";
import {
  schemaTypesTargetRelative,
  typedDocumentTargets,
} from "./typed-document-generation.mjs";

const scratch = await mkdtemp(join(tmpdir(), "ticketry-graphql-generate-"));
try {
  await generateFoundationArtifacts(scratch);
  const entityTarget = join(
    studioRoot,
    "src-tauri/crates/foundation/ticketry-entities/src/foundation",
  );
  const frontendTarget = join(studioRoot, "src/graphql-foundation/generated");
  await mkdir(entityTarget, { recursive: true });
  await mkdir(frontendTarget, { recursive: true });
  for (const name of ["migration_probes.rs", "mod.rs"]) {
    await copyFile(join(scratch, "entities", name), join(entityTarget, name));
  }
  const executionEntityTarget = join(
    studioRoot,
    "src-tauri/crates/foundation/ticketry-entities/src/execution",
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
    "src-tauri/crates/foundation/ticketry-entities/src/terminals",
  );
  await mkdir(terminalEntityTarget, { recursive: true });
  await copyFile(
    join(scratch, "terminal-entities/agent_run.rs"),
    join(studioRoot, "src-tauri/crates/foundation/ticketry-entities/src/runs/agent_run.rs"),
  );
  await copyFile(
    join(scratch, "terminal-entities/session.rs"),
    join(terminalEntityTarget, "session.rs"),
  );
  for (const name of ["schema.graphql", "taurpc.ts"]) {
    await copyFile(join(scratch, name), join(frontendTarget, name));
  }
  for (const target of await typedDocumentTargets(join(studioRoot, "src"))) {
    const destination = join(studioRoot, "src", target.targetRelative);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(
      join(scratch, "typed-documents", target.targetRelative),
      destination,
    );
  }
  const schemaTypesDestination = join(studioRoot, "src", schemaTypesTargetRelative);
  await mkdir(dirname(schemaTypesDestination), { recursive: true });
  await copyFile(
    join(scratch, "typed-documents", schemaTypesTargetRelative),
    schemaTypesDestination,
  );
  console.log("generated GraphQL foundation entities, SDL, TauRPC, and operations");
} finally {
  await rm(scratch, { recursive: true, force: true });
}

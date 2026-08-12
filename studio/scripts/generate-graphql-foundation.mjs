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
    "src-tauri/src/graphql_foundation/entities",
  );
  const frontendTarget = join(studioRoot, "src/graphql-foundation/generated");
  await mkdir(entityTarget, { recursive: true });
  await mkdir(frontendTarget, { recursive: true });
  for (const name of ["migration_probes.rs", "mod.rs", "prelude.rs"]) {
    await copyFile(join(scratch, "entities", name), join(entityTarget, name));
  }
  for (const name of ["schema.graphql", "taurpc.ts", "operations.ts"]) {
    await copyFile(join(scratch, name), join(frontendTarget, name));
  }
  console.log("generated GraphQL foundation entities, SDL, TauRPC, and operations");
} finally {
  await rm(scratch, { recursive: true, force: true });
}

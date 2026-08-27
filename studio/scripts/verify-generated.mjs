import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  generateFoundationArtifacts,
  studioRoot,
} from "./graphql-foundation-generation.mjs";
import {
  schemaTypesTargetRelative,
  typedDocumentTargets,
} from "./typed-document-generation.mjs";

async function files(directory, prefix = "") {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.name === "generation.sqlite3") continue;
    if (entry.name === "terminal-generation.sqlite3") continue;
    if (entry.name === "raw-terminal-entities") continue;
    if (entry.name === "execution-generation.sqlite3") continue;
    if (entry.name === "raw-execution-entities") continue;
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
  await assertSameFile(
    join(first, "terminal-entities/agent_run.rs"),
    join(studioRoot, "src-tauri/src/entities/runs/agent_run.rs"),
    "Agent Run entity drift",
  );
  for (const name of ["graph_run.rs", "launch_claim.rs"]) {
    await assertSameFile(
      join(first, "execution-entities", name),
      join(studioRoot, "src-tauri/src/entities/execution", name),
      `Execution ${name} entity drift`,
    );
  }
  await assertSameFile(
    join(first, "terminal-entities/session.rs"),
    join(studioRoot, "src-tauri/src/entities/terminals/session.rs"),
    "Terminal Session entity drift",
  );
  const generatedDirectory = join(studioRoot, "src/graphql-foundation/generated");
  for (const name of ["schema.graphql", "taurpc.ts"]) {
    await assertSameFile(
      join(first, name),
      join(generatedDirectory, name),
      `${name} drift`,
    );
  }
  for (const target of await typedDocumentTargets(join(studioRoot, "src"))) {
    await assertSameFile(
      join(first, "typed-documents", target.targetRelative),
      join(studioRoot, "src", target.targetRelative),
      `${target.targetRelative} drift`,
    );
  }
  await assertSameFile(
    join(first, "typed-documents", schemaTypesTargetRelative),
    join(studioRoot, "src", schemaTypesTargetRelative),
    "GraphQL schema TypeScript drift",
  );
  console.log("GraphQL foundation generation is deterministic and drift-free");
} finally {
  await rm(scratch, { recursive: true, force: true });
}

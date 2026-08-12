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
    join(studioRoot, "src-tauri/src/graphql_foundation/entities"),
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
  console.log("GraphQL foundation generation is deterministic and drift-free");
} finally {
  await rm(scratch, { recursive: true, force: true });
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const studioRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const commandEnvironment = {
  ...process.env,
  TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [], resources: [] } }),
};

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: commandEnvironment,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout}${result.stderr}`,
    );
  }
}

async function pinReadOnlyEntityRegistration(entitiesDirectory) {
  const generated = await readFile(join(entitiesDirectory, "mod.rs"), "utf8");
  if (!generated.includes("seaography::register_entity_modules!([migration_probes,]);")) {
    throw new Error("generated foundation entity registration has an unknown shape");
  }
  await writeFile(
    join(entitiesDirectory, "mod.rs"),
    `//! \`SeaORM\` Entity registration adapted from sea-orm-codegen 2.0.

pub mod migration_probes;
pub mod prelude;

pub fn register_entity_modules(mut builder: seaography::Builder) -> seaography::Builder {
    // The probe demonstrates Ticketry's governing exception: generated reads
    // are useful, but writes go through an authored domain command.
    seaography::register_entity!(builder, migration_probes, mutation: false);
    builder
}
`,
    "utf8",
  );
}

export async function generateFoundationArtifacts(outputRoot) {
  const tauriRoot = join(studioRoot, "src-tauri");
  const entitiesDirectory = join(outputRoot, "entities");
  const databasePath = join(outputRoot, "generation.sqlite3");
  await mkdir(outputRoot, { recursive: true });

  run(
    "cargo",
    ["run", "--locked", "--quiet", "--bin", "prepare_foundation_generation_db", "--", databasePath],
    tauriRoot,
  );
  run(
    "sea-orm-cli",
    [
      "generate",
      "entity",
      "--database-url",
      `sqlite://${databasePath}`,
      "--output-dir",
      entitiesDirectory,
      "--entity-format",
      "dense",
      "--seaography",
    ],
    tauriRoot,
  );
  await pinReadOnlyEntityRegistration(entitiesDirectory);

  const schemaPath = join(outputRoot, "schema.graphql");
  const bindingsPath = join(outputRoot, "taurpc.ts");
  const operationsPath = join(outputRoot, "operations.ts");
  run(
    "cargo",
    ["run", "--locked", "--quiet", "--bin", "export_foundation_schema", "--", schemaPath],
    tauriRoot,
  );
  run(
    "cargo",
    ["run", "--locked", "--quiet", "--bin", "export_foundation_bindings", "--", bindingsPath],
    tauriRoot,
  );
  run(
    process.execPath,
    [
      join(studioRoot, "scripts/generate-foundation-operations.mjs"),
      schemaPath,
      join(studioRoot, "src/graphql-foundation/operations.graphql"),
      operationsPath,
    ],
    studioRoot,
  );
}

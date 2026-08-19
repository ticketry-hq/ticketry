import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { generateWorkTrackerOperationManifests } from "./worktracker-operation-generation.mjs";
import { generateSettingsOperations } from "./settings-operation-generation.mjs";
import { generateAgentStatusOperations } from "./agent-status-operation-generation.mjs";
import { generateWorktreeOperations } from "./worktree-operation-generation.mjs";
import { generateDocumentOperations } from "./documents-operation-generation.mjs";

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
  await generateWorkTrackerOperationManifests({
    schemaPath,
    sourceRoot: join(studioRoot, "src"),
    outputRoot,
  });
  await generateSettingsOperations({
    schemaPath,
    sourceRoot: join(studioRoot, "src"),
    outputRoot,
  });
  await generateAgentStatusOperations({
    schemaPath,
    sourceRoot: join(studioRoot, "src"),
    outputRoot,
  });
  await generateWorktreeOperations({
    schemaPath,
    sourceRoot: join(studioRoot, "src"),
    outputRoot,
  });
  await generateDocumentOperations({
    schemaPath,
    sourceRoot: join(studioRoot, "src"),
    outputRoot,
  });
}

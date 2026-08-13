import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FEATURES = [
  ["projects", "projects.graphql", ["workspace", "projects", "modules"]],
  ["work-items", "workItems.graphql", ["work_items", "work_items_by_ids", "work_item"]],
  ["workflows", "workflows.graphql", ["states", "issue_types", "issue_type_transitions", "launch_bindings", "providers", "agent_models", "reasoning_levels"]],
];

export async function generateWorkTrackerOperationManifests({
  schemaPath,
  sourceRoot,
  outputRoot,
}) {
  const schema = await readFile(schemaPath, "utf8");
  for (const [feature, fileName, schemaFields] of FEATURES) {
    for (const field of schemaFields) {
      if (!schema.includes(`\n\t${field}(`) && !schema.includes(`\n\t${field}:`)) {
        throw new Error(`WorkTracker schema is missing ${field}`);
      }
    }
    const operationPath = join(sourceRoot, "features", feature, "operations", fileName);
    const source = (await readFile(operationPath, "utf8")).trim();
    const operationNames = [...source.matchAll(/\b(?:query|mutation)\s+([A-Za-z][A-Za-z0-9_]*)/g)]
      .map((match) => match[1]);
    if (operationNames.length === 0) {
      throw new Error(`${operationPath} contains no named operations`);
    }
    const targetDirectory = join(outputRoot, "worktracker", feature);
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(
      join(targetDirectory, "manifest.ts"),
      `// Generated from operations/${fileName}. Do not edit manually.\n\n` +
        `export const operationNames = ${JSON.stringify(operationNames)} as const;\n` +
        `export const operationSource = ${JSON.stringify(source)};\n`,
      "utf8",
    );
  }
}

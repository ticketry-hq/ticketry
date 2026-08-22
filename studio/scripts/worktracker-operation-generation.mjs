import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FEATURES = [
  ["projects", "projects.graphql", ["worktrackerWorkspace", "worktrackerProject", "worktrackerIssue"]],
  ["work-items", "workItems.graphql", ["worktrackerIssue", "worktrackerState", "run_now"]],
  ["workflows", "workflows.graphql", ["worktrackerState", "worktrackerIssuetype", "worktrackerIssuetypetransition", "worktrackerLaunchbinding", "worktrackerProvider", "worktrackerAgentmodel", "worktrackerReasoninglevel"]],
];

function definitionEnd(source, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let seenBody = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      seenBody = true;
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (seenBody && depth === 0) return index + 1;
    }
  }
  throw new Error("GraphQL definition has no complete selection set");
}

function operationDocuments(source) {
  const definitions = new Map();
  const definitionPattern = /^(query|mutation|subscription|fragment)\s+([A-Za-z][A-Za-z0-9_]*)/gm;
  for (const match of source.matchAll(definitionPattern)) {
    definitions.set(match[2], {
      kind: match[1],
      source: source.slice(match.index, definitionEnd(source, match.index)).trim(),
    });
  }

  const documentFor = (name, included = new Set()) => {
    if (included.has(name)) return [];
    const definition = definitions.get(name);
    if (!definition) throw new Error(`GraphQL definition ${name} is missing`);
    included.add(name);
    const fragments = [...definition.source.matchAll(/\.\.\.([A-Za-z][A-Za-z0-9_]*)/g)]
      .map((match) => match[1])
      .filter((fragment) => fragment !== "on");
    return [definition.source, ...fragments.flatMap((fragment) => documentFor(fragment, included))];
  };

  return Object.fromEntries(
    [...definitions]
      .filter(([, definition]) => definition.kind !== "fragment")
      .map(([name]) => [name, documentFor(name).join("\n\n")]),
  );
}

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
        `export const operationDocuments = ${JSON.stringify(operationDocuments(source))} as const;\n` +
        `export const operationSource = ${JSON.stringify(source)};\n`,
      "utf8",
    );
  }
}

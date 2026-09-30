import { generate } from "@graphql-codegen/cli";
import { readdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";

export const schemaTypesTargetRelative = join(
  "graphql-foundation",
  "generated",
  "schemaTypes.ts",
);

async function operationSources(directory) {
  const sources = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      sources.push(...await operationSources(path));
    } else if (
      extname(entry.name) === ".graphql"
      && (basename(directory) === "operations" || entry.name === "operations.graphql")
    ) {
      sources.push(path);
    }
  }
  return sources;
}

export async function typedDocumentTargets(sourceRoot) {
  const sources = await operationSources(sourceRoot);
  return sources.sort().map((sourcePath) => {
    const sourceRelative = relative(sourceRoot, sourcePath);
    const sourceDirectory = dirname(sourceRelative);
    const featureDirectory = basename(sourceDirectory) === "operations"
      ? dirname(sourceDirectory)
      : sourceDirectory;
    const stem = basename(sourceRelative, ".graphql");
    return {
      sourcePath,
      targetRelative: join(featureDirectory, "generated", `${stem}.documents.ts`),
    };
  });
}

export async function generateTypedDocuments({
  schemaPath,
  sourcePath,
  outputPath,
}) {
  await generate(
    {
      schema: schemaPath,
      documents: sourcePath,
      generates: {
        [outputPath]: {
          plugins: [
            "typescript-operations",
            "typed-document-node",
          ],
          config: {
            addTypenameToSelectionSets: true,
            enumsAsTypes: true,
            useTypeImports: true,
          },
        },
      },
      silent: true,
    },
    true,
  );
}

async function generateSchemaTypes(schemaPath, outputPath) {
  await generate(
    {
      schema: schemaPath,
      generates: {
        [outputPath]: {
          plugins: ["typescript"],
          config: {
            enumsAsTypes: true,
            useTypeImports: true,
          },
        },
      },
      silent: true,
    },
    true,
  );
}

export async function generateStudioTypedDocuments({
  schemaPath,
  sourceRoot,
  outputRoot,
}) {
  await generateSchemaTypes(
    schemaPath,
    join(outputRoot, schemaTypesTargetRelative),
  );
  const targets = await typedDocumentTargets(sourceRoot);
  for (const target of targets) {
    await generateTypedDocuments({
      schemaPath,
      sourcePath: target.sourcePath,
      outputPath: join(outputRoot, target.targetRelative),
    });
  }
  return targets;
}

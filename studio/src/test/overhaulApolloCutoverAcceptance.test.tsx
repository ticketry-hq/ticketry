import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import {
  buildSchema,
  Kind,
  parse,
  TypeInfo,
  visit,
  visitWithTypeInfo,
  type FragmentDefinitionNode,
  type SelectionSetNode,
} from "graphql";
import { describe, expect, it } from "vitest";

const STUDIO = join(process.cwd());
const SOURCE = join(STUDIO, "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

function operationFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return operationFiles(path);
    return extname(entry.name) === ".graphql" ? [path] : [];
  });
}

function selectedFields(
  selectionSet: SelectionSetNode,
  fragments: ReadonlyMap<string, FragmentDefinitionNode>,
  seen = new Set<string>(),
): Set<string> {
  const fields = new Set<string>();
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      fields.add(selection.name.value);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      for (const field of selectedFields(selection.selectionSet, fragments, seen)) {
        fields.add(field);
      }
    } else if (!seen.has(selection.name.value)) {
      const fragment = fragments.get(selection.name.value);
      if (!fragment) continue;
      const nextSeen = new Set(seen).add(selection.name.value);
      for (const field of selectedFields(fragment.selectionSet, fragments, nextSeen)) {
        fields.add(field);
      }
    }
  }
  return fields;
}

describe("Apollo cutover acceptance", () => {
  it("[overhaul-163] leaves Apollo as Studio's only server-state client", () => {
    const files = sourceFiles(SOURCE);
    const tanstackPackage = ["@tanstack", "react-query"].join("/");
    const foundationClient = ["graphql-foundation", "foundationClient"].join("/");
    const retiredMutationMarkers = [
      ["is", "Mutating"].join(""),
      ["locally", "Mutating"].join(""),
    ];
    const tanstackReferences = files.flatMap((path) =>
      readFileSync(path, "utf8").includes(tanstackPackage)
        ? [relative(STUDIO, path)]
        : [],
    );
    const retiredFoundationClient = files.flatMap((path) =>
      readFileSync(path, "utf8").includes(foundationClient)
        ? [relative(STUDIO, path)]
        : [],
    );
    const retiredMutationGuards = files.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return retiredMutationMarkers.some((marker) => source.includes(marker))
        ? [relative(STUDIO, path)]
        : [];
    });
    const revisionNames = [
      ["state", "Revision"].join(""),
      ["state", "_revision"].join(""),
    ].join("|");
    const revisionOperand = `(?:[A-Za-z_$][\\w$]*\\.)?(?:${revisionNames})`;
    const revisionComparison = new RegExp(
      `(?:${revisionOperand})\\s*[<>]=?\\s*(?:${revisionOperand}|-?\\d+)` +
      `|(?:${revisionOperand}|-?\\d+)\\s*[<>]=?\\s*(?:${revisionOperand})`,
    );
    const revisionRuleModules = files.flatMap((path) =>
      revisionComparison.test(readFileSync(path, "utf8"))
        ? [relative(STUDIO, path)]
        : [],
    );
    const packageManifest = readFileSync(join(STUDIO, "package.json"), "utf8");

    expect(tanstackReferences).toEqual([]);
    expect(retiredFoundationClient).toEqual([]);
    expect(retiredMutationGuards).toEqual([]);
    expect(revisionRuleModules).toEqual([
      "src/shared/apollo/issueRevisionGuardLink.ts",
    ]);
    expect(packageManifest).not.toContain(tanstackPackage);
  });

  it("[overhaul-163] makes the central revision rule reachable from every authored Work Item selection", () => {
    const schema = buildSchema(readFileSync(
      join(SOURCE, "graphql-foundation", "generated", "schema.graphql"),
      "utf8",
    ));
    const missingRevision = operationFiles(join(SOURCE, "features")).flatMap((path) => {
      const document = parse(readFileSync(path, "utf8"));
      const fragments = new Map(
        document.definitions
          .filter((definition): definition is FragmentDefinitionNode =>
            definition.kind === Kind.FRAGMENT_DEFINITION)
          .map((fragment) => [fragment.name.value, fragment]),
      );
      const typeInfo = new TypeInfo(schema);
      const missing: string[] = [];
      visit(document, visitWithTypeInfo(typeInfo, {
        SelectionSet(node) {
          if (
            typeInfo.getParentType()?.name === "WorktrackerIssue" &&
            !selectedFields(node, fragments).has("stateRevision")
          ) {
            missing.push(
              `${relative(STUDIO, path)}:${node.loc?.startToken.line ?? "?"}`,
            );
          }
        },
      }));
      return missing;
    });

    expect(missingRevision).toEqual([]);
  });

  it("[overhaul-167] leaves Apollo as Studio's only application-state owner", () => {
    const files = sourceFiles(SOURCE);
    const retiredStateLibrary = ["zu", "stand"].join("");
    const retiredReferences = files.flatMap((path) =>
      readFileSync(path, "utf8").toLowerCase().includes(retiredStateLibrary)
        ? [relative(STUDIO, path)]
        : [],
    );
    const packageManifest = readFileSync(join(STUDIO, "package.json"), "utf8");
    const localState = readFileSync(
      join(SOURCE, "shared", "apollo", "localState.ts"),
      "utf8",
    );

    expect(retiredReferences).toEqual([]);
    expect(packageManifest.toLowerCase()).not.toContain(retiredStateLibrary);
    expect(localState).toContain("studioApolloClient().cache.writeFragment");
  });
});

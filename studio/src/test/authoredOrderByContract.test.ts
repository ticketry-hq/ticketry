import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  buildSchema,
  getNamedType,
  isInputObjectType,
  parse,
  TypeInfo,
  visit,
  visitWithTypeInfo,
} from "graphql";
import { describe, expect, it } from "vitest";

/**
 * An authored `orderBy` sorts in the order its keys are written.
 *
 * Seaography builds ORDER BY by walking the entity's columns, not the keys of
 * the query object, so `{ createdAt: ASC, agentRunId: ASC }` sorts by
 * agentRunId first whenever that column precedes createdAt. A unique column
 * written as a tie-breaker then silently becomes the whole order (CODING-2870).
 * This test requires every multi-key `orderBy` literal to list its keys in the
 * generated OrderInput field order, which is the entity column order.
 */

// Vitest runs from the Studio workspace root.
const STUDIO_ROOT = process.cwd();
const SOURCE_ROOT = join(STUDIO_ROOT, "src");
const SCHEMA = buildSchema(
  readFileSync(join(SOURCE_ROOT, "graphql-foundation/generated/schema.graphql"), "utf8"),
);

function authoredOperationFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "generated" || entry.name === "node_modules"
        ? []
        : authoredOperationFiles(path);
    }
    return entry.name.endsWith(".graphql") ? [path] : [];
  });
}

function misorderedOrderBys(path: string): string[] {
  const found: string[] = [];
  const typeInfo = new TypeInfo(SCHEMA);
  let operation = "";
  visit(parse(readFileSync(path, "utf8")), visitWithTypeInfo(typeInfo, {
    OperationDefinition(node) {
      operation = node.name?.value ?? relative(STUDIO_ROOT, path);
    },
    ObjectValue(node) {
      const type = getNamedType(typeInfo.getInputType());
      if (!isInputObjectType(type) || !type.name.endsWith("OrderInput")) return;
      const columns = Object.keys(type.getFields());
      const written = node.fields.map((field) => field.name.value);
      const applied = [...written].sort((a, b) => columns.indexOf(a) - columns.indexOf(b));
      if (written.join() !== applied.join()) found.push(`${operation}: ${written.join()}`);
    },
  }));
  return found;
}

describe("authored orderBy contract", () => {
  it("writes multi-key orderBy keys in the entity column order Seaography applies", () => {
    const misordered = authoredOperationFiles(SOURCE_ROOT).flatMap(misorderedOrderBys).sort();

    expect(misordered).toEqual([]);
  });
});

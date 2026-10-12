import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { Kind, type FieldNode, type FragmentDefinitionNode, type SelectionSetNode } from "graphql";
import { compactWorktrackerId, publicWorktrackerId, publicWorktrackerTimestamp } from "./generatedWorktracker";

function convertStrings(value: unknown, convert: (value: string) => string): unknown {
  if (typeof value === "string") return convert(value);
  if (Array.isArray(value)) return value.map(item => convertStrings(item, convert));
  return value;
}

// Derived views only: weak keys do not retain Apollo results or own server state.
const publicResults = new WeakMap<object, WeakMap<object, unknown>>();

/** Derive a feature-facing result; Apollo's original server rows stay raw. */
export function publicResult<Result, Variables>(
  document: TypedDocumentNode<Result, Variables>, data: Result,
): Result {
  if (!data || typeof data !== "object") return data;
  let results = publicResults.get(document);
  if (!results) {
    results = new WeakMap();
    publicResults.set(document, results);
  }
  if (results.has(data)) return results.get(data) as Result;
  const operation = document.definitions.find(definition => definition.kind === Kind.OPERATION_DEFINITION);
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
  }
  const root = operation ?? fragments.values().next().value;
  if (!root) return data;
  type Selection = { set: SelectionSetNode; matches: number };
  type SelectedField = { field: FieldNode; conditions: string[]; matches: number };
  function fieldsFor(selections: Selection[]): Map<string, SelectedField[]> {
    const fields = new Map<string, SelectedField[]>();
    function collect(set: SelectionSetNode, conditions: string[], visiting: Set<string>, matches: number) {
      for (const selection of set.selections) {
        if (selection.kind === Kind.FIELD) {
          const key = selection.alias?.value ?? selection.name.value;
          const existing = fields.get(key) ?? [];
          existing.push({ field: selection, conditions, matches });
          fields.set(key, existing);
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          collect(selection.selectionSet, selection.typeCondition
            ? [...conditions, selection.typeCondition.name.value] : conditions, visiting, matches);
        } else {
          const name = selection.name.value;
          const fragment = fragments.get(name);
          if (fragment && !visiting.has(name)) {
            collect(fragment.selectionSet, [...conditions, fragment.typeCondition.name.value],
              new Set([...visiting, name]), matches);
          }
        }
      }
    }
    for (const selection of selections) collect(selection.set, [], new Set(), selection.matches);
    return fields;
  }
  function walk(value: unknown, selections: Selection[]): unknown {
    if (Array.isArray(value)) return value.map(item => walk(item, selections));
    if (!value || typeof value !== "object") return value;
    const output: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    const fields = fieldsFor(selections);
    const typenameKey = [...fields].find(([, entries]) => entries.some(entry => entry.field.name.value === "__typename"))?.[0];
    const typename = output[typenameKey ?? "__typename"];
    for (const [key, candidates] of fields) {
      if (!Object.prototype.hasOwnProperty.call(output, key)) continue;
      // Concrete branches can reuse an alias for different schema fields. Keep
      // non-conflicting abstract fragments: the document carries no schema map.
      const scored = candidates.map(entry => ({ ...entry,
        matches: entry.matches + entry.conditions.filter(condition => condition === typename).length,
      }));
      const bestMatch = Math.max(...scored.map(entry => entry.matches));
      const selected = new Set(candidates.map(entry => entry.field.name.value)).size > 1 && bestMatch > 0
        ? scored.filter(entry => entry.matches === bestMatch) : scored;
      const nested = selected.flatMap(entry => entry.field.selectionSet
        ? [{ set: entry.field.selectionSet, matches: entry.matches }] : []);
      if (nested.length) {
        output[key] = walk(output[key], nested);
        continue;
      }
      for (const { field: selection } of selected) {
        const name = selection.name.value;
        if (name === "id" || name.endsWith("Id")) {
          output[key] = convertStrings(output[key], publicWorktrackerId);
        } else if (name === "createdAt" || name === "updatedAt") {
          output[key] = convertStrings(output[key], publicWorktrackerTimestamp);
        }
      }
    }
    return output;
  }
  const result = walk(data, [{ set: root.selectionSet, matches: 0 }]) as Result;
  results.set(data, result);
  return result;
}

/** Compact only named ID variables of this WorkTracker operation, never cache rows. */
export function serverVariables<Result, Variables>(
  document: TypedDocumentNode<Result, Variables>, variables: Variables,
): Variables {
  const operation = document.definitions.find(definition => definition.kind === Kind.OPERATION_DEFINITION);
  if (!operation || !variables || typeof variables !== "object") return variables;
  const output = { ...(variables as Record<string, unknown>) };
  for (const definition of operation.variableDefinitions ?? []) {
    const name = definition.variable.name.value;
    if ((name === "id" || name.endsWith("Id") || name.endsWith("Ids"))
        && Object.prototype.hasOwnProperty.call(output, name)) {
      output[name] = convertStrings(output[name], compactWorktrackerId);
    }
  }
  return output as Variables;
}

import type { DocumentNode, SelectionSetNode } from "graphql";

/** Validate selected response fields before treating a partial read as authoritative. */
export function completeSuggestionRead(document: DocumentNode, data: unknown): boolean {
  const fragments = new Map(document.definitions.flatMap((definition) => definition.kind === "FragmentDefinition" ? [[definition.name.value, definition.selectionSet] as const] : []));
  const complete = (selection: SelectionSetNode, value: unknown): boolean => {
    if (value === null) return true;
    if (Array.isArray(value)) return value.every((row) => complete(selection, row));
    if (!value || typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    return selection.selections.every((field) => {
      if (field.kind === "FragmentSpread") { const fragment = fragments.get(field.name.value); return Boolean(fragment && complete(fragment, row)); }
      if (field.kind === "InlineFragment") return field.typeCondition && row.__typename && field.typeCondition.name.value !== row.__typename ? true : complete(field.selectionSet, row);
      if (field.name.value === "__typename") return true;
      const key = field.alias?.value ?? field.name.value;
      return key in row && (field.selectionSet ? complete(field.selectionSet, row[key]) : row[key] !== undefined);
    });
  };
  const operation = document.definitions.find((definition) => definition.kind === "OperationDefinition");
  return Boolean(operation && data && complete(operation.selectionSet, data));
}

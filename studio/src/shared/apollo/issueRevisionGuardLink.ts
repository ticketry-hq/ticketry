import { ApolloLink, gql, type InMemoryCache } from "@apollo/client";
import type {
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  OperationDefinitionNode,
  SelectionSetNode,
} from "graphql";
import { map } from "rxjs";

const cachedIssueFragment = gql`
  fragment ApolloCachedIssueForRevisionGuard on WorktrackerIssue {
    id
    projectId
    type
    issueTypeId
    parentId
    moduleId
    stateId
    stateRevision
    name
    sequenceId
    isArchived
    rank
    description
    createdAt
    updatedAt
  }
`;

type JsonObject = Record<string, unknown>;
type FragmentMap = ReadonlyMap<string, FragmentDefinitionNode>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function selectedFields(
  selectionSet: SelectionSetNode,
  fragments: FragmentMap,
  visitedFragments = new Set<string>(),
): FieldNode[] {
  const fields: FieldNode[] = [];
  for (const selection of selectionSet.selections) {
    if (selection.kind === "Field") {
      fields.push(selection);
      continue;
    }
    if (selection.kind === "InlineFragment") {
      fields.push(...selectedFields(selection.selectionSet, fragments, visitedFragments));
      continue;
    }

    const fragmentName = selection.name.value;
    if (visitedFragments.has(fragmentName)) continue;
    const fragment = fragments.get(fragmentName);
    if (!fragment) continue;
    fields.push(...selectedFields(
      fragment.selectionSet,
      fragments,
      new Set([...visitedFragments, fragmentName]),
    ));
  }
  return fields;
}

function resultKey(field: FieldNode): string {
  return field.alias?.value ?? field.name.value;
}

function fieldValue(
  value: JsonObject,
  fields: readonly FieldNode[],
  schemaFieldName: string,
): unknown {
  const field = fields.find((candidate) =>
    candidate.name.value === schemaFieldName &&
    hasOwn(value, resultKey(candidate))
  );
  return field ? value[resultKey(field)] : undefined;
}

function guardedValue(
  value: unknown,
  selectionSet: SelectionSetNode,
  fragments: FragmentMap,
  cache: InMemoryCache,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => guardedValue(item, selectionSet, fragments, cache));
  }
  if (!isObject(value)) return value;

  const fields = selectedFields(selectionSet, fragments);
  const guardedChildren = { ...value };
  for (const field of fields) {
    const key = resultKey(field);
    if (!field.selectionSet || !hasOwn(value, key)) continue;
    guardedChildren[key] = guardedValue(value[key], field.selectionSet, fragments, cache);
  }

  const id = fieldValue(value, fields, "id");
  const stateRevision = fieldValue(value, fields, "stateRevision");

  if (
    value.__typename === "WorktrackerIssue" &&
    typeof id === "string" &&
    typeof stateRevision === "number"
  ) {
    const cacheId = cache.identify({
      __typename: value.__typename,
      id,
    });
    const cached = cacheId
      ? cache.readFragment<JsonObject & { stateRevision?: number }>({
        id: cacheId,
        fragment: cachedIssueFragment,
        returnPartialData: true,
      })
      : null;
    if (
      cached &&
      typeof cached.stateRevision === "number" &&
      stateRevision < cached.stateRevision
    ) {
      const restored = { ...guardedChildren };
      for (const field of fields) {
        const key = resultKey(field);
        const storeFieldName = field.name.value;
        if (
          hasOwn(value, key) &&
          hasOwn(cached, storeFieldName)
        ) {
          restored[key] = cached[storeFieldName];
        }
      }
      return restored;
    }
  }

  return guardedChildren;
}

function operationSelections(query: DocumentNode, operationName?: string): {
  fragments: FragmentMap;
  selectionSet: SelectionSetNode;
} | null {
  const fragments = new Map<string, FragmentDefinitionNode>();
  let operation: OperationDefinitionNode | undefined;
  for (const definition of query.definitions) {
    if (definition.kind === "FragmentDefinition") {
      fragments.set(definition.name.value, definition);
    } else if (
      definition.kind === "OperationDefinition" &&
      (!operationName || definition.name?.value === operationName)
    ) {
      operation = definition;
    }
  }
  return operation ? { fragments, selectionSet: operation.selectionSet } : null;
}

/** Remove stale Work Item snapshots before Apollo writes a network result. */
export function createIssueRevisionGuardLink(cache: InMemoryCache): ApolloLink {
  return new ApolloLink((operation, forward) => {
    const selections = operationSelections(operation.query, operation.operationName);
    return forward(operation).pipe(
      map((result) => result.data === undefined || !selections
        ? result
        : {
          ...result,
          data: guardedValue(
            result.data,
            selections.selectionSet,
            selections.fragments,
            cache,
          ) as typeof result.data,
        }),
    );
  });
}

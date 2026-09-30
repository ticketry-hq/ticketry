import { ApolloLink, type InMemoryCache } from "@apollo/client";
import { type DocumentNode, type FieldNode, type FragmentDefinitionNode, Kind } from "graphql";
import { map } from "rxjs";
import { moduleLoadPoint } from "../utilities/moduleLoadProbe";

type CacheFragment = Parameters<InMemoryCache["readFragment"]>[0]["fragment"];

const ISSUE_TYPENAME = "WorktrackerIssue";
const REVISION_FIELD = "stateRevision";

type JsonObject = Record<string, unknown>;

/** A WorktrackerIssue fragment in the operation that selects the revision. */
interface RevisionFragment {
  document: CacheFragment;
  fragmentName: string;
  /** The response key the fragment gives `stateRevision` (its alias, if any). */
  revisionKey: string;
}

const fragmentsByDocument = new WeakMap<DocumentNode, RevisionFragment[]>();

function revisionFragments(query: DocumentNode): RevisionFragment[] {
  let found = fragmentsByDocument.get(query);
  if (found) return found;
  const definitions = query.definitions.filter(
    (definition): definition is FragmentDefinitionNode => definition.kind === Kind.FRAGMENT_DEFINITION,
  );
  // Apollo types its documents against the hoisted graphql; the shape is identical.
  const document = { kind: Kind.DOCUMENT, definitions } as DocumentNode as CacheFragment;
  found = definitions.flatMap((definition) => {
    if (definition.typeCondition.name.value !== ISSUE_TYPENAME) return [];
    const revision = definition.selectionSet.selections.find(
      (selection): selection is FieldNode =>
        selection.kind === Kind.FIELD && selection.name.value === REVISION_FIELD,
    );
    if (!revision) return [];
    return [{
      document,
      fragmentName: definition.name.value,
      revisionKey: revision.alias?.value ?? revision.name.value,
    }];
  });
  fragmentsByDocument.set(query, found);
  return found;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The cached row, in this operation's own response shape, when it is newer
 * than the arriving one. Reads the base layer only: an optimistic row is
 * never the comparison authority.
 */
function newerCachedRow(
  row: JsonObject,
  cache: InMemoryCache,
  fragments: RevisionFragment[],
): JsonObject | null {
  const cacheId = cache.identify({ __typename: ISSUE_TYPENAME, id: row.id as string });
  if (!cacheId) return null;
  for (const fragment of fragments) {
    const arriving = row[fragment.revisionKey];
    if (typeof arriving !== "number") continue;
    const cached = cache.readFragment<JsonObject>({
      id: cacheId,
      fragment: fragment.document,
      fragmentName: fragment.fragmentName,
      returnPartialData: true,
    });
    const known = cached?.[fragment.revisionKey];
    if (cached && typeof known === "number" && arriving < known) {
      return Object.fromEntries(
        Object.entries(cached).filter(([, value]) => value !== undefined),
      );
    }
  }
  return null;
}

function guardedValue(
  value: unknown,
  cache: InMemoryCache,
  fragments: RevisionFragment[],
): unknown {
  if (Array.isArray(value)) return value.map((item) => guardedValue(item, cache, fragments));
  if (!isObject(value)) return value;

  const guardedChildren = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, guardedValue(child, cache, fragments)]),
  );
  if (value.__typename !== ISSUE_TYPENAME || typeof value.id !== "string") return guardedChildren;
  const newer = newerCachedRow(value, cache, fragments);
  return newer ? { ...guardedChildren, ...newer } : guardedChildren;
}

/**
 * Keep the newer Work Item when a lower `stateRevision` arrives after it: a
 * slow refetch landing behind a mutation response must not repaint the older
 * row. Applies to rows selected through a WorktrackerIssue fragment that
 * includes `stateRevision`; the cached row is read through that same fragment
 * so aliases match the response.
 */
export function createIssueRevisionGuardLink(cache: InMemoryCache): ApolloLink {
  return new ApolloLink((operation, forward) => forward(operation).pipe(
    map((result) => {
      if (result.data === undefined) return result;
      const fragments = revisionFragments(operation.query);
      if (fragments.length === 0) return result;
      const started = performance.now();
      const data = guardedValue(result.data, cache, fragments) as typeof result.data;
      if (import.meta.env.DEV && operation.operationName === "WorkTrackerModuleOpen") {
        moduleLoadPoint(operation.variables.moduleId as string)("revision-guard-completed", {
          guard_ms: performance.now() - started,
        });
      }
      return { ...result, data };
    }),
  ));
}

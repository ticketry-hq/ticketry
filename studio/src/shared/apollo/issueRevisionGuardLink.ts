import { ApolloLink, gql, type InMemoryCache } from "@apollo/client";
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

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function guardedValue(value: unknown, cache: InMemoryCache): unknown {
  if (Array.isArray(value)) return value.map((item) => guardedValue(item, cache));
  if (!isObject(value)) return value;

  const guardedChildren = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, guardedValue(child, cache)]),
  );

  if (
    value.__typename === "WorktrackerIssue" &&
    typeof value.id === "string" &&
    typeof value.stateRevision === "number"
  ) {
    const cacheId = cache.identify({
      __typename: value.__typename,
      id: value.id,
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
      value.stateRevision < cached.stateRevision
    ) {
      return { ...guardedChildren, ...cached };
    }
  }

  return guardedChildren;
}

/** Remove stale Work Item snapshots before Apollo writes a network result. */
export function createIssueRevisionGuardLink(cache: InMemoryCache): ApolloLink {
  return new ApolloLink((_operation, forward) => forward(_operation).pipe(
    map((result) => result.data === undefined
      ? result
      : { ...result, data: guardedValue(result.data, cache) as typeof result.data }),
  ));
}

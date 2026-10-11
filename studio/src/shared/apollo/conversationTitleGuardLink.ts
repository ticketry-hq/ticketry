import { ApolloLink, gql, type InMemoryCache } from "@apollo/client";
import { map } from "rxjs";

type JsonObject = Record<string, unknown>;
const TICKET_TYPENAME = "InstantRunTicket";
const titleFragment = gql`
  fragment RequestGuardConversationTitle on InstantRunTicket {
    title
    user_title
    committedTitleGeneration @client
  }
`;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only request metadata is retained; Apollo continues to own every title. */
function generationsAtRequestStart(cache: InMemoryCache): Map<string, number> {
  return new Map(Object.entries(cache.extract(false)).flatMap(([id, row]) =>
    isObject(row) && row.__typename === TICKET_TYPENAME
      ? [[id, typeof row.committedTitleGeneration === "number" ? row.committedTitleGeneration : 0] as const]
      : [],
  ));
}

function guardedValue(
  value: unknown,
  cache: InMemoryCache,
  initialGenerations: ReadonlyMap<string, number>,
): unknown {
  if (Array.isArray(value)) return value.map((row) => guardedValue(row, cache, initialGenerations));
  if (!isObject(value)) return value;
  const children = Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, guardedValue(child, cache, initialGenerations)],
  ));
  if (value.__typename !== TICKET_TYPENAME || typeof value.agent_run_id !== "string") return children;
  const id = cache.identify({ __typename: TICKET_TYPENAME, agent_run_id: value.agent_run_id });
  if (!id) return children;
  const cached = cache.readFragment<{
    title?: string;
    user_title?: string | null;
    committedTitleGeneration?: number;
  }>({
    id,
    fragment: titleFragment,
    optimistic: false,
    returnPartialData: true,
  });
  if (!cached || (cached.committedTitleGeneration ?? 0) === (initialGenerations.get(id) ?? 0)) return children;
  // Only a successful save advances the base-layer generation, including a
  // rename back to the same title that was present when the request began.
  // Preserve only a title committed during this request, leaving all other
  // arriving fields (including list membership) under server authority.
  if (typeof cached.title !== "string") return children;
  return { ...children, title: cached.title, user_title: cached.user_title ?? null };
}

/** Prevent a pre-save conversation refetch from undoing a successful rename. */
export function createConversationTitleGuardLink(cache: InMemoryCache): ApolloLink {
  return new ApolloLink((operation, forward) => {
    if (operation.operationName !== "InstantRunTickets") return forward(operation);
    const initialGenerations = generationsAtRequestStart(cache);
    return forward(operation).pipe(map((result) => {
      if (result.data === undefined) return result;
      return {
        ...result,
        data: guardedValue(result.data, cache, initialGenerations) as typeof result.data,
      };
    }));
  });
}

import { ApolloLink, type InMemoryCache } from "@apollo/client";
import { OperationTypeNode } from "graphql";
import { mergeMap, of } from "rxjs";

import { stableVariablesKey } from "./stableVariablesKey";

/** Operation context flag set by a read that supersedes every earlier read of its key. */
export const SUPERSEDES_EARLIER_READS = "supersedesEarlierReads";

/**
 * Keep a committed write's cache effects when an earlier read of the same
 * operation and variables lands after it.
 *
 * A declared mutation's refresh marks its reads with
 * `SUPERSEDES_EARLIER_READS`. A marked read starts only after its write
 * committed, so starting it is the boundary: any read of the same key that
 * started earlier, marked or not, may hold pre-write data. That holds whether
 * or not the marked read later succeeds. A stale read is answered from the
 * cache, which already holds the committed write, instead of writing older
 * list membership back; when the cache cannot answer it, the read is sent
 * again rather than falling back to the stale payload. So neither a pre-write
 * read nor an earlier write's refresh that lands later can undo a write. Reads
 * that start after the latest marked read keep Apollo's ordinary behavior.
 */
export function createSupersededReadLink(cache: InMemoryCache): ApolloLink {
  let sequence = 0;
  const supersededBefore = new Map<string, number>();
  return new ApolloLink((operation, forward) => {
    if (operation.operationType !== OperationTypeNode.QUERY) return forward(operation);
    const key = `${operation.operationName}:${stableVariablesKey(operation.variables)}`;
    const supersedes = operation.getContext()[SUPERSEDES_EARLIER_READS] === true;
    // A re-sent stale read starts after the boundary and never moves it.
    const read = (marksBoundary: boolean): ReturnType<typeof forward> => {
      const started = ++sequence;
      if (marksBoundary) supersededBefore.set(key, started);
      return forward(operation).pipe(mergeMap((result) => {
        if (result.data === undefined || result.data === null) return of(result);
        if (started >= (supersededBefore.get(key) ?? 0)) return of(result);
        const current = cache.readQuery({ query: operation.query, variables: operation.variables });
        return current ? of({ ...result, data: current }) : read(false);
      }));
    };
    return read(supersedes);
  });
}

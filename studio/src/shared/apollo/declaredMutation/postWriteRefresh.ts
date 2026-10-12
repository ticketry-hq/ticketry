import type { ApolloClient, DocumentNode } from "@apollo/client";

import { stableVariablesKey } from "../stableVariablesKey";
import { SUPERSEDES_EARLIER_READS } from "../supersededReadLink";
import type { RefreshRead } from "./declaration";

/** Keep the first read of each query document and exact variables. */
export function uniqueRefreshReads(reads: readonly RefreshRead[]): RefreshRead[] {
  const seen = new Map<DocumentNode, Set<string>>();
  return reads.filter((read) => {
    const variables = seen.get(read.query) ?? new Set<string>();
    seen.set(read.query, variables);
    const key = stableVariablesKey(read.variables);
    if (variables.has(key)) return false;
    variables.add(key);
    return true;
  });
}

/**
 * Re-read every declared query from the network after a committed write.
 *
 * Request deduplication is off so a post-write read never joins a read that
 * started before the write and would deliver pre-write data, and each read
 * supersedes earlier reads of its key from the moment it starts, so a
 * pre-write read, or an earlier write's refresh, that lands later is answered
 * from the committed cache instead of repainting it, even when this read
 * fails. Each read runs
 * whether or not a component is watching it. Every read is allowed to settle
 * so one failure does not leave other lists stale; the first failure rejects.
 */
export async function refreshDeclaredReads(
  client: ApolloClient,
  reads: readonly RefreshRead[],
): Promise<void> {
  const settled = await Promise.allSettled(uniqueRefreshReads(reads).map((read) =>
    client.query({
      query: read.query,
      variables: read.variables,
      fetchPolicy: "network-only",
      context: { queryDeduplication: false, [SUPERSEDES_EARLIER_READS]: true },
    })));
  const failure = settled.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );
  if (failure) throw failure.reason;
}

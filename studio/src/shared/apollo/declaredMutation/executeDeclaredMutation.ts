import type { OperationVariables } from "@apollo/client";

import { FoundationGraphQlError } from "../errorLink";
import { studioApolloClient } from "../client";
import type { MutationDeclaration, MutationPhase } from "./declaration";
import { mutationFailure } from "./mutationFailure";
import { refreshDeclaredReads } from "./postWriteRefresh";

/**
 * Run a declared mutation through the one Studio Apollo client.
 *
 * 1. Write: send the mutation with its optimistic layer. On failure Apollo
 *    discards the layer and nothing else runs.
 * 2. Commit: Apollo normalizes the authoritative entity; membership and
 *    evictions apply with it, garbage is collected, and the post-commit hook
 *    runs, all exactly once.
 * 3. Refresh: re-read every declared query. A failure here keeps the committed
 *    entity, rejects tagged with the refresh phase, and never re-sends the write.
 */
export async function executeDeclaredMutation<
  TArgs,
  TData,
  TVariables extends OperationVariables,
  TRoot extends keyof TData & string,
  TResult = TData[TRoot],
>(
  declaration: MutationDeclaration<TArgs, TData, TVariables, TRoot, TResult>,
  args: TArgs,
): Promise<TResult> {
  const { diagnostics, root } = declaration;
  const fail = (phase: MutationPhase, error: unknown) => {
    const failure = mutationFailure(phase, error);
    diagnostics?.failed?.(phase, failure, args);
    return failure;
  };
  diagnostics?.requested?.(args);

  const client = studioApolloClient();
  let entity: TData[TRoot];
  let evicted = false;
  try {
    const optimistic = declaration.optimistic?.(args);
    const { data } = await client.mutate({
      mutation: declaration.document,
      variables: declaration.variables(args),
      optimisticResponse: optimistic === undefined
        ? undefined
        : { [root]: optimistic } as TData,
      update(cache, result) {
        const written = (result.data as TData | null | undefined)?.[root];
        if (written === undefined) return;
        declaration.membership?.(cache, written, args);
        for (const identity of declaration.evict?.(args, written) ?? []) {
          evicted = cache.evict({ id: cache.identify({ ...identity }) }) || evicted;
        }
      },
    });
    const written = (data as TData | undefined)?.[root];
    if (written === undefined) {
      throw new FoundationGraphQlError("unknown", `The mutation response has no ${root}.`);
    }
    entity = written;
  } catch (error) {
    throw fail("write", error);
  }
  diagnostics?.written?.(entity, args);

  if (evicted) client.cache.gc();
  declaration.committed?.(entity, args);

  const reads = declaration.refresh?.(args, entity) ?? [];
  if (reads.length > 0) {
    try {
      await refreshDeclaredReads(client, reads);
    } catch (error) {
      throw fail("refresh", error);
    }
    diagnostics?.refreshed?.(entity, args);
  }
  return declaration.result
    ? declaration.result(entity, args)
    : entity as unknown as TResult;
}

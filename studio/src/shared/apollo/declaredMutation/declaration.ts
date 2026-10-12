import type {
  ApolloCache,
  OperationVariables,
  TypedDocumentNode,
} from "@apollo/client";

/** The two caller-visible phases of a declared mutation. */
export type MutationPhase = "write" | "refresh";

/** One post-write re-read: a generated query document and its exact variables. */
export interface RefreshRead {
  // The refresh list mixes documents with different result types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly query: TypedDocumentNode<any, any>;
  readonly variables: OperationVariables;
}

/** A normalized cache identity, resolved with `cache.identify`. */
export interface CacheIdentity {
  readonly __typename: string;
  readonly id: string;
}

/** Feature-owned diagnostics, called at each phase boundary. */
export interface MutationDiagnostics<TArgs, TEntity> {
  readonly requested?: (args: TArgs) => void;
  readonly written?: (entity: TEntity, args: TArgs) => void;
  readonly refreshed?: (entity: TEntity, args: TArgs) => void;
  readonly failed?: (phase: MutationPhase, error: unknown, args: TArgs) => void;
}

/**
 * A mutation expressed as its generated document plus its cache effects.
 *
 * `root` names the authoritative returned entity. Every other member is typed
 * from the generated document, so a wrong root field or variable fails
 * type-checking. The declaration is data owned by the feature; the shared
 * executor knows nothing about the domain it describes.
 */
export interface MutationDeclaration<
  TArgs,
  TData,
  TVariables extends OperationVariables,
  TRoot extends keyof TData & string,
  TResult = TData[TRoot],
> {
  readonly document: TypedDocumentNode<TData, TVariables>;
  readonly variables: (args: TArgs) => NoInfer<TVariables>;
  readonly root: TRoot;
  /** Optional domain mapping of the authoritative entity returned to callers. */
  readonly result?: (entity: TData[TRoot], args: TArgs) => TResult;
  /** The optimistic entity, or `undefined` to send without an optimistic layer. */
  readonly optimistic?: (args: TArgs) => NoInfer<TData[TRoot]> | undefined;
  /** List membership or order changes, applied with the optimistic and authoritative result. */
  readonly membership?: (cache: ApolloCache, entity: TData[TRoot], args: TArgs) => void;
  /** Identities removed from the cache; garbage is collected once the write commits. */
  readonly evict?: (args: TArgs, entity: TData[TRoot]) => readonly CacheIdentity[];
  /** Reads the committed write made stale, from the arguments and the authoritative entity. */
  readonly refresh?: (args: TArgs, entity: TData[TRoot]) => readonly RefreshRead[];
  /** Runs exactly once per committed write, before the refresh phase. */
  readonly committed?: (entity: TData[TRoot], args: TArgs) => void;
  readonly diagnostics?: MutationDiagnostics<TArgs, TData[TRoot]>;
}

/** Infer a declaration's types from its generated document. */
export function declareMutation<
  TArgs,
  TData,
  TVariables extends OperationVariables,
  TRoot extends keyof TData & string,
  TResult = TData[TRoot],
>(
  declaration: MutationDeclaration<TArgs, TData, TVariables, TRoot, TResult>,
): MutationDeclaration<TArgs, TData, TVariables, TRoot, TResult> {
  return declaration;
}

/** A typed refresh entry: the variables must match the query document. */
export function refreshRead<TData, TVariables extends OperationVariables>(
  query: TypedDocumentNode<TData, TVariables>,
  variables: NoInfer<TVariables>,
): RefreshRead {
  return { query, variables };
}

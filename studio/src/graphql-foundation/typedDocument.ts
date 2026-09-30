import type { TypedDocumentNode as StandardTypedDocumentNode } from "@graphql-typed-document-node/core";
import { getOperationAST, print } from "graphql";

interface LegacyTypedDocumentNode<TResult, TVariables> {
  readonly kind: "Document";
  readonly operationName: string;
  readonly source: string;
  readonly __resultType?: TResult;
  readonly __variablesType?: TVariables;
}

export type TypedDocumentNode<TResult, TVariables> =
  | StandardTypedDocumentNode<TResult, TVariables>
  | LegacyTypedDocumentNode<TResult, TVariables>;

export function documentOperationName<TResult, TVariables>(
  document:
    | TypedDocumentNode<TResult, TVariables>
    | { readonly operationName: string },
): string {
  if ("operationName" in document) return document.operationName;
  const name = getOperationAST(
    document as StandardTypedDocumentNode<TResult, TVariables>,
  )?.name?.value;
  if (!name) throw new Error("The GraphQL document must contain one named operation.");
  return name;
}

export function documentSource<TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
): string {
  if ("source" in document) return document.source;
  return print(document as StandardTypedDocumentNode<TResult, TVariables>);
}

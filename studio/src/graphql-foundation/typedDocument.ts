export interface TypedDocumentNode<TResult, TVariables> {
  readonly kind: "Document";
  readonly operationName: string;
  readonly source: string;
  readonly __resultType?: TResult;
  readonly __variablesType?: TVariables;
}

import type { GraphQlTransportProxy } from "../graphql-foundation/generated/taurpc";
import {
  documentOperationName,
  documentSource,
  type TypedDocumentNode,
} from "../graphql-foundation/typedDocument";
import {
  foundationDomainErrorCode,
  FoundationGraphQlError,
} from "../shared/apollo/errorLink";

interface GraphQlErrorPayload {
  readonly message?: unknown;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

interface GraphQlResponse<TResult> {
  readonly data?: TResult | null;
  readonly errors?: ReadonlyArray<GraphQlErrorPayload>;
}

export type CreateGraphQlTransportProxy = () => GraphQlTransportProxy;

export async function executeGraphQlTransport<TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
  createProxy: CreateGraphQlTransportProxy,
): Promise<TResult> {
  const operationName = documentOperationName(document);
  if (!operationName) {
    throw new FoundationGraphQlError(
      "validation",
      "The GraphQL document must contain one named operation.",
    );
  }
  const encoded = await createProxy().graphql_execute(JSON.stringify({
    query: documentSource(document),
    operationName,
    variables,
  }));
  const response = JSON.parse(encoded) as GraphQlResponse<TResult>;
  const firstError = response.errors?.[0];
  if (firstError) {
    throw new FoundationGraphQlError(
      foundationDomainErrorCode(firstError.extensions?.code),
      typeof firstError.message === "string"
        ? firstError.message
        : "The GraphQL foundation request failed.",
      firstError.extensions,
    );
  }
  if (response.data == null) {
    throw new FoundationGraphQlError(
      "unknown",
      "The GraphQL foundation response has no data.",
    );
  }
  return response.data;
}

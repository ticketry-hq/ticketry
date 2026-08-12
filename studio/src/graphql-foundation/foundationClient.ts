import type { GraphQlTransportProxy } from "./generated/taurpc";
import type { TypedDocumentNode } from "./typedDocument";

export type FoundationDomainErrorCode =
  | "migration_probe_rejected"
  | "foundation_storage_failed"
  | "service_unavailable"
  | "unknown";

interface GraphQlErrorPayload {
  readonly message?: unknown;
  readonly extensions?: { readonly code?: unknown };
}

interface GraphQlResponse<TResult> {
  readonly data?: TResult | null;
  readonly errors?: ReadonlyArray<GraphQlErrorPayload>;
}

const knownCode = (value: unknown): FoundationDomainErrorCode => {
  switch (value) {
    case "migration_probe_rejected":
    case "foundation_storage_failed":
    case "service_unavailable":
      return value;
    default:
      return "unknown";
  }
};

export class FoundationGraphQlError extends Error {
  readonly code: FoundationDomainErrorCode;

  constructor(code: FoundationDomainErrorCode, message: string) {
    super(message);
    this.name = "FoundationGraphQlError";
    this.code = code;
  }
}

export type CreateGraphQlTransportProxy = () => GraphQlTransportProxy;

export async function executeFoundationOperation<TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
  createProxy: CreateGraphQlTransportProxy,
): Promise<TResult> {
  const encoded = await createProxy().graphql_execute(JSON.stringify({
    query: document.source,
    operationName: document.operationName,
    variables,
  }));
  const response = JSON.parse(encoded) as GraphQlResponse<TResult>;
  const firstError = response.errors?.[0];
  if (firstError) {
    throw new FoundationGraphQlError(
      knownCode(firstError.extensions?.code),
      typeof firstError.message === "string"
        ? firstError.message
        : "The GraphQL foundation request failed.",
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

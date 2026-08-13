import type { GraphQlTransportProxy } from "./generated/taurpc";
import type { TypedDocumentNode } from "./typedDocument";

export type FoundationDomainErrorCode =
  | "migration_probe_rejected"
  | "foundation_storage_failed"
  | "service_unavailable"
  | "worktracker_read_unavailable"
  | "worktracker_read_failed"
  | "worktracker_write_unavailable"
  | "settings_store_unavailable"
  | "settings_storage_failed"
  | "settings_encoding_failed"
  | "not_found"
  | "validation"
  | "field_validation"
  | "conflict"
  | "illegal_transition"
  | "human_only_transition"
  | "stale_revision"
  | "unauthorized"
  | "storage_unavailable"
  | "index_out_of_range"
  | "invalid_profile"
  | "configuration_corrupt"
  | "settings_file_failed"
  | "settings_write_unavailable"
  | "provider_catalog_unavailable"
  | "provider_catalog_drift"
  | "provider_catalog_validation"
  | "provider_catalog_storage_failed"
  | "unknown_agent"
  | "provider_not_activated"
  | "unsupported_model"
  | "model_required"
  | "unsupported_reasoning"
  | "invalid_required_skills"
  | "prompt_required_for_skills"
  | "binding_not_configured"
  | "agent_not_configured"
  | "unattended_launch_unsupported"
  | "unknown";

interface GraphQlErrorPayload {
  readonly message?: unknown;
  readonly extensions?: Readonly<Record<string, unknown>>;
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
    case "worktracker_read_unavailable":
    case "worktracker_read_failed":
    case "worktracker_write_unavailable":
    case "settings_store_unavailable":
    case "settings_storage_failed":
    case "settings_encoding_failed":
    case "not_found":
    case "validation":
    case "field_validation":
    case "conflict":
    case "illegal_transition":
    case "human_only_transition":
    case "stale_revision":
    case "unauthorized":
    case "storage_unavailable":
    case "index_out_of_range":
    case "invalid_profile":
    case "configuration_corrupt":
    case "settings_file_failed":
    case "settings_write_unavailable":
    case "provider_catalog_unavailable":
    case "provider_catalog_drift":
    case "provider_catalog_validation":
    case "provider_catalog_storage_failed":
    case "unknown_agent":
    case "provider_not_activated":
    case "unsupported_model":
    case "model_required":
    case "unsupported_reasoning":
    case "invalid_required_skills":
    case "prompt_required_for_skills":
    case "binding_not_configured":
    case "agent_not_configured":
    case "unattended_launch_unsupported":
      return value;
    default:
      return "unknown";
  }
};

export class FoundationGraphQlError extends Error {
  readonly code: FoundationDomainErrorCode;
  readonly extensions: Readonly<Record<string, unknown>>;

  constructor(
    code: FoundationDomainErrorCode,
    message: string,
    extensions: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "FoundationGraphQlError";
    this.code = code;
    this.extensions = extensions;
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

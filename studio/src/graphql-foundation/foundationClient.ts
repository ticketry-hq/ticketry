import type { GraphQlTransportProxy } from "./generated/taurpc";
import type { TypedDocumentNode } from "./typedDocument";

export type FoundationDomainErrorCode =
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
  | "automation_attempt_not_found"
  | "automation_attempt_not_failed"
  | "automation_attempt_not_retryable"
  | "terminal_launch_invalid"
  | "module_folder_unusable"
  | "terminal_launch_conflict"
  | "terminal_launch_busy"
  | "terminal_runtime_unavailable"
  | "terminal_runtime_identity_conflict"
  | "terminal_runtime_exited"
  | "terminal_cleanup_invalid"
  | "terminal_session_not_found"
  | "terminal_cleanup_conflict"
  | "terminal_cleanup_busy"
  | "terminal_cleanup_pending"
  | "terminal_launch_storage_failed"
  | "terminal_cleanup_storage_failed"
  | "resume_unknown"
  | "resume_active"
  | "resume_sessionless"
  | "resume_agentless"
  | "resume_unsupported"
  | "resume_wrong_scope"
  | "resume_already_resumed"
  | "invalid_identity"
  | "invalid_transport"
  | "viewer_mechanics_not_prepared"
  | "viewer_mechanics_failed"
  | "agent_run_not_found"
  | "viewer_lease_not_owned"
  | "viewer_lease_storage_failed"
  | "subtree_run_not_enabled"
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
    case "automation_attempt_not_found":
    case "automation_attempt_not_failed":
    case "automation_attempt_not_retryable":
    case "terminal_launch_invalid":
    case "module_folder_unusable":
    case "terminal_launch_conflict":
    case "terminal_launch_busy":
    case "terminal_runtime_unavailable":
    case "terminal_runtime_identity_conflict":
    case "terminal_runtime_exited":
    case "terminal_cleanup_invalid":
    case "terminal_session_not_found":
    case "terminal_cleanup_conflict":
    case "terminal_cleanup_busy":
    case "terminal_cleanup_pending":
    case "terminal_launch_storage_failed":
    case "terminal_cleanup_storage_failed":
    case "resume_unknown":
    case "resume_active":
    case "resume_sessionless":
    case "resume_agentless":
    case "resume_unsupported":
    case "resume_wrong_scope":
    case "resume_already_resumed":
    case "invalid_identity":
    case "invalid_transport":
    case "viewer_mechanics_not_prepared":
    case "viewer_mechanics_failed":
    case "agent_run_not_found":
    case "viewer_lease_not_owned":
    case "viewer_lease_storage_failed":
    case "subtree_run_not_enabled":
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

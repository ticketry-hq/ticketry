import { ApolloLink } from "@apollo/client";
import { map } from "rxjs";

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
  | "terminal_runtime_start_failed"
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

const knownDomainErrorCodes = new Set<FoundationDomainErrorCode>([
  "service_unavailable", "worktracker_read_unavailable", "worktracker_read_failed",
  "worktracker_write_unavailable", "settings_store_unavailable", "settings_storage_failed",
  "settings_encoding_failed", "not_found", "validation", "field_validation", "conflict",
  "illegal_transition", "human_only_transition", "stale_revision", "unauthorized",
  "storage_unavailable", "index_out_of_range", "invalid_profile", "configuration_corrupt",
  "settings_file_failed", "settings_write_unavailable", "provider_catalog_unavailable",
  "provider_catalog_drift", "provider_catalog_validation", "provider_catalog_storage_failed",
  "unknown_agent", "provider_not_activated", "unsupported_model", "model_required",
  "unsupported_reasoning", "invalid_required_skills", "prompt_required_for_skills",
  "binding_not_configured", "agent_not_configured", "unattended_launch_unsupported",
  "automation_attempt_not_found", "automation_attempt_not_failed",
  "automation_attempt_not_retryable", "terminal_launch_invalid", "module_folder_unusable",
  "terminal_launch_conflict", "terminal_launch_busy", "terminal_runtime_unavailable",
  "terminal_runtime_start_failed",
  "terminal_runtime_identity_conflict", "terminal_runtime_exited", "terminal_cleanup_invalid",
  "terminal_session_not_found", "terminal_cleanup_conflict", "terminal_cleanup_busy",
  "terminal_cleanup_pending", "terminal_launch_storage_failed", "terminal_cleanup_storage_failed",
  "resume_unknown", "resume_active", "resume_sessionless", "resume_agentless",
  "resume_unsupported", "resume_wrong_scope", "resume_already_resumed", "invalid_identity",
  "invalid_transport", "viewer_mechanics_not_prepared", "viewer_mechanics_failed",
  "agent_run_not_found", "viewer_lease_not_owned", "viewer_lease_storage_failed",
  "subtree_run_not_enabled", "unknown",
]);

export function foundationDomainErrorCode(value: unknown): FoundationDomainErrorCode {
  return typeof value === "string"
    && knownDomainErrorCodes.has(value as FoundationDomainErrorCode)
    ? value as FoundationDomainErrorCode
    : "unknown";
}

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

export function createFoundationErrorLink(): ApolloLink {
  return new ApolloLink((operation, forward) => forward(operation).pipe(
    map((result) => {
      const firstError = result.errors?.[0];
      if (!firstError) return result;
      throw new FoundationGraphQlError(
        foundationDomainErrorCode(firstError.extensions?.code),
        firstError.message || "The GraphQL foundation request failed.",
        firstError.extensions,
      );
    }),
  ));
}

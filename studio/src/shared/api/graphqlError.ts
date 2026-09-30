import { FoundationGraphQlError } from "../apollo/errorLink";
import { ApiError } from "./errors";

/** Preserve the established REST-shaped mutation failure contract at the UI seam. */
export function graphQlMutationError(error: unknown): never {
  if (!(error instanceof FoundationGraphQlError)) throw error;
  const status = error.code === "not_found" ||
      error.code === "automation_attempt_not_found" ||
      error.code === "terminal_session_not_found" ||
      error.code === "agent_run_not_found" ||
      error.code === "resume_unknown"
    ? 404
    : error.code === "index_out_of_range"
      ? 400
    : error.code === "conflict" ||
        error.code === "stale_revision" ||
        error.code === "terminal_launch_conflict" ||
        error.code === "terminal_cleanup_conflict" ||
        error.code === "terminal_runtime_identity_conflict" ||
        error.code === "terminal_launch_busy" ||
        error.code === "terminal_cleanup_busy" ||
        error.code === "terminal_cleanup_pending" ||
        error.code === "viewer_lease_not_owned" ||
        error.code === "resume_active" ||
        error.code === "resume_already_resumed" ||
        error.code === "automation_attempt_not_failed" ||
        error.code === "automation_attempt_not_retryable"
      ? 409
      : error.code === "subtree_run_not_enabled"
        ? 403
      : error.code === "unauthorized"
        ? 401
        : error.code === "storage_unavailable" ||
            error.code === "worktracker_write_unavailable" ||
            error.code === "settings_file_failed" ||
            error.code === "settings_store_unavailable" ||
            error.code === "settings_write_unavailable"
          ? 503
          : 422;
  throw new ApiError(status, error.message, {
    ...error.extensions,
    detail: error.message,
    code: error.code,
  });
}

import { FoundationGraphQlError } from "../../graphql-foundation/foundationClient";
import { ApiError } from "./client";

/** Preserve the established REST-shaped mutation failure contract at the UI seam. */
export function graphQlMutationError(error: unknown): never {
  if (!(error instanceof FoundationGraphQlError)) throw error;
  const status = error.code === "not_found" ||
      error.code === "automation_attempt_not_found"
    ? 404
    : error.code === "index_out_of_range"
      ? 400
    : error.code === "conflict" ||
        error.code === "stale_revision" ||
        error.code === "automation_attempt_not_failed" ||
        error.code === "automation_attempt_not_retryable"
      ? 409
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

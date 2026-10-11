import { CombinedGraphQLErrors } from "@apollo/client";
import { FoundationGraphQlError } from "../../shared/apollo/errorLink";

const rejectionCodes = new Set([
  "validation", "field_validation", "conflict", "illegal_transition", "human_only_transition",
  "stale_revision", "unauthorized", "not_found", "invalid_identity",
]);

/** Read/storage/unknown errors do not establish whether a suggestion transaction committed. */
export function isSuggestionWriteRejection(error: unknown): boolean {
  if (error instanceof FoundationGraphQlError) return rejectionCodes.has(error.code);
  return CombinedGraphQLErrors.is(error) && !error.data?.update_sprint_suggestion && error.errors.length > 0 &&
    error.errors.every((entry) => typeof entry.extensions?.code === "string" && rejectionCodes.has(entry.extensions.code));
}

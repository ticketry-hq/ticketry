import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";

/**
 * The sentence to show when a review read fails.
 *
 * The backend already curates these — a git failure crosses the wire as an
 * actionable sentence and never as command output — so the job here is only
 * to prefer that sentence over a transport-level message.
 */
export function reviewFailureMessage(error: unknown): string {
  if (error instanceof WorkTrackerApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Studio could not read this checkout.";
}

import { ApiError } from "../api/errors";

/**
 * The actionable message for a failed save: the API error's string `detail`,
 * else its 422 list of `msg` entries joined with "; ", else the error's message.
 */
export function saveErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    const detail = (error.body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail) return detail;
    // A 422 arrives as a list of per-field objects. Reading only the string
    // form replaced the server's actual message ("reasoning is not valid for
    // provider 'gemini'") with a bare "HTTP 422".
    if (Array.isArray(detail)) {
      const messages = detail
        .map((entry) =>
          entry && typeof entry === "object"
            ? String((entry as { msg?: unknown }).msg ?? "")
            : String(entry))
        .filter(Boolean);
      if (messages.length > 0) return messages.join("; ");
    }
  }
  return error instanceof Error ? error.message : String(error);
}

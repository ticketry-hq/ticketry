// A refused launch has to say *why* it was refused. The control plane answers
// with a stable policy code (`POST /api/terminals` → `{detail:{error}}`, or the
// terminal socket's error frame); without this translation the surface shows
// `HTTP 400`, which reads as "something broke" for what is really a
// configuration decision the user can act on.

/** Codes worth a sentence. Anything else keeps its raw code. */
const LAUNCH_FAILURE_REASONS: Record<string, string> = {
  // ADR-0015: a binding naming a deactivated provider is blocked, never
  // silently substituted, so the message names the specific cause and fix.
  provider_not_activated:
    "Launch blocked: this launch configuration names a provider that is "
    + "deactivated. Activate it in Settings → Model configuration, or point "
    + "the configuration at an activated provider.",
};

/** Translate one control-plane launch code into what the user should read. */
export function launchFailureReason(code: string): string {
  return LAUNCH_FAILURE_REASONS[code] ?? code;
}

function errorCodeFrom(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const detail = (body as { detail?: unknown }).detail;
  if (detail && typeof detail === "object") {
    const error = (detail as { error?: unknown }).error;
    if (typeof error === "string" && error) return error;
  }
  if (typeof detail === "string" && detail) return detail;
  return null;
}

/** What to write into the terminal when creating the run was refused. */
export function launchFailureMessage(error: unknown): string {
  const code = errorCodeFrom(
    error && typeof error === "object" ? (error as { body?: unknown }).body : null,
  );
  if (code) return launchFailureReason(code);
  return error instanceof Error ? error.message : "launch_failed";
}

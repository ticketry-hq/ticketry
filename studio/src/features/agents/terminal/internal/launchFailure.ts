// A refused launch has to say *why* it was refused. The control plane answers
// with a stable policy code (`POST /api/terminals` → `{detail:{error}}`, or the
// terminal socket's error frame); without this translation the surface shows
// `HTTP 400`, which reads as "something broke" for what is really a
// configuration decision the user can act on.

/** Codes worth a sentence. Anything else keeps its raw code. */
const LAUNCH_FAILURE_REASONS: Record<string, string> = {
  no_profile_selected: "Select a Studio launch profile before trying again.",
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

interface RequiredSkillFailure {
  code: "required_skill_unavailable";
  provider: string;
  skill: string;
  reason: string;
  detail: string;
  remediation: string;
}

function requiredSkillFailure(body: unknown): RequiredSkillFailure | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Partial<RequiredSkillFailure>;
  return value.code === "required_skill_unavailable" &&
    typeof value.provider === "string" &&
    typeof value.skill === "string" &&
    typeof value.reason === "string" &&
    typeof value.detail === "string" &&
    typeof value.remediation === "string"
    ? (value as RequiredSkillFailure)
    : null;
}

function errorDetailFrom(body: unknown): { code: string | null; message: string | null } {
  if (!body || typeof body !== "object") return { code: null, message: null };
  const bodyCode = (body as { code?: unknown }).code;
  const detail = (body as { detail?: unknown }).detail;
  if (!detail || typeof detail !== "object") {
    return {
      code: typeof bodyCode === "string" && bodyCode
        ? bodyCode
        : typeof detail === "string" && detail
          ? detail
          : null,
      message: null,
    };
  }
  const { error, message } = detail as { error?: unknown; message?: unknown };
  return {
    code: typeof bodyCode === "string" && bodyCode
      ? bodyCode
      : typeof error === "string" && error
        ? error
        : null,
    message: typeof message === "string" && message ? message : null,
  };
}

/** What to write into the terminal when creating the run was refused. */
export function launchFailureMessage(error: unknown): string {
  const body =
    error && typeof error === "object" ? (error as { body?: unknown }).body : null;
  const requiredSkill = requiredSkillFailure(body);
  if (requiredSkill) {
    return `Required skill '${requiredSkill.skill}' is unavailable for ${requiredSkill.provider} (${requiredSkill.reason}): ${requiredSkill.detail} Next action: ${requiredSkill.remediation}`;
  }
  const { code, message } = errorDetailFrom(body);
  if (code === "launch_unavailable" && message) {
    return `Launch unavailable: ${message}`;
  }
  if (code) return launchFailureReason(code);
  return error instanceof Error ? error.message : "launch_failed";
}

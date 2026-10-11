import type { SkillAvailabilityView } from "./skillAvailability";

/**
 * The readable explanation behind the skill chips: which provider was checked,
 * what it cannot see, where Ticketry looked, and a Recheck for a skill the
 * person installs by hand. Availability is an observation of the searched
 * locations only, and a missing skill never blocks saving.
 */
export function SkillAvailabilitySummary({
  availability,
  required = false,
}: {
  availability: SkillAvailabilityView;
  required?: boolean;
}) {
  const { checking, recheck, result } = availability;
  const missing = result?.skills
    .filter((skill) => skill.status === "missing")
    .map((skill) => skill.requested) ?? [];
  const unverified = result?.skills.some((skill) => skill.status === "unchecked") ?? false;

  const saveMessage = required
    ? "Saving still requires a name in the pinned required-skill allow-list"
    : "Saving is still allowed";
  let message: string;
  if (!result) {
    message = "Checking skill availability…";
  } else if (result.status === "unchecked" || unverified) {
    const reason = result.message
      ?? result.skills.find((skill) => skill.reason)?.reason
      ?? "The check did not complete.";
    message = `Skill availability not verified. ${reason} ${saveMessage}.`;
  } else if (missing.length > 0) {
    message = `${result.provider} cannot see ${missing.join(", ")}. `
      + `Searched: ${result.searched_roots.join(", ")}. `
      + `${saveMessage}; install the skill yourself, then Recheck.`;
  } else {
    message = `All skills are available to ${result.provider} in the searched locations.`;
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      <p
        role="status"
        aria-label={required ? "Required skill availability" : "Skill availability"}
        className={missing.length > 0 || unverified || result?.status === "unchecked"
          ? "min-w-0 flex-1 break-words text-lifecycle-attention"
          : "min-w-0 flex-1 break-words text-text-muted"}
      >
        {message}
      </p>
      <button
        type="button"
        onClick={recheck}
        disabled={checking}
        className="border border-pane-border px-2 py-0.5 text-xs text-text-primary hover:border-text-muted focus:outline-none focus:ring-1 focus:ring-focus-accent disabled:opacity-60"
      >
        {required ? "Recheck required skills" : "Recheck skills"}
      </button>
    </div>
  );
}

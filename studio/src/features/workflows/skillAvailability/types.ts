/** One availability question for the provider a stage would launch with. */
export interface SkillAvailabilityRequest {
  moduleId: string;
  /** The editor's agent/provider; null lets the host resolve profile/default. */
  agent: string | null;
  profile: string | null;
  names: string[];
}

export type SkillStatus = "available" | "missing" | "unchecked";

export interface SkillAvailabilityEntry {
  requested: string;
  status: SkillStatus;
  installed_name: string | null;
  location: string | null;
  reason: string | null;
}

/**
 * The host's observation of the searched locations. `unchecked` means no
 * availability fact was established — never that the skills exist.
 */
export interface SkillAvailabilityResult {
  status: "checked" | "unchecked";
  code: string | null;
  message: string | null;
  provider: string | null;
  searched_roots: string[];
  skills: SkillAvailabilityEntry[];
}

export type SkillAvailabilityCheck = (
  request: SkillAvailabilityRequest,
) => Promise<SkillAvailabilityResult>;

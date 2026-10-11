import { studioApolloClient } from "../../../shared/apollo/client";
import { LaunchSkillAvailabilityDocument } from "../generated/skillAvailability.documents";
import type {
  SkillAvailabilityRequest,
  SkillAvailabilityResult,
  SkillStatus,
} from "./types";

const statuses = new Set<SkillStatus>(["available", "missing", "unchecked"]);

/**
 * Ask the host which stage skills the stage's provider can see. The answer is
 * a transient observation of the filesystem, so it bypasses the cache: a
 * Recheck after a manual installation must reach the host again.
 */
export async function checkStageSkillAvailability(
  request: SkillAvailabilityRequest,
): Promise<SkillAvailabilityResult> {
  const { data } = await studioApolloClient().query({
    query: LaunchSkillAvailabilityDocument,
    variables: {
      moduleId: request.moduleId,
      agent: request.agent,
      profile: request.profile,
      names: request.names,
    },
    fetchPolicy: "no-cache",
  });
  const payload = data!.launch_skill_availability;
  return {
    status: payload.status === "checked" ? "checked" : "unchecked",
    code: payload.code,
    message: payload.message,
    provider: payload.provider,
    searched_roots: payload.searched_roots,
    skills: payload.skills.map((skill) => ({
      requested: skill.requested,
      // An unknown status is not evidence of availability.
      status: statuses.has(skill.status as SkillStatus)
        ? skill.status as SkillStatus
        : "unchecked",
      installed_name: skill.installed_name,
      location: skill.location,
      reason: skill.reason,
    })),
  };
}

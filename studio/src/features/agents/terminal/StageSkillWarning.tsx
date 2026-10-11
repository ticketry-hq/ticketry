import { useQuery } from "@apollo/client/react";
import { studioApolloClient } from "../../../shared/apollo/client";
import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import type { SkillAvailabilityResult } from "../../workflows";
import { AgentRunStageSkillAvailabilityDocument } from "./generated/stageSkillWarning.documents";

/** This is run metadata, outside the PTY and provider launch material. */
export function StageSkillWarning({ agentRunId }: { agentRunId: string }) {
  const { data } = useQuery(AgentRunStageSkillAvailabilityDocument, {
    client: studioApolloClient(),
    variables: { agentRunId },
    fetchPolicy: "cache-and-network",
  });
  const raw = data?.agent_runs?.nodes?.find((run) => compactWorktrackerId(run.id) === compactWorktrackerId(agentRunId))?.stage_skill_availability;
  const result = parseAvailability(raw);
  if (!raw) return null;
  const missing = result?.skills?.filter((skill) => skill.status === "missing").map((skill) => skill.requested) ?? [];
  const unchecked = result?.skills?.filter((skill) => result.status === "unchecked" || skill.status === "unchecked").map((skill) => skill.requested) ?? [];
  const unverified = !result || result.status === "unchecked" || unchecked.length > 0;
  if (!unverified && missing.length === 0) return null;
  const reason = result?.message ?? result?.skills?.find((skill) => skill.reason)?.reason;
  return (
    <div
      role="status"
      aria-label="Stage skill warning"
      data-testid="stage-skill-warning"
      data-agent-run-id={agentRunId}
      className="shrink-0 border-b border-lifecycle-attention/40 bg-pane-panel px-3 py-2 text-xs text-lifecycle-attention"
    >
      {missing.length > 0 && `${result?.provider ?? "Provider"} cannot see stage skills: ${missing.join(", ")}. `}
      {unverified && `${result?.provider ?? "Provider"} stage skill availability is unchecked${unchecked.length ? `: ${unchecked.join(", ")}` : ""}. ${reason ?? "The check did not complete."} `}
      Launch proceeds. Install the skills yourself; a new run checks again.
    </div>
  );
}

/** Never interpret an unreadable observation as installation success. */
function parseAvailability(raw: string | null | undefined): SkillAvailabilityResult | null {
  try {
    const candidate: unknown = raw ? JSON.parse(raw) : null;
    if (!candidate || typeof candidate !== "object") return null;
    const result = candidate as Record<string, unknown>;
    if ((result.status !== "checked" && result.status !== "unchecked") || !Array.isArray(result.skills)) return null;
    const skills: SkillAvailabilityResult["skills"] = [];
    for (const value of result.skills) {
      if (!value || typeof value !== "object") return null;
      const entry = value as Record<string, unknown>;
      if (typeof entry.requested !== "string" || !["available", "missing", "unchecked"].includes(String(entry.status))) return null;
      skills.push({
        requested: entry.requested,
        status: entry.status as SkillAvailabilityResult["skills"][number]["status"],
        reason: text(entry.reason), installed_name: text(entry.installed_name), location: text(entry.location),
      });
    }
    return {
      status: result.status, provider: text(result.provider), code: text(result.code), message: text(result.message),
      skills, searched_roots: Array.isArray(result.searched_roots) ? result.searched_roots.filter((root): root is string => typeof root === "string") : [],
    };
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

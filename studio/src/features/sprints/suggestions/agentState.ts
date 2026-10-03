import type { SprintExecutionRecordFragment } from "../generated/sprints.documents";

type SuggestionExecution = Pick<SprintExecutionRecordFragment, "state" | "goalsRevision" | "error">;

export type AgentState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; waitingCount: number }
  | { kind: "stale" }
  | { kind: "error"; message: string }
  | { kind: "cancelled" };

export function deriveAgentState(
  execution: SuggestionExecution | null | undefined,
  goalsRevisedAt: string | null | undefined,
  waitingCount: number,
): AgentState {
  if (!execution) return { kind: "idle" };
  if (execution?.state === "queued" || execution?.state === "running") return { kind: "running" };
  if ((execution.state === "succeeded" || execution.state === "failed") &&
      (goalsRevisedAt ?? null) !== execution.goalsRevision) return { kind: "stale" };
  switch (execution.state) {
    case "succeeded": return { kind: "done", waitingCount };
    case "failed": return { kind: "error", message: execution.error || "The agent couldn’t finish." };
    case "cancelled": return { kind: "cancelled" };
    default: return { kind: "error", message: `Unknown suggestion execution state: ${execution.state}` };
  }
}

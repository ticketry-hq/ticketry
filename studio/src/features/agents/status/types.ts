import type {
  AgentRunScope,
  AutomationAttemptRecord,
  AgentStatusScope,
  RawLifecycleState,
  RunRecord,
} from "@worktracker/typescript-sdk";

export type {
  AgentRunScope,
  AgentStatusScope,
  AutomationAttemptRecord,
  RawLifecycleState,
  RunRecord,
};

export type AgentLifecycle = "idle" | "active" | "attention";

export interface AgentStatusData {
  projectId: string | null;
  runs: Record<string, RunRecord>;
  automationAttempts: Record<string, AutomationAttemptRecord>;
  automationByTask: Record<string, string[]>;
}

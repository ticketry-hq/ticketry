import type {
  AgentRunScope,
  AgentRunKind,
  AutomationAttemptRecord,
  AgentStatusScope,
  RawLifecycleState,
  RunRecord,
} from "@worktracker/typescript-sdk";

export type {
  AgentRunScope,
  AgentRunKind,
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

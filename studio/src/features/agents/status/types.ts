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

export interface AgentStatusRun {
  runId: string;
  taskId: string | null;
  moduleId: string;
  scope: AgentRunScope;
  state: RawLifecycleState;
  updatedAt: string;
}

export interface AgentStatusData {
  projectId: string | null;
  runs: Record<string, AgentStatusRun>;
  byTask: Record<string, string[]>;
  automationAttempts: Record<string, AutomationAttemptRecord>;
  automationByTask: Record<string, string[]>;
}

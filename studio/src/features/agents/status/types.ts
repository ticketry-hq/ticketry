import type {
  AgentRunScope,
  AutomationAttemptRecord,
  AgentStatusScope,
  RawLifecycleState,
  RunPresentationState,
  RunRecord,
} from "@worktracker/typescript-sdk";

export type {
  AgentRunScope,
  AgentStatusScope,
  AutomationAttemptRecord,
  RawLifecycleState,
  RunPresentationState,
  RunRecord,
};

export type AgentLifecycle = "idle" | "active" | "attention";

export interface AgentStatusData {
  projectId: string | null;
  runs: Record<string, RunRecord>;
  automationAttempts: Record<string, AutomationAttemptRecord>;
  automationByTask: Record<string, string[]>;
  /**
   * Bumped when only the clock has moved a run past its unchanged-output
   * deadline. Readers project from `runs` plus the current time, so this is
   * what tells them to reproject without any run fact having changed.
   */
  stallEpoch: number;
}

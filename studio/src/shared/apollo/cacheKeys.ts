import type { TypePolicies } from "@apollo/client";

const normalizedEntityKeyFields = {
  WorktrackerWorkspace: ["id"],
  WorktrackerProject: ["id"],
  WorktrackerIssue: ["id"],
  WorktrackerIssueBlockedBy: ["id"],
  WorktrackerState: ["id"],
  WorktrackerIssuetype: ["id"],
  WorktrackerIssuetypetransition: ["id"],
  WorktrackerLaunchbinding: ["id"],
  WorktrackerProvider: ["id"],
  WorktrackerAgentmodel: ["id"],
  WorktrackerReasoninglevel: ["id"],
  WorktrackerAgentmodelreasoninglevel: ["id"],
  WorktrackerAttachment: ["id"],
  AgentRuns: ["id"],
  ProjectRunStatus: ["projectId"],
  AutomationAttemptStatus: ["rootAttemptId"],
  AgentTerminalSessions: ["agentRunId"],
  GraphRuns: ["rootId"],
  Worktrees: ["id"],
  DesignDocuments: ["id"],
  // A Module has at most one link, so the Module is the link's identity: an
  // optimistic write and the row the host returns address the same cache entry.
  ModuleLinks: ["moduleId"],
  TicketryLocalState: ["id"],
} as const satisfies Record<string, readonly string[]>;

export function normalizedEntityPolicies(): TypePolicies {
  const policies: TypePolicies = Object.fromEntries(
    Object.entries(normalizedEntityKeyFields).map(([typename, keyFields]) => [
      typename,
      { keyFields: [...keyFields] },
    ]),
  );
  policies.ProjectRunStatus = {
    ...policies.ProjectRunStatus,
    fields: {
      runs: { merge: false },
      automationAttempts: { merge: false },
    },
  };
  policies.TicketryLocalState = {
    ...policies.TicketryLocalState,
    fields: {
      value: { merge: false },
    },
  };
  return policies;
}

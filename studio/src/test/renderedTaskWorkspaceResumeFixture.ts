import { act, waitFor } from "@testing-library/react";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useTerminalForegroundStore, useTerminalStore } from "../features/agents/terminal";
import type { ResumableTerminalSession } from "../features/agents/types";
import { useStudioStore } from "../features/projects/store";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime, terminalSessionReadExecutor } from "./desktopGraphQlRuntime";

const startedAt = "2026-10-09T08:00:00Z";

export function resumeSource(agentRunId = "source-a", agent: "codex" | "claude" = "codex"): ResumableTerminalSession {
  return { agent_run_id: agentRunId, agent, status: "exited", started_at: startedAt,
    ended_at: startedAt, launch_state: "Implement", launch_model: null,
    provider_session_id: `provider-${agentRunId}`, resumed_from: null, scope: "task" };
}

/** Controlled completion of the shipping resume mutation; workspace and Apollo stay real. */
export function installDeferredWorkspaceResumes(sources = [resumeSource()]) {
  const requests: Array<{ sourceRunId: string; taskId: string;
    resolve: (runId: string) => void; reject: (error: Error) => void }> = [];
  const terminalReads = terminalSessionReadExecutor({
    readTaskTerminalSessions: async () => [],
    readScratchTerminalSessions: async () => [],
    readTaskResumableTerminalSessions: async (taskId) => taskId === "story-a" ? sources : [],
    readScratchResumableTerminalSessions: async () => [],
  });
  const operations = installDesktopGraphQlRuntime(async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "ResumeTerminalSession") {
      const input = variables as { resumeFromAgentRunId: string; issueId: string; provider: string };
      const runId = await new Promise<string>((resolve, reject) => requests.push({
        sourceRunId: input.resumeFromAgentRunId, taskId: input.issueId, resolve, reject,
      }));
      return { terminal_session: { __typename: "AgentTerminalSessions", scope: "task",
        agent_run_id: runId, module_id: "module-1", doc_rel_path: null, created_at: startedAt,
        agent_run: { __typename: "AgentRuns", id: runId, agent: input.provider,
          launch_state: "Implement", launch_model: null } } } as never;
    }
    if (operation === "WorktreeStatus") {
      return { worktree_status: { __typename: "WorktreeStatusView", kind: "none",
        task_id: "story-a", top_level_task_id: "story-a", is_shared: false, branch: null,
        base_branch: null, path: null, state: null, clean: null, dirty: null, ahead: null,
        behind: null, conflict: null, checkout_present: false, ephemeral: false, reason: null } } as never;
    }
    return terminalReads(document, variables);
  });
  localStorage.clear();
  useStudioStore.setState({ selectedProjectId: "project-1" });
  useClientStore.setState({ selectedModuleId: "module-1", selectedTaskId: "story-a",
    focusedPane: "tasks", sidebarVisible: true, editViewBodyEngaged: false,
    editViewZone: "stories", navigationModality: "pointer", workspaces: {}, activeByTask: {} });
  useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
  useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  useAgentStatusStore.setState({ projectId: "project-1", runs: {}, automationAttempts: {}, automationByTask: {} });

  async function request(sourceRunId = "source-a", occurrence = 0) {
    await waitFor(() => {
      if (!requests.filter((entry) => entry.sourceRunId === sourceRunId)[occurrence]) {
        throw new Error(`Waiting for resume ${sourceRunId} ${occurrence}`);
      }
    });
    return requests.filter((entry) => entry.sourceRunId === sourceRunId)[occurrence]!;
  }
  return { operations, request,
    async complete(sourceRunId = "source-a", runId = "successor-a") {
      const pending = await request(sourceRunId);
      await act(async () => { pending.resolve(runId); });
      await waitFor(() => expectRetainedRun(runId));
    },
    async fail(error: Error, sourceRunId = "source-a") {
      const pending = await request(sourceRunId);
      await act(async () => { pending.reject(error); });
    },
  };
}

export function expectRetainedRun(runId: string) {
  const state = useTerminalStore.getState();
  const sessionId = state.sessionByRun[runId];
  if (!sessionId || state.sessions[sessionId]?.agentRunId !== runId) {
    throw new Error(`Missing retained terminal for ${runId}`);
  }
  return sessionId;
}

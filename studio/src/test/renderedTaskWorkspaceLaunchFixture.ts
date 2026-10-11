import { act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";
import { useModalStore } from "../app/modal/modalStore";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useTerminalForegroundStore, useTerminalStore } from "../features/agents/terminal";
import { useStudioStore } from "../features/projects/store";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime, terminalSessionReadExecutor } from "./desktopGraphQlRuntime";
import { installWorkspaceViewerTransport } from "./renderedTaskWorkspaceTerminalFixture";

/** Delay real launch responses while keeping workspace, Apollo and terminal adapters mounted. */
export function installDeferredWorkspaceLaunches() {
  installWorkspaceViewerTransport();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "viewer_attach") {
      const runId = (args as { runId: string }).runId;
      return { viewerHandle: `session-${runId}`, runId, lifecycle: "attached" } as never;
    }
    return undefined as never;
  });
  const requests: Array<{ taskId: string; resolve: (runId: string) => void }> = [];
  const reads = terminalSessionReadExecutor({
    readTaskTerminalSessions: async () => [], readScratchTerminalSessions: async () => [],
    readTaskResumableTerminalSessions: async () => [], readScratchResumableTerminalSessions: async () => [],
  });
  installDesktopGraphQlRuntime(async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "CreateTerminalSession") {
      const taskId = (variables as { issueId: string }).issueId;
      const runId = await new Promise<string>((resolve) => { requests.push({ taskId, resolve }); });
      return { terminal_session: {
        __typename: "AgentTerminalSessions", agent_run_id: runId, module_id: "module-1",
        scope: "task", doc_rel_path: null, created_at: "2026-10-09T08:00:00Z",
        agent_run: { __typename: "AgentRuns", id: runId, launch_state: "Implement", launch_model: null },
      } } as never;
    }
    if (operation === "WorktreeStatus") return { worktree_status: {
      __typename: "WorktreeStatusView", kind: "none", task_id: "story-a", top_level_task_id: "story-a",
      is_shared: false, branch: null, base_branch: null, path: null, state: null, clean: null,
      dirty: null, ahead: null, behind: null, conflict: null, checkout_present: false,
      ephemeral: false, reason: null,
    } } as never;
    return reads(document, variables);
  });
  localStorage.clear();
  localStorage.setItem("ticketry:terminal-renderer", "xterm");
  useStudioStore.setState({ selectedProjectId: "project-1" });
  useClientStore.setState({ selectedModuleId: "module-1", selectedTaskId: "story-a",
    focusedPane: "tasks", sidebarVisible: true, editViewBodyEngaged: false,
    editViewZone: "stories", navigationModality: "pointer", workspaces: {}, activeByTask: {},
  });
  useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
  useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  useModalStore.setState({ modalStack: [] });
  useAgentStatusStore.setState({ projectId: "project-1", runs: {}, automationAttempts: {}, automationByTask: {} });

  async function request(taskId: string, occurrence = 0) {
    await waitFor(() => expectRequest(taskId, occurrence));
    return requests.filter((request) => request.taskId === taskId)[occurrence]!;
  }
  function expectRequest(taskId: string, occurrence: number) {
    if (!requests.filter((request) => request.taskId === taskId)[occurrence]) {
      throw new Error(`Waiting for ${taskId} launch ${occurrence}`);
    }
  }
  return {
    request,
    async deliver(taskId: string, runId: string, occurrence = 0) {
      const pending = await request(taskId, occurrence);
      await act(async () => { pending.resolve(runId); });
      await waitFor(() => {
        if (!useTerminalStore.getState().sessionByRun[runId]) throw new Error(`Waiting for ${runId} binding`);
      });
    },
  };
}

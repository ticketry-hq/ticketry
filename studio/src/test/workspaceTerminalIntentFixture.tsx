import { installWorkspaceViewerTransport } from "./renderedTaskWorkspaceTerminalFixture";
import { act } from "@testing-library/react";
import { vi } from "vitest";
import { TaskWorkspace } from "../features/task-workspace";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useTerminalStore } from "../features/agents/terminal";
import type { ResumableTerminalSession } from "../features/agents/types";
import { useStudioStore } from "../features/projects/store";
import { useClientStore } from "../state/clientStore";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { installDesktopGraphQlRuntime, terminalSessionReadExecutor, type WorkItemEndedRunFixture } from "./desktopGraphQlRuntime";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

export function terminalIntentFixture() {
  installWorkspaceViewerTransport();
  const ended = vi.fn<(task: string) => Promise<WorkItemEndedRunFixture[]>>().mockResolvedValue([]);
  const resumable = vi.fn<(task: string) => Promise<ResumableTerminalSession[]>>().mockResolvedValue([]);
  const terminalReads = terminalSessionReadExecutor({
    readTaskTerminalSessions: async () => [],
    readScratchTerminalSessions: async () => [],
    readTaskResumableTerminalSessions: resumable,
    readScratchResumableTerminalSessions: async () => [],
    readStoryEndedRuns: ended,
  });
  installDesktopGraphQlRuntime(async (document, variables) => {
    if (documentOperationName(document) === "WorktreeStatus") {
      return { worktree_status: {
        __typename: "WorktreeStatusView", kind: "none", task_id: "story-1",
        top_level_task_id: "story-1", is_shared: false, branch: null, base_branch: null,
        path: null, state: null, clean: null, dirty: null, ahead: null, behind: null,
        conflict: null, checkout_present: false, ephemeral: false, reason: null,
      } } as never;
    }
    return terminalReads(document, variables);
  });
  localStorage.clear();
  useStudioStore.setState({ selectedProjectId: "project-1" });
  useClientStore.setState({ selectedModuleId: "module-1", selectedTaskId: "story-1",
    focusedPane: "tasks", sidebarVisible: true, editViewBodyEngaged: false,
    editViewZone: "stories", navigationModality: "pointer", workspaces: {}, activeByTask: {} });
  useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  useAgentStatusStore.setState({ projectId: "project-1", complete: true, runs: {},
    automationAttempts: {}, automationByTask: {} });
  return { ended, resumable };
}

export function terminalWorkspace(bucket = "story-1", conversationRunId: string | null = null) {
  return <TaskWorkspace bucket={bucket} projectId="project-1" moduleId="module-1"
    owner="studio" conversationRunId={conversationRunId} details={<div>Issue details {bucket}</div>} />;
}

export function publishLiveRuns(ids: string[], bucket = "story-1", complete = true) {
  act(() => useAgentStatusStore.setState({ complete, runs: Object.fromEntries(ids.map((id) => [id, {
    agent_run_id: id, project_id: "project-1", task_id: bucket, module_id: "module-1",
    agent: "codex", scope: "task" as const, state: "working" as const,
    launch_state: id, started_at: "2026-10-09T08:00:00Z", updated_at: "2026-10-09T08:00:00Z",
  }])) }));
}

export function seedTerminal(runId: string, taskId = "story-1") {
  const sessionId = `session-${runId}`;
  useTerminalStore.setState({
    sessions: { [sessionId]: {
      sessionId, agentRunId: runId, taskId, projectId: "project-1", moduleId: "module-1",
      agent: "codex", status: "ready", transport: "ready", isPlanning: false,
      isInstant: false, initialPrompt: null, viewerAttachmentDeferred: true,
    } },
    sessionByRun: { [runId]: sessionId },
  });
}

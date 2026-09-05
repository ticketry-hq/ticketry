import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useStudioStore } from "../features/projects/store";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { applySnapshotFrame } from "../features/agents/status/stream/statusSnapshot";
import { statusStreamFeed } from "../features/agents/status/stream/statusStreamFeed";
import { scratchBucketId, useTerminalStore } from "../features/agents/terminal";
import {
  instantRunPlanningRowId,
  selectPlanningRowId,
} from "../app/shell/ticket-workspace/tasks/internal/instantRunTicketNavigation";
import { TEMP_TASK_ID } from "../features/agents/types";
import { useClientStore } from "../state/clientStore";
import {
  installDesktopGraphQlRuntime,
  terminalSessionReadExecutor,
} from "./desktopGraphQlRuntime";

const documentRegistry = vi.hoisted(() => ({
  listTaskDocuments: vi.fn(),
  listScratchDocuments: vi.fn(),
}));

vi.mock("../features/documents/documentRegistry", () => documentRegistry);

vi.mock(
  "../app/shell/ticket-workspace/selected-ticket/terminals/SelectedTicketTerminal",
  () => ({
    SelectedTicketTerminal: ({ bucket }: { bucket: string }) => (
      <div data-testid="selected-ticket-terminal">{bucket}</div>
    ),
  }),
);

const terminalReads = vi.hoisted(() => {
  const resumable = vi.fn();
  return {
    readTaskTerminalSessions: vi.fn(),
    readScratchTerminalSessions: vi.fn(),
    readTaskResumableTerminalSessions: resumable,
    readScratchResumableTerminalSessions: resumable,
    readStoryEndedRuns: vi.fn(),
    readModuleScratchEndedRuns: vi.fn(),
  };
});

function scratchWorkspace() {
  return (
    <SelectedTicketContent
      bucket={scratchBucketId("module-1")}
      projectId="project-1"
      moduleId="module-1"
      owner="studio"
      details={<div>Module details</div>}
    />
  );
}

function workspace() {
  return (
    <SelectedTicketContent
      bucket="story-1"
      projectId="project-1"
      moduleId="module-1"
      owner="studio"
      details={<div>Issue details</div>}
    />
  );
}

function terminatedChips() {
  return screen.queryAllByLabelText(/^Terminated /);
}

beforeEach(() => {
  vi.resetAllMocks();
  installDesktopGraphQlRuntime(terminalSessionReadExecutor(terminalReads));
  localStorage.clear();
  useStudioStore.setState({ selectedProjectId: "project-1" });
  useClientStore.setState({
    selectedModuleId: "module-1",
    selectedTaskId: "story-1",
    focusedPane: "tasks",
    sidebarVisible: true,
    storySearchQuery: "",
    collapsedStateIds: new Set(["todo"]),
    expandedIdsByModule: {},
    workspaces: {},
    activeByTask: {},
  });
  useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  useAgentStatusStore.setState({
    projectId: "project-1",
    runs: {},
    automationAttempts: {},
    automationByTask: {},
  });
  documentRegistry.listTaskDocuments.mockResolvedValue([]);
  documentRegistry.listScratchDocuments.mockResolvedValue([]);
  terminalReads.readTaskTerminalSessions.mockResolvedValue([]);
  terminalReads.readScratchTerminalSessions.mockResolvedValue([]);
  terminalReads.readTaskResumableTerminalSessions.mockResolvedValue([]);
  terminalReads.readStoryEndedRuns.mockResolvedValue([]);
  terminalReads.readModuleScratchEndedRuns.mockResolvedValue([]);
  statusStreamFeed.resetCursors("project-1");
});

afterEach(() => {
  statusStreamFeed.stop();
  vi.unstubAllGlobals();
});

describe("overhaul acceptance — Story run restoration", () => {
  it("[overhaul-279] restores a Story's ended runs from the WorkItem read with no live snapshot", async () => {
    terminalReads.readStoryEndedRuns.mockResolvedValue([
      // Older than any calendar window the snapshot ever used.
      {
        agent_run_id: "run-ended",
        started_at: "2019-03-01T09:00:00Z",
        ended_at: "2019-03-01T09:30:00Z",
        terminated_at: null,
      },
      // Its tmux session is gone, so there is nothing left to reattach.
      {
        agent_run_id: "run-terminated",
        started_at: "2026-08-22T10:00:00Z",
        ended_at: "2026-08-22T10:05:00Z",
        terminated_at: "2026-08-22T10:05:00Z",
      },
    ]);

    render(workspace());

    await waitFor(() => expect(terminatedChips()).toHaveLength(1));
    expect(terminalReads.readStoryEndedRuns).toHaveBeenCalledWith("story-1");
    // The live holding never carried it; the WorkItem read is the only source.
    expect(useAgentStatusStore.getState().runs).toEqual({});
  });

  it("shows no restored tabs for a Story whose ended runs have no terminal session record", async () => {
    terminalReads.readStoryEndedRuns.mockResolvedValue([
      { agent_run_id: "run-recent", ended_at: "2026-08-22T10:05:00Z" },
    ]);

    render(workspace());

    await waitFor(() =>
      expect(terminalReads.readStoryEndedRuns).toHaveBeenCalled(),
    );
    expect(terminatedChips()).toHaveLength(0);
  });

  it("presents one chip for a run the event settled and the WorkItem read restores", async () => {
    useAgentStatusStore.setState({
      runs: {
        "run-both": {
          agent_run_id: "run-both",
          task_id: "story-1",
          module_id: "module-1",
          project_id: "project-1",
          agent: "codex",
          scope: "task" as const,
          state: "exited" as const,
          started_at: "2026-08-22T10:00:00Z",
          updated_at: "2026-08-22T10:05:00Z",
        },
      },
    });
    terminalReads.readStoryEndedRuns.mockResolvedValue([
      { agent_run_id: "run-both", terminated_at: null },
    ]);

    render(workspace());

    await waitFor(() =>
      expect(terminalReads.readStoryEndedRuns).toHaveBeenCalled(),
    );
    // One AgentRuns identity, so the pushed row and the read row are one chip.
    await waitFor(() => expect(terminatedChips()).toHaveLength(1));
  });

  it("keeps the exited chip when a live-only snapshot drops a run the event ended", async () => {
    // The workspace opened before the run ended, so its read carried nothing.
    useAgentStatusStore.setState({
      runs: {
        "run-exited": {
          agent_run_id: "run-exited",
          task_id: "story-1",
          module_id: "module-1",
          project_id: "project-1",
          agent: "codex",
          scope: "task" as const,
          state: "exited" as const,
          started_at: "2026-08-22T10:00:00Z",
          updated_at: "2026-08-22T10:05:00Z",
        },
      },
    });

    render(workspace());

    await waitFor(() => expect(terminatedChips()).toHaveLength(1));

    // The run has ended for real, so the WorkItem read now carries it.
    terminalReads.readStoryEndedRuns.mockResolvedValue([
      { agent_run_id: "run-exited", terminated_at: null },
    ]);

    // A live-only snapshot (visibilitychange, reconnect) omits the ended run,
    // which settles it out of the live holding.
    act(() => {
      applySnapshotFrame({
        __typename: "RunStatusSnapshot",
        project_id: "project-1",
        cursor: 4,
        runs: [],
        automation_attempts: [],
        at: "2026-08-22T10:06:00Z",
      });
    });

    await waitFor(() =>
      expect(useAgentStatusStore.getState().runs["run-exited"]).toBeUndefined(),
    );
    // Settling refetched the WorkItem read, so the chip never disappeared.
    await waitFor(() => expect(terminatedChips()).toHaveLength(1));
  });
});

describe("overhaul acceptance — module scratch run restoration", () => {
  beforeEach(() => {
    useClientStore.setState({ selectedTaskId: TEMP_TASK_ID });
  });

  it("[overhaul-280] restores a module's ended plan, instant, and shell runs across a reload", async () => {
    terminalReads.readModuleScratchEndedRuns.mockResolvedValue([
      // Older than any calendar window the snapshot ever used.
      { agent_run_id: "run-plan", scope: "plan", started_at: "2019-03-01T09:00:00Z", terminated_at: null },
      { agent_run_id: "run-instant", scope: "instant", started_at: "2019-03-01T09:10:00Z", terminated_at: null },
      { agent_run_id: "run-shell", scope: "shell", agent: null, started_at: "2019-03-01T09:20:00Z", terminated_at: null },
      // No terminal session record: never had a durable terminal to reattach.
      { agent_run_id: "run-no-session", scope: "plan", started_at: "2019-03-01T09:30:00Z" },
      // Terminated session, and no provider conversation to be listed as
      // resumable instead, so this read is the only thing that can drop it.
      {
        agent_run_id: "run-shell-terminated",
        scope: "shell",
        agent: null,
        started_at: "2019-03-01T09:40:00Z",
        terminated_at: "2019-03-01T09:45:00Z",
      },
    ]);

    const first = render(scratchWorkspace());
    await waitFor(() => expect(terminatedChips()).toHaveLength(3));
    expect(terminalReads.readModuleScratchEndedRuns).toHaveBeenCalledWith(
      "module-1",
    );
    // The module WorkItem owns them; the live holding never carried them.
    expect(useAgentStatusStore.getState().runs).toEqual({});

    // A reload rebuilds from the same read, not from retained state.
    first.unmount();
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    render(scratchWorkspace());
    await waitFor(() => expect(terminatedChips()).toHaveLength(3));
  });

  it("[overhaul-281] reopens the terminal of a restored ended instant run", async () => {
    terminalReads.readModuleScratchEndedRuns.mockResolvedValue([
      {
        agent_run_id: "run-instant",
        scope: "instant",
        agent: "codex",
        started_at: "2019-03-01T09:10:00Z",
        terminated_at: null,
      },
    ]);

    render(scratchWorkspace());
    await waitFor(() => expect(terminatedChips()).toHaveLength(1));

    selectPlanningRowId(instantRunPlanningRowId("run-instant"));

    const bucket = scratchBucketId("module-1");
    const sessionId = useTerminalStore.getState().sessionByRun["run-instant"];
    expect(sessionId).toBeTruthy();
    const session = useTerminalStore.getState().sessions[sessionId!];
    // Folded back into the scratch bucket, labelled as the instant run it is.
    expect(session).toMatchObject({ taskId: null, moduleId: "module-1", isInstant: true });
    // The terminal surface, not the details fallback the throw used to force.
    expect(useClientStore.getState().workspaces[bucket]?.active).toBe("terminal");
  });

  it("restores none for a module whose ended runs have no terminal session record", async () => {
    terminalReads.readModuleScratchEndedRuns.mockResolvedValue([
      { agent_run_id: "run-plan", scope: "plan" },
      { agent_run_id: "run-instant", scope: "instant" },
    ]);

    render(scratchWorkspace());

    await waitFor(() =>
      expect(terminalReads.readModuleScratchEndedRuns).toHaveBeenCalled(),
    );
    expect(terminatedChips()).toHaveLength(0);
  });

  it("presents one chip for a scratch run the event settled and the read restores", async () => {
    useAgentStatusStore.setState({
      runs: {
        "run-plan": {
          agent_run_id: "run-plan",
          task_id: null,
          module_id: "module-1",
          project_id: "project-1",
          agent: "codex",
          scope: "plan" as const,
          state: "exited" as const,
          started_at: "2026-08-22T10:00:00Z",
          updated_at: "2026-08-22T10:05:00Z",
        },
      },
    });
    terminalReads.readModuleScratchEndedRuns.mockResolvedValue([
      { agent_run_id: "run-plan", scope: "plan", terminated_at: null },
    ]);

    render(scratchWorkspace());

    await waitFor(() =>
      expect(terminalReads.readModuleScratchEndedRuns).toHaveBeenCalled(),
    );
    // One AgentRuns identity, so the pushed row and the read row are one chip.
    await waitFor(() => expect(terminatedChips()).toHaveLength(1));
  });
});

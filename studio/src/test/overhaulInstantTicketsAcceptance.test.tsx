import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModalHost, useModalStore } from "../app/modal";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useSelectedInstantRunId } from "../app/shell/ticket-workspace/tasks/internal/instantRunTicketNavigation";
import {
  scratchBucketId,
  useTerminalStore,
  type SessionMeta,
} from "../features/agents/terminal";
import { TEMP_TASK_ID } from "../features/agents/types";
import { seedModuleLinks } from "../features/module-links";
import { useStudioStore } from "../features/projects/store";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import {
  installDesktopGraphQlRuntime,
  terminalSessionReadExecutor,
} from "./desktopGraphQlRuntime";
import { seedModuleOpenFixture } from "./projectOpenFixture";

vi.mock(
  "../app/shell/ticket-workspace/selected-ticket/terminals/selectedTicketTerminalLoader",
  () => ({
    loadSelectedTicketTerminal: async () => {},
    LazySelectedTicketTerminal: () => <div data-testid="selected-conversation-terminal" />,
  }),
);

const emptyTerminalReads = {
  readTaskTerminalSessions: async () => [],
  readScratchTerminalSessions: async () => [],
  readTaskResumableTerminalSessions: async () => [],
  readScratchResumableTerminalSessions: async () => [],
};

function instantSession(
  sessionId: string,
  runId: string,
): SessionMeta {
  return {
    sessionId,
    taskId: null,
    projectId: "project-1",
    moduleId: "module-1",
    agent: "codex",
    status: "ready",
    transport: "ready",
    isPlanning: false,
    isInstant: true,
    initialPrompt: null,
    agentRunId: runId,
  };
}

/** Mirrors SelectedTicket's wiring: bucket + conversation row follow selection. */
function ConversationWorkspaceHarness() {
  const selectedTaskId = useClientStore((state) => state.selectedTaskId);
  const selectedModuleId = useClientStore((state) => state.selectedModuleId);
  const conversationRunId = useSelectedInstantRunId();
  const bucket =
    selectedTaskId === TEMP_TASK_ID
      ? scratchBucketId(selectedModuleId ?? "")
      : selectedTaskId;
  return (
    <SelectedTicketContent
      bucket={bucket}
      projectId="project-1"
      moduleId={selectedModuleId}
      owner="studio"
      details={<div>Conversation details</div>}
      conversationRunId={conversationRunId}
    />
  );
}

describe("overhaul acceptance — Conversations", () => {
  beforeEach(() => {
    const terminalExecutor = terminalSessionReadExecutor(emptyTerminalReads);
    installDesktopGraphQlRuntime(async (document, variables) => {
      if (documentOperationName(document) === "InstantRunTickets") {
        return {
          tickets: [
            {
              __typename: "InstantRunTicket",
              agent_run_id: "instant-run-2",
              title: "Tighten the launch prompt",
              started_at: "2026-08-30T11:00:00Z",
            },
            {
              __typename: "InstantRunTicket",
              agent_run_id: "instant-run-1",
              title: "Itemize temporary chats",
              started_at: "2026-08-30T10:00:00Z",
            },
          ],
        } as never;
      }
      return terminalExecutor(document, variables);
    });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    const bucket = scratchBucketId("module-1");
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: TEMP_TASK_ID,
      workspaceSelection: { kind: "task" },
      storySearchQuery: "",
      focusedPane: "tasks",
      sidebarVisible: true,
      workspaces: {
        [bucket]: { active: "details", activeDocId: null, closedDocIds: [] },
      },
      activeByTask: {},
    });
    useTerminalStore.setState({
      sessions: {
        "session-1": instantSession("session-1", "instant-run-1"),
        "session-2": instantSession("session-2", "instant-run-2"),
      },
      sessionByRun: {
        "instant-run-1": "session-1",
        "instant-run-2": "session-2",
      },
    });
    useModalStore.setState({ modalStack: [] });
    seedModuleLinks([
      { id: "link-1", moduleId: "module-1", path: "/repos/ticketry" },
    ]);
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {
        "instant-run-1": {
          agent_run_id: "instant-run-1",
          project_id: "project-1",
          task_id: null,
          module_id: "module-1",
          agent: "codex",
          scope: "instant",
          state: "working",
          started_at: "2026-08-30T10:00:00Z",
          updated_at: "2026-08-30T10:00:00Z",
        },
        "instant-run-2": {
          agent_run_id: "instant-run-2",
          project_id: "project-1",
          task_id: null,
          module_id: "module-1",
          agent: "codex",
          scope: "instant",
          state: "needs_input",
          started_at: "2026-08-30T11:00:00Z",
          updated_at: "2026-08-30T11:00:00Z",
        },
        "plan-run": {
          agent_run_id: "plan-run",
          project_id: "project-1",
          task_id: null,
          module_id: "module-1",
          agent: "codex",
          scope: "plan",
          state: "working",
          started_at: "2026-08-30T09:00:00Z",
          updated_at: "2026-08-30T09:00:00Z",
        },
      },
      automationAttempts: {},
      automationByTask: {},
    });
    seedModuleOpenFixture("module-1", []);
  });

  it("[overhaul-202] replaces Scratch with Conversations and selects each chat's exact terminal", async () => {
    render(
      <StudioApolloProvider>
        <TasksPane />
      </StudioApolloProvider>,
    );

    const conversationsHeader = await screen.findByRole("button", {
      name: "Collapse Conversations",
    });
    expect(conversationsHeader).toHaveTextContent("Conversations2");
    expect(within(conversationsHeader).getByLabelText(/waiting for your input/i)).toBeVisible();
    expect(within(conversationsHeader).getByLabelText(/actively working/i))
      .toHaveTextContent("1");
    expect(screen.queryByRole("button", { name: "Collapse Scratch" })).toBeNull();
    expect(screen.getByRole("treeitem", { name: /New conversation/ })).toBeVisible();
    const row = screen.getByRole("treeitem", {
      name: /Tighten the launch prompt/,
    });
    expect(row).toHaveTextContent("Tighten the launch prompt");
    expect(within(row).queryByLabelText(/waiting for your input/i)).toBeNull();
    expect(within(screen.getByRole("treeitem", { name: /New conversation/ }))
      .queryByTestId("scratch-run-chicklets")).toBeNull();

    fireEvent.click(row);

    const bucket = scratchBucketId("module-1");
    await waitFor(() => expect(row).toHaveAttribute("aria-selected", "true"));
    expect(useClientStore.getState().selectedTaskId).toBe(TEMP_TASK_ID);
    expect(useClientStore.getState().activeByTask[bucket]).toBe("session-2");
    expect(useClientStore.getState().workspaces[bucket]?.active).toBe("terminal");
  });

  it("starts one terminal conversation immediately with the global launch default", async () => {
    const tickets: Array<{
      __typename: "InstantRunTicket";
      agent_run_id: string;
      title: string;
      started_at: string;
    }> = [];
    const operations: Array<{ operationName: string; variables: unknown }> = [];
    const terminalExecutor = terminalSessionReadExecutor(emptyTerminalReads);
    installDesktopGraphQlRuntime(async (document, variables) => {
      const operationName = documentOperationName(document);
      operations.push({ operationName, variables });
      if (operationName === "InstantRunTickets") {
        return { tickets: [...tickets] } as never;
      }
      if (operationName === "CreateTerminalSession") {
        tickets.push({
          __typename: "InstantRunTicket",
          agent_run_id: "instant-run-new",
          title: "Untitled instant chat",
          started_at: "2026-08-30T12:00:00Z",
        });
        return {
          terminal_session: {
            __typename: "AgentTerminalSessions",
            agent_run_id: "instant-run-new",
            module_id: "module-1",
            scope: "instant",
            doc_rel_path: null,
            created_at: "2026-08-30T12:00:00Z",
            agent_run: {
              __typename: "AgentRuns",
              id: "instant-run-new",
              agent: "codex",
              launch_state: null,
              launch_model: "gpt-5.6",
            },
          },
        } as never;
      }
      if (operationName === "WorkTrackerModuleOpen") {
        return {
          module: { __typename: "WorktrackerIssueConnection", nodes: [] },
          work_items: { __typename: "WorktrackerIssueConnection", nodes: [] },
        } as never;
      }
      if (operationName === "LoadModuleLinks") {
        return {
          moduleLinks: {
            __typename: "ModuleLinksConnection",
            nodes: [{
              __typename: "ModuleLinks",
              id: "link-1",
              moduleId: "module-1",
              path: "/repos/ticketry",
            }],
          },
        } as never;
      }
      return terminalExecutor(document, variables);
    });
    seedModuleLinks([
      { id: "link-1", moduleId: "module-1", path: "/repos/ticketry" },
    ]);
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {},
      automationAttempts: {},
      automationByTask: {},
    });
    useClientStore.setState({
      selectedTaskId: null,
      workspaces: {},
      activeByTask: {},
    });

    render(
      <StudioApolloProvider>
        <TasksPane />
        <ModalHost />
      </StudioApolloProvider>,
    );

    fireEvent.click(await screen.findByRole("treeitem", { name: /New conversation/ }));
    const created = await screen.findByRole("treeitem", {
      name: /Untitled instant chat/,
    });
    await waitFor(() => expect(created).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByPlaceholderText(/Type a prompt/)).toBeNull();
    expect(screen.queryByText("Select Agent")).toBeNull();
    const create = operations.find(
      (operation) => operation.operationName === "CreateTerminalSession",
    );
    expect(create?.variables).toMatchObject({
      kind: "instant",
    });
    expect(create?.variables).not.toHaveProperty("prompt");
    expect(create?.variables).not.toHaveProperty("provider");
    expect(create?.variables).not.toHaveProperty("model");
    expect(create?.variables).not.toHaveProperty("reasoning");
  });

  it("shows only the terminal owned by the selected conversation row", async () => {
    const bucket = scratchBucketId("module-1");
    useClientStore.setState({
      selectedTaskId: TEMP_TASK_ID,
      workspaces: {
        [bucket]: { active: "terminal", activeDocId: null, closedDocIds: [] },
      },
      activeByTask: { [bucket]: "session-2" },
    });

    render(
      <StudioApolloProvider>
        <SelectedTicketContent
          bucket={bucket}
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Conversation details</div>}
          conversationRunId="instant-run-2"
        />
      </StudioApolloProvider>,
    );

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    expect(screen.queryByRole("tab", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "＋ Agent" })).toBeNull();
    expect(screen.getByRole("tab")).toHaveAccessibleName(/codex/i);
  });

  it("focuses the clicked conversation on the first click, not the remembered one", async () => {
    const bucket = scratchBucketId("module-1");
    localStorage.setItem(
      "studio.activeWorkspaceByBucket:v1",
      JSON.stringify({
        [bucket]: { kind: "terminal", agentRunId: "instant-run-1" },
      }),
    );
    useClientStore.setState({
      selectedTaskId: null,
      workspaces: {},
      activeByTask: {},
    });

    render(
      <StudioApolloProvider>
        <TasksPane />
        <ConversationWorkspaceHarness />
      </StudioApolloProvider>,
    );

    const row = await screen.findByRole("treeitem", {
      name: /Tighten the launch prompt/,
    });
    fireEvent.click(row);

    await waitFor(() =>
      expect(useClientStore.getState().workspaces[bucket]?.active).toBe("terminal"),
    );
    expect(useClientStore.getState().activeByTask[bucket]).toBe("session-2");
    expect(row).toHaveAttribute("aria-selected", "true");
  });
});

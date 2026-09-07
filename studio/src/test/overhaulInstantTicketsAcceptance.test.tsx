import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModalHost, useModalStore } from "../app/modal";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { SelectedTicket } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicket";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useSelectedInstantRunId } from "../app/shell/ticket-workspace/tasks/internal/instantRunTicketNavigation";
import {
  refreshTerminalHoldings,
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
    LazySelectedTicketTerminal: () => (
      <div data-testid="selected-conversation-terminal" tabIndex={0} />
    ),
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

  it("[overhaul-259] keeps safe conversation titles unless Codex returns an accepted name", async () => {
    const operations: Array<{ operationName: string; variables: unknown }> = [];
    let titleReads = 0;
    const terminalExecutor = terminalSessionReadExecutor(emptyTerminalReads);
    installDesktopGraphQlRuntime(async (document, variables) => {
      const operationName = documentOperationName(document);
      operations.push({ operationName, variables });
      if (operationName === "InstantRunTickets") {
        return {
          tickets: [{
            __typename: "InstantRunTicket",
            agent_run_id: "instant-run-2",
            title: "Safe launch title",
            started_at: "2026-08-30T11:00:00Z",
          }],
        } as never;
      }
      if (operationName === "InstantRunTicketTitle") {
        titleReads += 1;
        if (titleReads === 3) throw new Error("app-server unavailable");
        return {
          title: titleReads === 1 ? null : "Name the selected Codex thread",
        } as never;
      }
      if (operationName === "WorkTrackerModuleOpen") {
        return {
          module: { __typename: "WorktrackerIssueConnection", nodes: [] },
          work_items: { __typename: "WorktrackerIssueConnection", nodes: [] },
        } as never;
      }
      return terminalExecutor(document, variables);
    });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {
        "instant-run-2": {
          agent_run_id: "instant-run-2",
          project_id: "project-1",
          task_id: null,
          module_id: "module-1",
          agent: "claude",
          scope: "instant",
          state: "working",
          provider_session_id: "claude-thread-2",
          started_at: "2026-08-30T11:00:00Z",
          updated_at: "2026-08-30T11:00:00Z",
        },
      },
      automationAttempts: {},
      automationByTask: {},
    });

    const view = render(
      <StudioApolloProvider>
        <TasksPane />
        <SelectedTicket />
      </StudioApolloProvider>,
    );

    fireEvent.click(await screen.findByRole("treeitem", {
      name: /Safe launch title/,
    }));

    await waitFor(() => expect(screen.getByRole("treeitem", {
      name: /Safe launch title/,
    })).toHaveAttribute("aria-selected", "true"));
    expect(operations.filter(
      ({ operationName }) => operationName === "InstantRunTicketTitle",
    )).toEqual([]);

    act(() => {
      const status = useAgentStatusStore.getState();
      status.upsertRun({
        ...status.runs["instant-run-2"],
        agent: "codex",
        provider_session_id: "codex-thread-2",
        updated_at: "2026-08-30T11:00:01Z",
      });
    });

    await waitFor(() => expect(operations.filter(
      ({ operationName }) => operationName === "InstantRunTicketTitle",
    )).toHaveLength(1));
    expect(screen.getAllByText("Safe launch title")).toHaveLength(3);

    act(() => {
      useClientStore.getState().setActive(scratchBucketId("module-1"), "details");
    });
    fireEvent.click(screen.getByRole("treeitem", { name: /Safe launch title/ }));

    await waitFor(() => {
      expect(operations.filter(
        ({ operationName }) => operationName === "InstantRunTicketTitle",
      )).toEqual([
        {
          operationName: "InstantRunTicketTitle",
          variables: { agentRunId: "instant-run-2" },
        },
        {
          operationName: "InstantRunTicketTitle",
          variables: { agentRunId: "instant-run-2" },
        },
      ]);
      expect(screen.getAllByText("Name the selected Codex thread")).toHaveLength(3);
    });
    expect(screen.getByTestId("details-or-terminal-pane-title")).toHaveAttribute(
      "data-title-casing",
      "preserve",
    );
    expect(JSON.stringify(localStorage)).not.toContain("Name the selected Codex thread");

    await act(refreshTerminalHoldings);
    expect(screen.getAllByText("Name the selected Codex thread")).toHaveLength(3);

    view.unmount();
    render(
      <StudioApolloProvider>
        <TasksPane />
        <SelectedTicket />
      </StudioApolloProvider>,
    );

    await waitFor(() => expect(operations.filter(
      ({ operationName }) => operationName === "InstantRunTicketTitle",
    )).toHaveLength(3));
    expect(screen.getAllByText("Name the selected Codex thread")).toHaveLength(3);
  });

  it("[overhaul-261] refreshes the settled Codex conversation on return and startup", async () => {
    const titleReads: string[] = [];
    let codexTitle = "Initial Codex name";
    let resolveRename!: () => void;
    const renamedResponse = new Promise<void>((resolve) => {
      resolveRename = resolve;
    });
    const terminalExecutor = terminalSessionReadExecutor(emptyTerminalReads);
    installDesktopGraphQlRuntime(async (document, variables) => {
      const operationName = documentOperationName(document);
      if (operationName === "InstantRunTickets") {
        return {
          tickets: [
            {
              __typename: "InstantRunTicket",
              agent_run_id: "instant-run-2",
              title: "Safe launch title",
              started_at: "2026-08-30T11:00:00Z",
            },
            {
              __typename: "InstantRunTicket",
              agent_run_id: "instant-run-1",
              title: "Other conversation",
              started_at: "2026-08-30T10:00:00Z",
            },
          ],
        } as never;
      }
      if (operationName === "InstantRunTicketTitle") {
        titleReads.push((variables as { agentRunId: string }).agentRunId);
        if (titleReads.length === 2) await renamedResponse;
        return { title: codexTitle } as never;
      }
      if (operationName === "WorkTrackerModuleOpen") {
        return {
          module: { __typename: "WorktrackerIssueConnection", nodes: [] },
          work_items: { __typename: "WorktrackerIssueConnection", nodes: [] },
        } as never;
      }
      return terminalExecutor(document, variables);
    });
    const view = render(
      <StudioApolloProvider>
        <TasksPane />
        <SelectedTicket />
      </StudioApolloProvider>,
    );
    const selected = await screen.findByRole("treeitem", {
      name: /Safe launch title/,
    });
    const other = screen.getByRole("treeitem", { name: /Other conversation/ });
    act(() => useAgentStatusStore.setState({
      projectId: "project-1",
      runs: Object.fromEntries(["1", "2"].map((suffix) => [
        `instant-run-${suffix}`,
        {
          agent_run_id: `instant-run-${suffix}`,
          project_id: "project-1",
          task_id: null,
          module_id: "module-1",
          agent: "codex",
          scope: "instant",
          state: "working",
          provider_session_id: `codex-thread-${suffix}`,
          started_at: `2026-08-30T1${suffix}:00:00Z`,
          updated_at: `2026-08-30T1${suffix}:00:00Z`,
        },
      ])),
      automationAttempts: {},
      automationByTask: {},
    }));

    fireEvent.click(selected);
    expect(titleReads).toEqual([]);
    await waitFor(() => expect(titleReads).toEqual(["instant-run-2"]));
    expect(screen.getAllByText("Initial Codex name")).toHaveLength(3);

    codexTitle = "Renamed in Codex";
    fireEvent.click(other);
    fireEvent.click(selected);
    fireEvent.click(other);
    fireEvent.click(selected);
    expect(titleReads).toEqual(["instant-run-2"]);
    await waitFor(() => expect(titleReads).toEqual([
      "instant-run-2",
      "instant-run-2",
    ]));
    fireEvent.click(other);
    fireEvent.click(selected);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(titleReads).toHaveLength(2);
    await act(async () => resolveRename());
    await waitFor(() => {
      expect(screen.getAllByText("Renamed in Codex")).toHaveLength(3);
    });

    document.dispatchEvent(new Event("visibilitychange"));
    screen.getByTestId("selected-conversation-terminal").focus();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(titleReads).toEqual(["instant-run-2", "instant-run-2"]);

    view.unmount();
    useClientStore.setState({
      selectedTaskId: TEMP_TASK_ID,
      workspaces: {},
      activeByTask: {},
    });
    expect(localStorage.getItem("studio.activeWorkspaceByBucket:v1"))
      .toContain("instant-run-2");

    render(
      <StudioApolloProvider>
        <TasksPane />
        <SelectedTicket />
      </StudioApolloProvider>,
    );
    await waitFor(() => expect(titleReads).toEqual([
      "instant-run-2",
      "instant-run-2",
      "instant-run-2",
    ]));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(titleReads).toHaveLength(3);
  });

  it("[CODING-1512] rereads the selected conversation's title when its run changes lifecycle state", async () => {
    const titleReads: string[] = [];
    let codexTitle: string | null = null;
    const terminalExecutor = terminalSessionReadExecutor(emptyTerminalReads);
    installDesktopGraphQlRuntime(async (document, variables) => {
      const operationName = documentOperationName(document);
      if (operationName === "InstantRunTickets") {
        return {
          tickets: [{
            __typename: "InstantRunTicket",
            agent_run_id: "instant-run-2",
            title: "Safe launch title",
            started_at: "2026-08-30T11:00:00Z",
          }],
        } as never;
      }
      if (operationName === "InstantRunTicketTitle") {
        titleReads.push((variables as { agentRunId: string }).agentRunId);
        return { title: codexTitle } as never;
      }
      if (operationName === "WorkTrackerModuleOpen") {
        return {
          module: { __typename: "WorktrackerIssueConnection", nodes: [] },
          work_items: { __typename: "WorktrackerIssueConnection", nodes: [] },
        } as never;
      }
      return terminalExecutor(document, variables);
    });
    const run = (state: "working" | "turn_complete" | "needs_input") => ({
      agent_run_id: "instant-run-2",
      project_id: "project-1",
      task_id: null,
      module_id: "module-1",
      agent: "codex",
      scope: "instant" as const,
      state,
      provider_session_id: "codex-thread-2",
      started_at: "2026-08-30T11:00:00Z",
      updated_at: `2026-08-30T11:0${state.length % 10}:00Z`,
    });
    render(
      <StudioApolloProvider>
        <TasksPane />
        <SelectedTicket />
      </StudioApolloProvider>,
    );
    const selected = await screen.findByRole("treeitem", {
      name: /Safe launch title/,
    });
    act(() => useAgentStatusStore.setState({
      projectId: "project-1",
      runs: { "instant-run-2": run("working") },
      automationAttempts: {},
      automationByTask: {},
    }));
    fireEvent.click(selected);
    await waitFor(() => expect(titleReads).toEqual(["instant-run-2"]));
    expect(screen.getAllByText("Safe launch title").length).toBeGreaterThan(0);

    // Codex names the thread during its first turn; the run settles afterwards.
    codexTitle = "Named by Codex after the first turn";
    act(() => useAgentStatusStore.setState({
      runs: { "instant-run-2": run("turn_complete") },
    }));
    await waitFor(() => expect(titleReads).toEqual([
      "instant-run-2",
      "instant-run-2",
    ]));
    await waitFor(() => {
      expect(screen.getAllByText("Named by Codex after the first turn").length)
        .toBeGreaterThan(0);
    });

    // A later turn may rename the thread; every settle rereads it.
    codexTitle = "Renamed on a later turn";
    act(() => useAgentStatusStore.setState({
      runs: { "instant-run-2": run("needs_input") },
    }));
    await waitFor(() => {
      expect(screen.getAllByText("Renamed on a later turn").length)
        .toBeGreaterThan(0);
    });
    expect(titleReads).toHaveLength(3);
  });

  it("waits for the selected conversation's Apollo cache row before reading its title", async () => {
    const operations: string[] = [];
    let resolveTickets!: (value: unknown) => void;
    const ticketsResponse = new Promise((resolve) => {
      resolveTickets = resolve;
    });
    const terminalExecutor = terminalSessionReadExecutor(emptyTerminalReads);
    installDesktopGraphQlRuntime(async (document, variables) => {
      const operationName = documentOperationName(document);
      operations.push(operationName);
      if (operationName === "InstantRunTickets") {
        return (await ticketsResponse) as never;
      }
      if (operationName === "InstantRunTicketTitle") {
        return { title: "Cached only after the row exists" } as never;
      }
      if (operationName === "WorkTrackerModuleOpen") {
        return {
          module: { __typename: "WorktrackerIssueConnection", nodes: [] },
          work_items: { __typename: "WorktrackerIssueConnection", nodes: [] },
        } as never;
      }
      return terminalExecutor(document, variables);
    });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {
        "instant-run-2": {
          agent_run_id: "instant-run-2",
          project_id: "project-1",
          task_id: null,
          module_id: "module-1",
          agent: "codex",
          scope: "instant",
          state: "working",
          provider_session_id: "codex-thread-2",
          started_at: "2026-08-30T11:00:00Z",
          updated_at: "2026-08-30T11:00:01Z",
        },
      },
      automationAttempts: {},
      automationByTask: {},
    });
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
        <TasksPane />
        <SelectedTicket />
      </StudioApolloProvider>,
    );

    await waitFor(() => expect(operations).toContain("InstantRunTickets"));
    expect(operations).not.toContain("InstantRunTicketTitle");

    await act(async () => resolveTickets({
      tickets: [{
        __typename: "InstantRunTicket",
        agent_run_id: "instant-run-2",
        title: "Safe launch title",
        started_at: "2026-08-30T11:00:00Z",
      }],
    }));

    await waitFor(() => {
      expect(operations.filter(
        (operationName) => operationName === "InstantRunTicketTitle",
      )).toHaveLength(1);
      expect(screen.getAllByText("Cached only after the row exists")).toHaveLength(3);
    });
  });

  it("[overhaul-282] titles a selected instant conversation whose run already left the live holding", async () => {
    const titleReads: string[] = [];
    installDesktopGraphQlRuntime(async (document, variables) => {
      const operationName = documentOperationName(document);
      if (operationName === "InstantRunTickets") {
        return {
          tickets: [{
            __typename: "InstantRunTicket",
            agent_run_id: "instant-run-2",
            title: "Safe launch title",
            started_at: "2026-08-30T11:00:00Z",
          }],
        } as never;
      }
      if (operationName === "InstantRunTicketTitle") {
        titleReads.push((variables as { agentRunId: string }).agentRunId);
        return { title: "Ended Codex thread name" } as never;
      }
      if (operationName === "WorkTrackerModuleOpen") {
        // The module read and the ended-runs read address the same
        // `worktrackerIssue` root field, so the module has to come back the way
        // the host returns it or the ended runs are read off an empty list.
        return {
          module: {
            __typename: "WorktrackerIssueConnection",
            nodes: [{
              __typename: "WorktrackerIssue",
              id: "module-1",
              name: "Ticketry",
              project_id: "project-1",
              sequence_id: 1,
              is_archived: false,
              issue_type: "module-type",
              rank: "0",
              project: {
                __typename: "WorktrackerProject",
                id: "project-1",
                slug: "ticketry",
              },
            }],
          },
          work_items: { __typename: "WorktrackerIssueConnection", nodes: [] },
        } as never;
      }
      return terminalSessionReadExecutor({
        ...emptyTerminalReads,
        readModuleScratchEndedRuns: async () => [{
          agent_run_id: "instant-run-2",
          agent: "codex",
          scope: "instant",
          provider_session_id: "codex-thread-2",
          started_at: "2026-08-30T11:00:00Z",
          ended_at: "2026-08-30T11:30:00Z",
          terminated_at: null,
        }],
      })(document, variables);
    });
    // The live-only snapshot no longer holds the ended run (overhaul-278).
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {},
      automationAttempts: {},
      automationByTask: {},
    });

    render(
      <StudioApolloProvider>
        <TasksPane />
        <SelectedTicket />
      </StudioApolloProvider>,
    );

    fireEvent.click(await screen.findByRole("treeitem", {
      name: /Safe launch title/,
    }));

    await waitFor(() => expect(titleReads).toEqual(["instant-run-2"]));
    await waitFor(() => expect(
      screen.getByTestId("details-or-terminal-pane-title"),
    ).toHaveTextContent("Ended Codex thread name"));
  });

  it("[overhaul-264] refreshes the selected Codex conversation after its title reader restarts", async () => {
    let titleReads = 0;
    let publishRestart: (() => void) | undefined;
    const terminalExecutor = terminalSessionReadExecutor(emptyTerminalReads);
    installDesktopGraphQlRuntime(
      async (document, variables) => {
        const operationName = documentOperationName(document);
        if (operationName === "InstantRunTickets") {
          return {
            tickets: [{
              __typename: "InstantRunTicket",
              agent_run_id: "instant-run-2",
              title: "Safe launch title",
              started_at: "2026-08-30T11:00:00Z",
            }],
          } as never;
        }
        if (operationName === "InstantRunTicketTitle") {
          titleReads += 1;
          return {
            title: titleReads === 1 ? null : "Recovered Codex title",
          } as never;
        }
        if (operationName === "WorkTrackerModuleOpen") {
          return {
            module: { __typename: "WorktrackerIssueConnection", nodes: [] },
            work_items: { __typename: "WorktrackerIssueConnection", nodes: [] },
          } as never;
        }
        return terminalExecutor(document, variables);
      },
      (operation, next) => {
        if (operation.operationName !== "InstantRunTicketTitleRestarted") return;
        publishRestart = () => next({ instant_run_ticket_title_restarted: true });
      },
    );
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {
        "instant-run-2": {
          agent_run_id: "instant-run-2",
          project_id: "project-1",
          task_id: null,
          module_id: "module-1",
          agent: "codex",
          scope: "instant",
          state: "working",
          provider_session_id: "codex-thread-2",
          started_at: "2026-08-30T11:00:00Z",
          updated_at: "2026-08-30T11:00:01Z",
        },
      },
      automationAttempts: {},
      automationByTask: {},
    });

    render(
      <StudioApolloProvider>
        <TasksPane />
        <SelectedTicket />
      </StudioApolloProvider>,
    );
    fireEvent.click(await screen.findByRole("treeitem", {
      name: /Safe launch title/,
    }));

    await waitFor(() => {
      expect(titleReads).toBe(1);
      expect(publishRestart).toBeTypeOf("function");
    });
    expect(screen.getAllByText("Safe launch title")).toHaveLength(3);

    act(() => publishRestart?.());
    await new Promise((resolve) => setTimeout(resolve, 25));
    act(() => publishRestart?.());
    await new Promise((resolve) => setTimeout(resolve, 25));
    act(() => publishRestart?.());

    expect(titleReads).toBe(1);

    await waitFor(() => {
      expect(screen.getAllByText("Recovered Codex title")).toHaveLength(3);
    });
    expect(titleReads).toBe(2);
  });
});

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { gql } from "@apollo/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicket } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicket";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { applyRunStatusFrame } from "../features/agents/status/stream/runStatusHolding";
import { lifecycleStatusFrame, statusRunHolding } from "../features/agents/status/testing/durableStatusFrames";
import { refreshTerminalHoldings, scratchBucketId, useTerminalStore, type SessionMeta } from "../features/agents/terminal";
import { registerTerminalFocus } from "../features/agents/terminal/internal/terminalRegistry";
import { TEMP_TASK_ID } from "../features/agents/types";
import { useModulePullRequestState } from "../features/agents/worktrees/changes/modulePullRequestState";
import { seedModuleLinks } from "../features/module-links";
import { useStudioStore } from "../features/projects/store";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { studioApolloClient } from "../shared/apollo/client";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime, terminalSessionReadExecutor, type RecordedGraphQlOperation } from "./desktopGraphQlRuntime";
import { seedModuleOpenFixture } from "./projectOpenFixture";

const ORIGINAL_TITLE = "Tighten the launch prompt";
const OTHER_TITLE = "Itemize temporary chats";
const PROVIDER_TITLE = "Terminal Issue Investigation";
const bucket = scratchBucketId("module-1");

vi.mock("../features/task-workspace/terminals/selectedTicketTerminalLoader", () => ({
  loadSelectedTicketTerminal: async () => {},
  LazySelectedTicketTerminal: () => <div data-testid="selected-conversation-terminal" tabIndex={0} />,
}));
vi.mock("../app/shell/ticket-workspace/selected-ticket/details/SelectedTicketDetails", () => ({
  SelectedTicketDetails: () => <div>Selected work item details</div>,
}));

function instantSession(runId: string): SessionMeta {
  return {
    sessionId: `session-${runId}`,
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

describe("overhaul acceptance — instant conversation rename", () => {
  let operations: RecordedGraphQlOperation[];
  let failNextSave: boolean;
  let savedTitle: string;
  let userTitle: string | null;
  let providerTitle: string | null;
  let titleReadGate: Promise<void> | null;
  let saveGate: Promise<void> | null;
  let ticketReadGate: Promise<void> | null;
  let ticketSnapshotGate: Promise<void> | null;
  let ticketSnapshotCaptured: (() => void) | null;

  beforeEach(() => {
    failNextSave = false;
    savedTitle = ORIGINAL_TITLE;
    userTitle = null;
    providerTitle = PROVIDER_TITLE;
    titleReadGate = null;
    saveGate = null;
    ticketReadGate = null;
    ticketSnapshotGate = null;
    ticketSnapshotCaptured = null;
    const terminalReads = terminalSessionReadExecutor({
      readTaskTerminalSessions: async () => [],
      readScratchTerminalSessions: async () => [],
      readTaskResumableTerminalSessions: async () => [],
      readScratchResumableTerminalSessions: async () => [],
    });
    operations = installDesktopGraphQlRuntime(async (document, variables) => {
      const operation = documentOperationName(document);
      if (operation === "InstantRunTickets") {
        await ticketSnapshotGate;
        const response = {
          tickets: [
            {
              __typename: "InstantRunTicket",
              agent_run_id: "run-1",
              title: savedTitle,
              user_title: userTitle,
              started_at: "2026-08-30T11:00:00Z",
            },
            {
              __typename: "InstantRunTicket",
              agent_run_id: "run-2",
              title: OTHER_TITLE,
              user_title: null,
              started_at: "2026-08-30T10:00:00Z",
            },
          ],
        };
        ticketSnapshotCaptured?.();
        await ticketReadGate;
        return response as never;
      }
      if (operation === "InstantRunTicketTitle") {
        const response = { title: providerTitle };
        await titleReadGate;
        return response as never;
      }
      if (operation === "UpdateInstantConversationTitle") {
        const input = variables as { agentRunId: string; title: string };
        if (failNextSave) {
          failNextSave = false;
          throw new Error("Rename unavailable");
        }
        await saveGate;
        expect(input.agentRunId).toBe("run-1");
        savedTitle = userTitle = input.title;
        return { run: { __typename: "AgentRuns", id: input.agentRunId, conversationTitle: input.title } } as never;
      }
      if (operation === "WorkTrackerModuleOpen") {
        return {
          module: { __typename: "WorktrackerIssueConnection", nodes: [] },
          work_items: { __typename: "WorktrackerIssueConnection", nodes: [] },
        } as never;
      }
      return terminalReads(document, variables);
    });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: TEMP_TASK_ID,
      workspaceSelection: { kind: "task" },
      storySearchQuery: "",
      focusedPane: "tasks",
      sidebarVisible: true,
      collapsedStateIds: new Set(),
      workspaces: {
        [bucket]: { active: "details", activeDocId: null, closedDocIds: [] },
      },
      activeByTask: {},
    });
    useTerminalStore.setState({
      sessions: {
        "session-run-1": instantSession("run-1"),
        "session-run-2": instantSession("run-2"),
      },
      sessionByRun: { "run-1": "session-run-1", "run-2": "session-run-2" },
    });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: Object.fromEntries(["run-1", "run-2"].map((id) => [id, {
        agent_run_id: id,
        project_id: "project-1",
        task_id: null,
        module_id: "module-1",
        agent: "codex",
        scope: "instant",
        state: "working",
        started_at: "2026-08-30T10:00:00Z",
        updated_at: "2026-08-30T10:00:00Z",
      }])),
      automationAttempts: {},
      automationByTask: {},
    });
    seedModuleOpenFixture("module-1", []);
    seedModuleLinks([{ id: "link-1", moduleId: "module-1", path: "/repos/ticketry" }]);
    useModulePullRequestState.setState({ urls: {} });
  });

  async function showConversations(selectedTicket = false) {
    const view = render(<StudioApolloProvider><TasksPane />{selectedTicket ? <SelectedTicket /> : null}</StudioApolloProvider>);
    const row = await screen.findByRole("treeitem", { name: new RegExp(ORIGINAL_TITLE) });
    const otherRow = screen.getByRole("treeitem", { name: new RegExp(OTHER_TITLE) });
    return { row, otherRow, view };
  }

  async function editSelectedTitle(row: HTMLElement) {
    fireEvent.click(within(row).getByText(savedTitle));
    await waitFor(() => expect(row).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(within(row).getByText(savedTitle));
    return screen.findByRole("textbox", { name: "Conversation title" });
  }

  function saveOperations() {
    return operations.filter(({ operationName }) => operationName === "UpdateInstantConversationTitle");
  }

  it("[overhaul-467] selects on the first title click and edits only the selected conversation on the next click", async () => {
    const { row, otherRow } = await showConversations();
    fireEvent.click(within(row).getByText(ORIGINAL_TITLE));
    await waitFor(() => expect(row).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByRole("textbox", { name: "Conversation title" })).toBeNull();
    expect(useClientStore.getState().activeByTask[bucket]).toBe("session-run-1");

    fireEvent.click(within(row).getByText(ORIGINAL_TITLE));
    const input = await screen.findByRole("textbox", { name: "Conversation title" });
    expect(input).toHaveValue(ORIGINAL_TITLE);
    expect(input).toHaveFocus();
    expect(otherRow).toHaveTextContent(OTHER_TITLE);
    expect(within(otherRow).queryByRole("textbox")).toBeNull();
    expect(saveOperations()).toHaveLength(0);
  });

  it("[overhaul-468] saves trimmed titles with Enter and blur while preserving both conversation sessions", async () => {
    const { row, otherRow } = await showConversations();
    const input = await editSelectedTitle(row);
    const sessions = structuredClone(useTerminalStore.getState().sessions);
    const runs = structuredClone(useAgentStatusStore.getState().runs);
    fireEvent.change(input, { target: { value: "  Review launch behavior  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(row).toHaveTextContent("Review launch behavior"));
    expect(screen.queryByRole("textbox", { name: "Conversation title" })).toBeNull();
    expect(saveOperations()).toHaveLength(1);
    expect(saveOperations()[0].variables).toEqual({ agentRunId: "run-1", title: "Review launch behavior" });

    fireEvent.click(within(row).getByText("Review launch behavior"));
    const nextInput = await screen.findByRole("textbox", { name: "Conversation title" });
    fireEvent.change(nextInput, { target: { value: "  Launch review  " } });
    fireEvent.blur(nextInput);
    await waitFor(() => expect(row).toHaveTextContent("Launch review"));
    expect(savedTitle).toBe("Launch review");
    expect(saveOperations()).toHaveLength(2);
    expect(otherRow).toHaveTextContent(OTHER_TITLE);
    expect(useTerminalStore.getState().sessions).toEqual(sessions);
    expect(useTerminalStore.getState().sessionByRun).toEqual({ "run-1": "session-run-1", "run-2": "session-run-2" });
    expect(useAgentStatusStore.getState().runs).toEqual(runs);
    expect(useClientStore.getState().activeByTask[bucket]).toBe("session-run-1");
  });

  it("[overhaul-469] cancels an edited title with Escape without saving or changing selection", async () => {
    const { row } = await showConversations();
    const input = await editSelectedTitle(row);
    fireEvent.change(input, { target: { value: "Discard this draft" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Conversation title" })).toBeNull());
    expect(row).toHaveTextContent(ORIGINAL_TITLE);
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(useClientStore.getState().activeByTask[bucket]).toBe("session-run-1");
    expect(saveOperations()).toHaveLength(0);
  });

  it("[overhaul-470] rejects a blank title locally and keeps the draft editable", async () => {
    const { row } = await showConversations();
    const input = await editSelectedTitle(row);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent(/title|required|empty/i);
    expect(input).toHaveValue("   ");
    expect(savedTitle).toBe(ORIGINAL_TITLE);
    expect(saveOperations()).toHaveLength(0);
  });

  it("[overhaul-471] retains a failed rename draft and allows retry without renaming another row", async () => {
    const { row, otherRow } = await showConversations();
    const input = await editSelectedTitle(row);
    failNextSave = true;
    fireEvent.change(input, { target: { value: "Launch review" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent(/save|rename|failed|unavailable/i);
    expect(input).toHaveValue("Launch review");
    expect(savedTitle).toBe(ORIGINAL_TITLE);
    expect(otherRow).toHaveTextContent(OTHER_TITLE);

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(row).toHaveTextContent("Launch review"));
    expect(screen.queryByRole("textbox", { name: "Conversation title" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(saveOperations()).toHaveLength(2);
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(otherRow).toHaveTextContent(OTHER_TITLE);
  });

  it("[overhaul-472] keeps editor focus and selection through clicks, arrow keys and composing Enter", async () => {
    const { row, otherRow } = await showConversations();
    const focusTerminal = vi.fn();
    const releaseFocus = registerTerminalFocus("session-run-1", focusTerminal);
    try {
      const input = await editSelectedTitle(row);
      focusTerminal.mockClear();
      fireEvent.click(input);
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowUp" });
      fireEvent.change(input, { target: { value: "Composing title" } });
      fireEvent.keyDown(input, { key: "Enter", isComposing: true });
      expect(input).toHaveFocus();
      expect(row).toHaveAttribute("aria-selected", "true");
      expect(otherRow).toHaveAttribute("aria-selected", "false");
      expect(useClientStore.getState().activeByTask[bucket]).toBe("session-run-1");
      expect(focusTerminal).not.toHaveBeenCalled();
      expect(saveOperations()).toHaveLength(0);
    } finally {
      releaseFocus();
    }
  });

  it("[overhaul-473] keeps the saved title across older provider responses, refetch and reopening the workspace", async () => {
    let releaseTitleRead!: () => void;
    titleReadGate = new Promise<void>((resolve) => { releaseTitleRead = resolve; });
    const { row, otherRow, view } = await showConversations(true);
    act(() => {
      const state = useAgentStatusStore.getState();
      useAgentStatusStore.setState({
        runs: { ...state.runs, "run-1": { ...state.runs["run-1"], provider_session_id: "codex-thread-1" } },
      });
    });
    const input = await editSelectedTitle(row);
    await waitFor(() => expect(operations.some(({ operationName }) => operationName === "InstantRunTicketTitle")).toBe(true));
    act(() => studioApolloClient().cache.writeFragment({
      id: studioApolloClient().cache.identify({ __typename: "InstantRunTicket", agent_run_id: "run-1" }),
      fragment: gql`fragment EarlierConversationTitle on InstantRunTicket { acceptedTitle @client }`,
      data: { acceptedTitle: "Previously accepted provider title" },
    }));
    fireEvent.change(input, { target: { value: "My conversation title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(row).toHaveTextContent("My conversation title"));
    expect(screen.getAllByText("My conversation title").length).toBeGreaterThan(1);
    act(() => applyRunStatusFrame(lifecycleStatusFrame({
      projectId: "project-1",
      agentRunId: "run-1",
      state: "turn_complete",
      at: "2026-08-30T12:00:00Z",
    })));
    await act(async () => { releaseTitleRead(); });
    await waitFor(() => expect(operations.filter(
      ({ operationName }) => operationName === "InstantRunTicketTitle",
    )).toHaveLength(2));
    expect(row).toHaveTextContent("My conversation title");
    await act(async () => refreshTerminalHoldings());
    expect(row).toHaveTextContent("My conversation title");
    expect(screen.queryByText("Terminal Issue Investigation")).toBeNull();
    expect(otherRow).toHaveTextContent(OTHER_TITLE);
    view.unmount();
    render(<StudioApolloProvider><TasksPane /><SelectedTicket /></StudioApolloProvider>);
    await waitFor(() => expect(screen.getAllByText("My conversation title").length).toBeGreaterThan(1));
  });

  it("[overhaul-474] saves a pending rename once and updates its original run after selecting another conversation", async () => {
    let releaseSave!: () => void;
    saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const { row, otherRow } = await showConversations();
    const input = await editSelectedTitle(row);
    fireEvent.change(input, { target: { value: "My conversation title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(saveOperations()).toHaveLength(1));
    fireEvent.click(within(otherRow).getByText(OTHER_TITLE));
    await waitFor(() => expect(otherRow).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(within(row).getByText(ORIGINAL_TITLE));
    await waitFor(() => expect(row).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(within(row).getByText(ORIGINAL_TITLE));
    expect(screen.queryByRole("textbox", { name: "Conversation title" })).toBeNull();
    expect(within(row).getByRole("button", { name: /Rename conversation/ })).toBeDisabled();
    fireEvent.click(within(otherRow).getByText(OTHER_TITLE));
    await act(async () => { releaseSave(); });
    await waitFor(() => expect(row).toHaveTextContent("My conversation title"));
    expect(saveOperations()).toHaveLength(1);
    expect(saveOperations()[0].variables).toEqual({ agentRunId: "run-1", title: "My conversation title" });
    expect(otherRow).toHaveTextContent(OTHER_TITLE);
    expect(otherRow).toHaveAttribute("aria-selected", "true");
    expect(useClientStore.getState().activeByTask[bucket]).toBe("session-run-2");
  });

  it("[overhaul-475] preserves a rename back to the original title across a delayed list response", async () => {
    userTitle = ORIGINAL_TITLE;
    const { row, otherRow } = await showConversations(true);
    const input = await editSelectedTitle(row);
    let releaseTicketSnapshot!: () => void;
    ticketSnapshotGate = new Promise<void>((resolve) => { releaseTicketSnapshot = resolve; });
    const snapshotCaptured = new Promise<void>((resolve) => { ticketSnapshotCaptured = resolve; });
    let releaseTicketRead!: () => void;
    ticketReadGate = new Promise<void>((resolve) => { releaseTicketRead = resolve; });
    const ticketsQuery = [...studioApolloClient().getObservableQueries("all")].find(
      ({ options }) => documentOperationName(options.query) === "InstantRunTickets",
    )!;
    let refetch!: Promise<unknown>;
    act(() => {
      refetch = studioApolloClient().query({
        query: ticketsQuery.options.query,
        variables: ticketsQuery.variables,
        fetchPolicy: "network-only",
      });
    });
    await waitFor(() => expect(operations.filter(({ operationName }) => operationName === "InstantRunTickets")).toHaveLength(2));
    fireEvent.change(input, { target: { value: "My conversation title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(savedTitle).toBe("My conversation title"));
    await waitFor(() => expect(screen.getAllByText("My conversation title").length).toBeGreaterThan(1));
    await act(async () => { releaseTicketSnapshot(); await snapshotCaptured; });

    fireEvent.click(within(row).getByText("My conversation title"));
    const nextInput = await screen.findByRole("textbox", { name: "Conversation title" });
    fireEvent.change(nextInput, { target: { value: ORIGINAL_TITLE } });
    fireEvent.keyDown(nextInput, { key: "Enter" });
    await waitFor(() => expect(savedTitle).toBe(ORIGINAL_TITLE));
    await waitFor(() => expect(screen.getAllByText(ORIGINAL_TITLE).length).toBeGreaterThan(1));
    await act(async () => { releaseTicketRead(); await refetch; });
    await waitFor(() => expect(row).toHaveTextContent(ORIGINAL_TITLE));
    expect(screen.getAllByText(ORIGINAL_TITLE).length).toBeGreaterThan(1);
    expect(screen.queryByText("My conversation title")).toBeNull();
    expect(otherRow).toHaveTextContent(OTHER_TITLE);
    expect(saveOperations()).toHaveLength(2);
  });

  it("[overhaul-596] cannot apply a delayed provider title to a different selected conversation", async () => {
    let releaseTitleRead!: () => void;
    titleReadGate = new Promise<void>((resolve) => { releaseTitleRead = resolve; });
    const { row, otherRow } = await showConversations(true);
    act(() => {
      const state = useAgentStatusStore.getState();
      useAgentStatusStore.setState({
        runs: { ...state.runs, "run-1": { ...state.runs["run-1"], provider_session_id: "codex-thread-1" } },
      });
    });
    const sessions = structuredClone(useTerminalStore.getState().sessions);
    const runs = structuredClone(useAgentStatusStore.getState().runs);
    fireEvent.click(row);
    await waitFor(() => expect(operations.filter(
      ({ operationName }) => operationName === "InstantRunTicketTitle",
    )).toHaveLength(1));
    fireEvent.click(otherRow);
    await waitFor(() => expect(otherRow).toHaveAttribute("aria-selected", "true"));
    await act(async () => { releaseTitleRead(); });
    expect(otherRow).toHaveTextContent(OTHER_TITLE);
    expect(screen.getByTestId("details-or-terminal-pane-title")).toHaveTextContent(OTHER_TITLE);
    expect(screen.queryByText("Terminal Issue Investigation")).toBeNull();

    fireEvent.click(row);
    await waitFor(() => expect(row).toHaveTextContent("Terminal Issue Investigation"));
    expect(screen.getByTestId("details-or-terminal-pane-title")).toHaveTextContent("Terminal Issue Investigation");
    expect(otherRow).toHaveTextContent(OTHER_TITLE);
    expect(operations.filter(({ operationName }) => operationName === "InstantRunTicketTitle").map(
      ({ variables }) => variables,
    )).toEqual([{ agentRunId: "run-1" }, { agentRunId: "run-1" }]);
    expect(saveOperations()).toHaveLength(0);
    expect(userTitle).toBeNull();
    expect(useTerminalStore.getState().sessions).toEqual(sessions);
    expect(useAgentStatusStore.getState().runs).toEqual(runs);
    expect(useClientStore.getState().activeByTask[bucket]).toBe("session-run-1");
  });

  it("[overhaul-597] reads the first request name when a lifecycle event captures the existing provider thread", async () => {
    const { row, otherRow } = await showConversations(true);
    const sessions = structuredClone(useTerminalStore.getState().sessions);
    const sessionByRun = structuredClone(useTerminalStore.getState().sessionByRun);
    fireEvent.click(row);
    await waitFor(() => expect(row).toHaveAttribute("aria-selected", "true"));
    expect(operations.filter(({ operationName }) => operationName === "InstantRunTicketTitle")).toHaveLength(0);

    const frame = lifecycleStatusFrame({
      projectId: "project-1",
      agentRunId: "run-1",
      state: "needs_input",
      at: "2026-08-30T12:00:00Z",
    });
    act(() => applyRunStatusFrame({
      ...frame,
      payload: {
        ...frame.payload,
        providerSessionCaptured: true,
        run: statusRunHolding({
          ...useAgentStatusStore.getState().runs["run-1"],
          provider_session_id: "codex-thread-1",
          state: "needs_input",
          updated_at: frame.committed_at,
        }),
      },
    }));

    await waitFor(() => expect(row).toHaveTextContent(PROVIDER_TITLE));
    expect(screen.getByTestId("details-or-terminal-pane-title")).toHaveTextContent(PROVIDER_TITLE);
    expect(otherRow).toHaveTextContent(OTHER_TITLE);
    expect(useAgentStatusStore.getState().runs["run-1"].provider_session_id).toBe("codex-thread-1");
    expect(operations.filter(({ operationName }) => operationName === "InstantRunTicketTitle").map(
      ({ variables }) => variables,
    )).toEqual([{ agentRunId: "run-1" }]);
    expect(saveOperations()).toHaveLength(0);
    expect(userTitle).toBeNull();
    expect(useTerminalStore.getState().sessions).toEqual(sessions);
    expect(useTerminalStore.getState().sessionByRun).toEqual(sessionByRun);
    expect(useClientStore.getState().activeByTask[bucket]).toBe("session-run-1");
  });

  it("[overhaul-620] shows the first request name after reselecting before an earlier neutral read settles", async () => {
    providerTitle = null;
    let releaseTitleRead!: () => void;
    titleReadGate = new Promise<void>((resolve) => { releaseTitleRead = resolve; });
    act(() => {
      const { runs } = useAgentStatusStore.getState();
      useAgentStatusStore.setState({
        runs: {
          ...runs,
          "run-1": { ...runs["run-1"], provider_session_id: "codex-thread-1" },
          "run-2": { ...runs["run-2"], state: "turn_complete" },
        },
      });
    });
    const { row, otherRow } = await showConversations(true);
    const sessions = structuredClone(useTerminalStore.getState().sessions);
    const sessionByRun = structuredClone(useTerminalStore.getState().sessionByRun);
    fireEvent.click(row);
    await waitFor(() => expect(operations.filter(
      ({ operationName }) => operationName === "InstantRunTicketTitle",
    )).toHaveLength(1));
    fireEvent.click(otherRow);
    await waitFor(() => expect(otherRow).toHaveAttribute("aria-selected", "true"));

    // Codex names A's first substantive request while B remains selected.
    providerTitle = PROVIDER_TITLE;
    act(() => applyRunStatusFrame(lifecycleStatusFrame({
      projectId: "project-1",
      agentRunId: "run-1",
      state: "turn_complete",
      at: "2026-08-30T12:00:00Z",
    })));
    const runs = structuredClone(useAgentStatusStore.getState().runs);
    expect(screen.getByTestId("details-or-terminal-pane-title")).toHaveTextContent(OTHER_TITLE);
    fireEvent.click(row);
    await waitFor(() => expect(row).toHaveAttribute("aria-selected", "true"));
    // Let the debounced reselection read meet A's still-pending neutral snapshot.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    expect(row).toHaveTextContent(ORIGINAL_TITLE);
    expect(screen.getByTestId("details-or-terminal-pane-title")).toHaveTextContent(ORIGINAL_TITLE);
    await act(async () => { releaseTitleRead(); });

    await waitFor(() => expect(row).toHaveTextContent(PROVIDER_TITLE));
    expect(screen.getByTestId("details-or-terminal-pane-title")).toHaveTextContent(PROVIDER_TITLE);
    expect(otherRow).toHaveTextContent(OTHER_TITLE);
    expect(operations.filter(({ operationName }) => operationName === "InstantRunTicketTitle").map(
      ({ variables }) => variables,
    )).toEqual([{ agentRunId: "run-1" }, { agentRunId: "run-1" }]);
    expect(saveOperations()).toHaveLength(0);
    expect(userTitle).toBeNull();
    expect(useTerminalStore.getState().sessions).toEqual(sessions);
    expect(useTerminalStore.getState().sessionByRun).toEqual(sessionByRun);
    expect(useAgentStatusStore.getState().runs).toEqual(runs);
    expect(useClientStore.getState().activeByTask[bucket]).toBe("session-run-1");
  });
});

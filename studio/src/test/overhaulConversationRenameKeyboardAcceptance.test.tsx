import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { SelectedTicket } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicket";
import { TasksPane, type InstantRunRow } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { scratchBucketId, useTerminalStore } from "../features/agents/terminal";
import { registerTerminalFocus } from "../features/agents/terminal/internal/terminalRegistry";
import { TEMP_TASK_ID } from "../features/agents/types";
import { useModulePullRequestState } from "../features/agents/worktrees/changes/modulePullRequestState";
import { seedModuleLinks } from "../features/module-links";
import { useStudioStore } from "../features/projects/store";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime, terminalSessionReadExecutor } from "./desktopGraphQlRuntime";
import { seedModuleOpenFixture } from "./projectOpenFixture";

const rows: InstantRunRow[] = ["First conversation", "Second conversation"].map((name, index) => ({
  kind: "instant-run",
  runId: `run-${index + 1}`,
  moduleId: "module-1",
  name,
  startedAt: `2026-08-30T1${1 - index}:00:00Z`,
}));
const bucket = scratchBucketId("module-1");

vi.mock("../features/task-workspace/terminals/selectedTicketTerminalLoader", () => ({
  loadSelectedTicketTerminal: async () => {},
  LazySelectedTicketTerminal: () => <div data-testid="conversation-terminal" tabIndex={0} />,
}));
vi.mock("../app/shell/ticket-workspace/selected-ticket/details/SelectedTicketDetails", () => ({
  SelectedTicketDetails: () => <div>Selected work item details</div>,
}));

function KeymapHarness() {
  useGlobalKeymap(rows);
  return <><TasksPane /><SelectedTicket /><button>Keep reading</button></>;
}

describe("overhaul acceptance — conversation rename keyboard precedence", () => {
  let savedTitle: string;
  let saveGate: Promise<void> | null;

  beforeEach(() => {
    savedTitle = "First conversation";
    saveGate = null;
    const terminalReads = terminalSessionReadExecutor({
      readTaskTerminalSessions: async () => [],
      readScratchTerminalSessions: async () => [],
      readTaskResumableTerminalSessions: async () => [],
      readScratchResumableTerminalSessions: async () => [],
    });
    installDesktopGraphQlRuntime(async (document, variables) => {
      if (documentOperationName(document) === "UpdateInstantConversationTitle") {
        const { agentRunId, title } = variables as { agentRunId: string; title: string };
        await saveGate;
        savedTitle = title;
        return { run: { __typename: "AgentRuns", id: agentRunId, conversationTitle: title } } as never;
      }
      if (documentOperationName(document) === "WorkTrackerModuleOpen") {
        return {
          module: { __typename: "WorktrackerIssueConnection", nodes: [] },
          work_items: { __typename: "WorktrackerIssueConnection", nodes: [] },
        } as never;
      }
      if (documentOperationName(document) === "InstantRunTickets") {
        return { tickets: rows.map((row) => ({
          __typename: "InstantRunTicket",
          agent_run_id: row.runId,
          title: row.runId === "run-1" ? savedTitle : row.name,
          user_title: null,
          started_at: row.startedAt,
        })) } as never;
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
      editViewZone: "stories",
      editViewBodyEngaged: false,
      collapsedStateIds: new Set(),
      workspaces: { [bucket]: { active: "terminal", activeDocId: null, closedDocIds: [] } },
      activeByTask: {},
    });
    useTerminalStore.setState({
      sessions: Object.fromEntries(rows.map((row) => [`session-${row.runId}`, {
        sessionId: `session-${row.runId}`,
        taskId: null,
        projectId: "project-1",
        moduleId: "module-1",
        agent: "codex",
        status: "ready",
        transport: "ready",
        isPlanning: false,
        isInstant: true,
        initialPrompt: null,
        agentRunId: row.runId,
      }])),
      sessionByRun: { "run-1": "session-run-1", "run-2": "session-run-2" },
    });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: Object.fromEntries(rows.map((row) => [row.runId, {
        agent_run_id: row.runId,
        project_id: "project-1",
        task_id: null,
        module_id: "module-1",
        agent: "codex",
        scope: "instant",
        state: "working",
        started_at: row.startedAt,
        updated_at: row.startedAt,
      }])),
      automationAttempts: {},
      automationByTask: {},
    });
    seedModuleOpenFixture("module-1", []);
    seedModuleLinks([{ id: "link-1", moduleId: "module-1", path: "/repos/ticketry" }]);
    useModulePullRequestState.setState({ urls: {} });
  });

  async function showConversations(sidebarVisible: boolean) {
    useClientStore.setState({ sidebarVisible });
    render(<StudioApolloProvider><KeymapHarness /></StudioApolloProvider>);
    const row = await screen.findByRole("treeitem", { name: /First conversation/ });
    const otherRow = screen.getByRole("treeitem", { name: /Second conversation/ });
    fireEvent.click(within(row).getByText("First conversation"));
    await waitFor(() => expect(row).toHaveAttribute("aria-selected", "true"));
    return { row, otherRow };
  }

  async function activateRename(button: HTMLElement) {
    act(() => button.focus());
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    fireEvent(button, enter);
    expect(enter.defaultPrevented).toBe(false);
    fireEvent.keyUp(button, { key: "Enter" });
    // jsdom needs the native button activation simulated after keymap precedence is checked.
    fireEvent.click(button);
    const input = await screen.findByRole("textbox", { name: "Conversation title" });
    expect(input).toHaveFocus();
    return input;
  }

  it.each([
    { sidebarVisible: true, completion: "Escape" },
    { sidebarVisible: false, completion: "Escape" },
    { sidebarVisible: true, completion: "unchanged Enter" },
    { sidebarVisible: false, completion: "unchanged Enter" },
    { sidebarVisible: true, completion: "save Enter" },
    { sidebarVisible: false, completion: "save Enter" },
  ])("[overhaul-567] restores rename focus after $completion and permits the next activation (sidebar: $sidebarVisible)", async ({ sidebarVisible, completion }) => {
    const { row } = await showConversations(sidebarVisible);
    const input = await activateRename(within(row).getByRole("button", { name: "Rename conversation: First conversation" }));
    if (completion === "Escape") fireEvent.change(input, { target: { value: "Discard this draft" } });
    if (completion === "save Enter") fireEvent.change(input, { target: { value: "Renamed conversation" } });
    fireEvent.keyDown(input, { key: completion === "Escape" ? "Escape" : "Enter" });
    const expectedTitle = completion === "save Enter" ? "Renamed conversation" : "First conversation";
    const button = await within(row).findByRole("button", { name: `Rename conversation: ${expectedTitle}` });
    expect(button).toHaveFocus();
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(await activateRename(button)).toHaveValue(expectedTitle);
    expect(useClientStore.getState().editViewZone).toBe("stories");
  });

  it.each([true, false].flatMap((sidebarVisible) => [
    { sidebarVisible, departure: "blur save" },
    { sidebarVisible, departure: "unchanged blur" },
    { sidebarVisible, departure: "pending blur" },
    { sidebarVisible, departure: "pending blur and refocus" },
    { sidebarVisible, departure: "selection change" },
    { sidebarVisible, departure: "selection change and return" },
  ]))("[overhaul-568] preserves focus after $departure (sidebar: $sidebarVisible)", async ({ sidebarVisible, departure }) => {
    let finishSave!: () => void;
    saveGate = new Promise<void>((resolve) => { finishSave = resolve; });
    const { row, otherRow } = await showConversations(sidebarVisible);
    const input = await activateRename(within(row).getByRole("button", { name: "Rename conversation: First conversation" }));
    if (departure !== "unchanged blur") fireEvent.change(input, { target: { value: "Renamed conversation" } });
    if (departure !== "blur save" && departure !== "unchanged blur") fireEvent.keyDown(input, { key: "Enter" });
    if (departure.startsWith("selection change")) {
      fireEvent.click(within(otherRow).getByText("Second conversation"));
      await waitFor(() => expect(otherRow).toHaveAttribute("aria-selected", "true"));
      if (departure === "selection change and return") {
        fireEvent.click(within(row).getByText("First conversation"));
        await waitFor(() => expect(row).toHaveAttribute("aria-selected", "true"));
      }
    }
    const reading = screen.getByRole("button", { name: "Keep reading" });
    act(() => reading.focus());
    if (departure === "pending blur and refocus") act(() => input.focus());
    await act(async () => { finishSave(); });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Conversation title" })).toBeNull());
    expect(row).toHaveTextContent(departure === "unchanged blur" ? "First conversation" : "Renamed conversation");
    if (departure === "pending blur and refocus") {
      expect(document.body).toHaveFocus();
      expect(within(row).getByRole("button", { name: "Rename conversation: Renamed conversation" })).not.toHaveFocus();
    } else {
      expect(reading).toHaveFocus();
    }
  });

  it.each([
    { sidebarVisible: true, key: "Enter" },
    { sidebarVisible: false, key: "Enter" },
    { sidebarVisible: true, key: " " },
    { sidebarVisible: false, key: " " },
  ])("[overhaul-501] lets the focused rename button activate with $key (sidebar: $sidebarVisible)", async ({ sidebarVisible, key }) => {
    const { row, otherRow } = await showConversations(sidebarVisible);
    const button = within(row).getByRole("button", { name: "Rename conversation: First conversation" });
    const focusTerminal = vi.fn();
    const releaseFocus = registerTerminalFocus("session-run-1", focusTerminal);
    focusTerminal.mockClear(); // Discard the initial row selection's banked focus.
    try {
      act(() => button.focus());
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      fireEvent(button, event);
      expect(event.defaultPrevented).toBe(false);
      fireEvent.keyUp(button, { key });
      // jsdom does not implement the native button click generated by Enter/Space.
      // Dispatch it only after verifying that the real keymap allowed that default.
      if (!event.defaultPrevented) fireEvent.click(button);
      expect(await screen.findByRole("textbox", { name: "Conversation title" })).toHaveFocus();
      expect(row).toHaveAttribute("aria-selected", "true");
      expect(otherRow).toHaveAttribute("aria-selected", "false");
      expect(useClientStore.getState().activeByTask[bucket]).toBe("session-run-1");
      expect(useClientStore.getState().editViewZone).toBe("stories");
      expect(useClientStore.getState().editViewBodyEngaged).toBe(false);
      expect(focusTerminal).not.toHaveBeenCalled();
    } finally {
      releaseFocus();
    }
  });

  it.each([true, false])("[overhaul-502] retains row and terminal navigation outside rename (sidebar: %s)", async (sidebarVisible) => {
    const { row, otherRow } = await showConversations(sidebarVisible);
    const focusTerminal = vi.fn();
    const releaseFocus = registerTerminalFocus("session-run-2", focusTerminal);
    try {
      act(() => row.focus());
      fireEvent.keyDown(row, { key: "ArrowDown" });
      await waitFor(() => expect(otherRow).toHaveAttribute("aria-selected", "true"));
      expect(row).toHaveAttribute("aria-selected", "false");
      expect(useClientStore.getState().activeByTask[bucket]).toBe("session-run-2");
      expect(focusTerminal).not.toHaveBeenCalled();

      act(() => otherRow.focus());
      const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      fireEvent(otherRow, enter);
      expect(enter.defaultPrevented).toBe(true);
      expect(screen.queryByRole("textbox", { name: "Conversation title" })).toBeNull();
      expect(useClientStore.getState().editViewZone).toBe("active-tab-body");
      fireEvent.keyDown(document.activeElement!, { key: "Enter" });
      expect(useClientStore.getState().editViewBodyEngaged).toBe(true);
    } finally {
      releaseFocus();
    }
  });
});

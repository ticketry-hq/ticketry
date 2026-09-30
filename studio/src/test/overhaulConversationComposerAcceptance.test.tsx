import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ModalHost } from "../app/modal";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useTerminalStore } from "../features/agents/terminal";
import { TEMP_TASK_ID } from "../features/agents/types";
import { useConversationComposerStore } from "../features/conversations";
import { seedModuleLinks } from "../features/module-links";
import { useStudioStore } from "../features/projects/store";
import { CONVERSATIONS_SECTION_ID } from "../features/work-items";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import {
  installDesktopGraphQlRuntime,
  terminalSessionReadExecutor,
} from "./desktopGraphQlRuntime";

function ConversationKeymapHarness() {
  useGlobalKeymap([{ kind: "scratch", moduleId: "module-1" }]);
  return null;
}

let creates: Array<Record<string, unknown>> = [];

function installRuntime() {
  const tickets: Array<Record<string, string>> = [];
  const terminalExecutor = terminalSessionReadExecutor({
    readTaskTerminalSessions: async () => [],
    readScratchTerminalSessions: async () => [],
    readTaskResumableTerminalSessions: async () => [],
    readScratchResumableTerminalSessions: async () => [],
  });
  installDesktopGraphQlRuntime(async (document, variables) => {
    const operationName = documentOperationName(document);
    if (operationName === "InstantRunTickets") {
      return { tickets: [...tickets] } as never;
    }
    if (operationName === "CreateTerminalSession") {
      creates.push(variables as Record<string, unknown>);
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
            agent: "claude",
            launch_state: null,
            launch_model: null,
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
    return terminalExecutor(document, variables);
  });
}

function renderStories() {
  render(
    <StudioApolloProvider>
      <ConversationKeymapHarness />
      <TasksPane />
      <ModalHost />
    </StudioApolloProvider>,
  );
}

describe("overhaul acceptance — Conversation shortcuts and composer", () => {
  beforeEach(() => {
    creates = [];
    installRuntime();
    seedModuleLinks([
      { id: "link-1", moduleId: "module-1", path: "/repos/ticketry" },
    ]);
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {},
      automationAttempts: {},
      automationByTask: {},
    });
    useConversationComposerStore.setState({ open: false, draft: "" });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: TEMP_TASK_ID,
      sidebarVisible: false,
      editViewZone: "stories",
      workspaces: {},
      activeByTask: {},
      collapsedStateIds: new Set(),
    });
  });

  it("starts a default conversation immediately on Cmd+I", async () => {
    renderStories();
    await screen.findByRole("treeitem", { name: /New conversation/ });

    fireEvent.keyDown(window, { key: "i", metaKey: true });

    await screen.findByRole("treeitem", { name: /Untitled instant chat/ });
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ kind: "instant" });
    expect(creates[0]).not.toHaveProperty("prompt");
    expect(creates[0]).not.toHaveProperty("provider");
    expect(screen.queryByRole("textbox", {
      name: "First message for the new conversation",
    })).toBeNull();
  });

  it("opens the inline composer on Cmd+Shift+I and starts with its prompt", async () => {
    renderStories();
    await screen.findByRole("treeitem", { name: /New conversation/ });

    fireEvent.keyDown(window, { key: "I", metaKey: true, shiftKey: true });

    const message = await screen.findByRole("textbox", {
      name: "First message for the new conversation",
    });
    await waitFor(() => expect(message).toHaveFocus());
    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toBeDisabled();
    expect(creates).toHaveLength(0);

    fireEvent.change(message, { target: { value: "  Why does resize flicker?  " } });
    expect(start).toBeEnabled();
    fireEvent.keyDown(message, { key: "Enter", metaKey: true });

    await screen.findByRole("treeitem", { name: /Untitled instant chat/ });
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      kind: "instant",
      prompt: "Why does resize flicker?",
    });
    expect(creates[0]).not.toHaveProperty("provider");
    expect(screen.queryByRole("textbox", {
      name: "First message for the new conversation",
    })).toBeNull();
  });

  it("keeps a typed prompt when Escape closes the composer", async () => {
    renderStories();
    fireEvent.click(await screen.findByRole("button", {
      name: "Start a conversation with a prompt",
    }));
    const message = await screen.findByRole("textbox", {
      name: "First message for the new conversation",
    });
    fireEvent.change(message, { target: { value: "Draft question" } });
    fireEvent.keyDown(message, { key: "Escape" });
    await waitFor(() => expect(message).not.toBeInTheDocument());
    expect(creates).toHaveLength(0);

    fireEvent.keyDown(window, { key: "I", metaKey: true, shiftKey: true });
    expect(await screen.findByRole("textbox", {
      name: "First message for the new conversation",
    })).toHaveValue("Draft question");
  });

  it("collapses the Conversations section and reopens it for the composer", async () => {
    renderStories();
    fireEvent.click(await screen.findByRole("button", {
      name: "Collapse Conversations",
    }));

    await waitFor(() =>
      expect(screen.queryByRole("treeitem", { name: /New conversation/ }))
        .toBeNull()
    );
    expect(useClientStore.getState().collapsedStateIds.has(CONVERSATIONS_SECTION_ID))
      .toBe(true);
    expect(screen.getByRole("button", { name: "Expand Conversations" }))
      .toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(window, { key: "I", metaKey: true, shiftKey: true });
    await screen.findByRole("textbox", {
      name: "First message for the new conversation",
    });
    expect(screen.getByRole("treeitem", { name: /New conversation/ }))
      .toBeInTheDocument();
  });
});

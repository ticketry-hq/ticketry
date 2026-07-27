import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentPicker } from "../features/agents/terminal/AgentPicker";
import {
  docChatKey,
  scratchBucketId,
  useTerminalStore,
  useWorkspaceTabsStore,
} from "../features/agents/terminal";
import { useModalStore } from "../app/modal";
import { useIssueDrawerWorkspaceStore } from "../features/work-items/issue-detail";

describe("AgentPicker doc-chat mode (#625)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useTerminalStore.setState({
      sessions: {},
      persistedSessions: {},
      resumableSessions: {},
    });
    useWorkspaceTabsStore.setState({ byTaskId: {}, activeByTask: {}, chatByDoc: {} });
    useIssueDrawerWorkspaceStore.setState({ workspaces: {} });
    useModalStore.setState({ modalStack: [{ type: "agent-picker" }] });
  });

  it("commit opens a per-document doc-chat run + that doc's overlay, not a tab", () => {
    render(
      <AgentPicker
        payload={{ mode: "doc-chat", projectId: "proj-1", moduleId: "mod-1", taskId: "task-1", ticketSeq: 42, docRelPath: "spec/x/d.html", docId: "doc-1" }}
      />,
    );
    fireEvent.click(screen.getByText("claude"));

    const term = useTerminalStore.getState();
    const tabs = useWorkspaceTabsStore.getState();
    const sessionId = tabs.chatByDoc[docChatKey("task-1", "spec/x/d.html")];
    expect(sessionId).toBeTruthy();
    expect(term.sessions[sessionId]).toMatchObject({
      isDocChat: true,
      docRelPath: "spec/x/d.html",
      docId: "doc-1",
      agent: "claude",
      taskId: "task-1",
      ticketSeq: 42,
    });
    // Never a tab, never the ticket's run.
    expect(tabs.byTaskId["task-1"]).toBeUndefined();
    expect(tabs.activeByTask["task-1"]).toBeUndefined();
    // This document's overlay opened; modal dismissed.
    expect(
      useIssueDrawerWorkspaceStore.getState().workspaces["task-1"].overlayOpenByDoc["doc-1"],
    ).toBe(true);
    expect(useModalStore.getState().modalStack).toHaveLength(0);
  });

  it("bails without spawning when docId or docRelPath is missing", () => {
    render(<AgentPicker payload={{ mode: "doc-chat", projectId: "proj-1", moduleId: "mod-1", taskId: "task-1", docRelPath: "spec/x/d.html" }} />);
    fireEvent.click(screen.getByText("claude"));
    expect(Object.keys(useWorkspaceTabsStore.getState().chatByDoc)).toHaveLength(0);
    expect(useModalStore.getState().modalStack).toHaveLength(0);
  });
});

describe("AgentPicker plan mode — shared launcher path (CODIN-839)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useTerminalStore.setState({
      sessions: {},
      persistedSessions: {},
      resumableSessions: {},
    });
    useWorkspaceTabsStore.setState({ byTaskId: {}, activeByTask: {}, chatByDoc: {} });
    useIssueDrawerWorkspaceStore.setState({ workspaces: {} });
    useModalStore.setState({ modalStack: [{ type: "agent-picker" }] });
  });

  it("commit launches the scratch planning terminal with the fixed no-task contract", () => {
    render(<AgentPicker payload={{ mode: "plan", projectId: "proj-1", moduleId: "mod-1", initialPrompt: "plan the epic" }} />);
    fireEvent.click(screen.getByText("claude"));

    const term = useTerminalStore.getState();
    const scratchIds =
      useWorkspaceTabsStore.getState().byTaskId[scratchBucketId("mod-1")] ?? [];
    expect(scratchIds).toHaveLength(1);
    expect(term.sessions[scratchIds[0]]).toMatchObject({
      taskId: null,
      ticketSeq: null,
      moduleId: "mod-1",
      agent: "claude",
      initialPrompt: "plan the epic",
      isPlanning: true,
      isInstant: false,
    });
    expect(useModalStore.getState().modalStack).toHaveLength(0);
  });

  it("activates the scratch terminal workspace after launch", () => {
    render(<AgentPicker payload={{ mode: "plan", projectId: "proj-1", moduleId: "mod-1" }} />);
    fireEvent.click(screen.getByText("claude"));

    expect(
      useIssueDrawerWorkspaceStore.getState().workspaces[scratchBucketId("mod-1")]?.active,
    ).toBe("terminal");
  });
});

describe("AgentPicker instant mode — Studio instant-change (#925 Slice E)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useTerminalStore.setState({
      sessions: {},
      persistedSessions: {},
      resumableSessions: {},
    });
    useWorkspaceTabsStore.setState({ byTaskId: {}, activeByTask: {}, chatByDoc: {} });
    useIssueDrawerWorkspaceStore.setState({ workspaces: {} });
    useModalStore.setState({ modalStack: [{ type: "agent-picker" }] });
  });

  it("commit launches a no-task instant run bucketed under scratch (isInstant, not planning)", () => {
    render(
      <AgentPicker
        payload={{
          mode: "instant",
          projectId: "proj-1",
          moduleId: "mod-1",
          initialPrompt: "rename the button",
        }}
      />,
    );
    fireEvent.click(screen.getByText("claude"));

    const term = useTerminalStore.getState();
    const scratchIds =
      useWorkspaceTabsStore.getState().byTaskId[scratchBucketId("mod-1")] ?? [];
    expect(scratchIds).toHaveLength(1);
    expect(term.sessions[scratchIds[0]]).toMatchObject({
      taskId: null,
      ticketSeq: null,
      moduleId: "mod-1",
      agent: "claude",
      initialPrompt: "rename the button",
      isPlanning: false,
      isInstant: true,
    });
    expect(useModalStore.getState().modalStack).toHaveLength(0);
  });

  it("required-prompt guard: a blank prompt launches nothing", () => {
    render(
      <AgentPicker
        payload={{
          mode: "instant",
          projectId: "proj-1",
          moduleId: "mod-1",
          initialPrompt: "   ",
        }}
      />,
    );
    fireEvent.click(screen.getByText("claude"));

    expect(
      useWorkspaceTabsStore.getState().byTaskId[scratchBucketId("mod-1")],
    ).toBeUndefined();
    // Modal still dismissed — the guard bails cleanly, no dangling picker.
    expect(useModalStore.getState().modalStack).toHaveLength(0);
  });
});

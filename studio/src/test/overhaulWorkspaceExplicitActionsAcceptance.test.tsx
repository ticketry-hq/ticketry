import { installWorkspaceViewerTransport } from "./renderedTaskWorkspaceTerminalFixture";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskWorkspace } from "../features/task-workspace";
import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../shared/modal/modalStore";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { AGENT_RUN_ACTIONS, dispatchAgentRunAction } from "../features/agents/actions/agentRunActions";
import { useTerminalForegroundStore, useTerminalStore } from "../features/agents/terminal";
import { useStudioStore } from "../features/projects/store";
import { readStudioWorkspaceTarget, rememberStudioWorkspaceTarget } from "../features/workspace-state/studioWorkspaceTarget";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime, terminalSessionReadExecutor, type WorkItemEndedRunFixture } from "./desktopGraphQlRuntime";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

const absentWorktree = { worktree_status: {
  __typename: "WorktreeStatusView", kind: "none", task_id: "story-1", top_level_task_id: "story-1",
  is_shared: false, branch: null, base_branch: null, path: null, state: null,
  clean: null, dirty: null, ahead: null, behind: null, conflict: null, checkout_present: false,
  ephemeral: false, reason: null,
} };

describe("overhaul acceptance — explicit workspace actions outrank hydration", () => {
  beforeEach(() => {
    installWorkspaceViewerTransport();
    localStorage.clear();
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-1", selectedTaskId: "story-1",
      focusedPane: "tasks", sidebarVisible: true, editViewBodyEngaged: false,
      editViewZone: "stories", navigationModality: "pointer", workspaces: {}, activeByTask: {},
    });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useModalStore.setState({ modalStack: [] });
    useAgentStatusStore.setState({ projectId: "project-1", automationAttempts: {}, automationByTask: {}, runs: {} });
  });

  it("[overhaul-695] committing a task launch wins over an older remembered document response", async () => {
    const documentRead = deferred<unknown>();
    const launch = deferred<never>();
    const terminalReads = terminalSessionReadExecutor({
      readTaskTerminalSessions: async () => [], readScratchTerminalSessions: async () => [],
      readScratchResumableTerminalSessions: async () => [], readTaskResumableTerminalSessions: async () => [],
    });
    installDesktopGraphQlRuntime(async (document, variables) => {
      const operation = documentOperationName(document);
      if (operation === "WorktreeStatus") return absentWorktree as never;
      if (operation === "RefreshTaskDocumentRegistry") return await documentRead.promise as never;
      if (operation === "CreateTerminalSession") return launch.promise;
      return terminalReads(document, variables);
    });
    rememberStudioWorkspaceTarget("story-1", { kind: "doc", relPath: "DESIGN.html" });
    render(<><TaskWorkspace bucket="story-1" projectId="project-1" moduleId="module-1"
      launchContext={{ kind: "task", projectId: "project-1", moduleId: "module-1", taskId: "story-1" }}
      owner="studio" details={<div>Issue details</div>} /><ModalHost /></>);
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    fireEvent.click(await screen.findByText("codex", { selector: "li" }));
    const terminal = await screen.findByRole("tab", { name: "codex terminal" });
    expect(terminal).toHaveAttribute("aria-selected", "true");
    await act(async () => documentRead.resolve({ refresh_task_document_registry: [{
      __typename: "DesignDocuments", id: "design-1", relPath: "DESIGN.html", contentDigest: "digest-1",
    }] }));
    await screen.findByRole("tab", { name: "DESIGN" });
    expect(terminal).toHaveAttribute("aria-selected", "true");
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("[overhaul-694] keeps Details while resume is pending instead of applying older remembered document hydration", async () => {
    const documentRead = deferred<unknown>();
    const resume = deferred<never>();
    const terminalReads = terminalSessionReadExecutor({
      readTaskTerminalSessions: async () => [], readScratchTerminalSessions: async () => [],
      readScratchResumableTerminalSessions: async () => [],
      readTaskResumableTerminalSessions: async () => [{
        agent_run_id: "run-resumable", agent: "codex", status: "terminated", scope: "task",
        started_at: "2026-10-09T08:00:00Z", launch_state: "Implement", launch_model: null,
        provider_session_id: "provider-session-1", resumed_from: null,
      }],
    });
    const operations = installDesktopGraphQlRuntime(async (document, variables) => {
      const operation = documentOperationName(document);
      if (operation === "WorktreeStatus") return absentWorktree as never;
      if (operation === "RefreshTaskDocumentRegistry") return await documentRead.promise as never;
      if (operation === "ResumeTerminalSession") return resume.promise;
      return terminalReads(document, variables);
    });
    rememberStudioWorkspaceTarget("story-1", { kind: "doc", relPath: "DESIGN.html" });
    render(<TaskWorkspace bucket="story-1" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Issue details</div>} />);
    fireEvent.click(await screen.findByRole("button", { name: /Dormant tabs/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Resume Implement codex terminal" }));
    await waitFor(() => expect(operations.some((request) => request.operationName === "ResumeTerminalSession")).toBe(true));
    await act(async () => documentRead.resolve({ refresh_task_document_registry: [{
      __typename: "DesignDocuments", id: "design-1", relPath: "DESIGN.html", contentDigest: "digest-1",
    }] }));
    await screen.findByRole("tab", { name: "DESIGN" });
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Issue details")).toBeVisible();
  });

  it("[overhaul-696] reopening a document wins over an older terminal whose durable history arrives later", async () => {
    const history = deferred<WorkItemEndedRunFixture[]>();
    const terminalReads = terminalSessionReadExecutor({
      readTaskTerminalSessions: async () => [], readScratchTerminalSessions: async () => [],
      readScratchResumableTerminalSessions: async () => [], readTaskResumableTerminalSessions: async () => [],
      readStoryEndedRuns: () => history.promise,
    });
    installDesktopGraphQlRuntime(async (document, variables) => {
      if (documentOperationName(document) === "WorktreeStatus") return absentWorktree as never;
      if (documentOperationName(document) === "RefreshTaskDocumentRegistry") return {
        refresh_task_document_registry: [{ __typename: "DesignDocuments", id: "design-1", relPath: "DESIGN.html", contentDigest: "digest-1" }],
      } as never;
      return terminalReads(document, variables);
    });
    useClientStore.getState().ensureWorkspace("story-1");
    useClientStore.getState().closeDoc("story-1", "design-1");
    rememberStudioWorkspaceTarget("story-1", { kind: "terminal", agentRunId: "run-old" });
    render(<TaskWorkspace bucket="story-1" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Issue details</div>} />);
    fireEvent.click(await screen.findByRole("button", { name: /Dormant tabs/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Reopen DESIGN" }));
    expect(screen.getByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "true");
    await act(async () => {
      useAgentStatusStore.setState({ runs: { "run-old": {
        agent_run_id: "run-old", task_id: "story-1", module_id: "module-1", agent: "codex",
        scope: "task", state: "working", launch_state: "Implement", launch_model: null,
        started_at: "2026-10-09T08:00:00Z", updated_at: "2026-10-09T08:00:00Z",
      } } });
      useTerminalStore.setState({ sessions: { "session-old": {
        sessionId: "session-old", agentRunId: "run-old", taskId: "story-1", projectId: "project-1",
        moduleId: "module-1", agent: "codex", status: "ready", transport: "ready", isPlanning: false,
        isInstant: false, initialPrompt: null, viewerAttachmentDeferred: true,
      } }, sessionByRun: { "run-old": "session-old" } });
      history.resolve([]);
    });
    await screen.findByRole("tab", { name: "Implement codex terminal" });
    expect(screen.getByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "true");
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "doc", relPath: "DESIGN.html" });
  });

  it("[overhaul-697] closing an inactive document preserves the pending remembered terminal", async () => {
    const history = deferred<WorkItemEndedRunFixture[]>();
    const terminalReads = terminalSessionReadExecutor({
      readTaskTerminalSessions: async () => [], readScratchTerminalSessions: async () => [],
      readScratchResumableTerminalSessions: async () => [], readTaskResumableTerminalSessions: async () => [],
      readStoryEndedRuns: () => history.promise,
    });
    installDesktopGraphQlRuntime(async (document, variables) => {
      const operation = documentOperationName(document);
      if (operation === "WorktreeStatus") return absentWorktree as never;
      if (operation === "RefreshTaskDocumentRegistry") return {
        refresh_task_document_registry: [{ __typename: "DesignDocuments", id: "design-1", relPath: "DESIGN.html", contentDigest: "digest-1" }],
      } as never;
      return terminalReads(document, variables);
    });
    rememberStudioWorkspaceTarget("story-1", { kind: "terminal", agentRunId: "run-old" });
    render(<TaskWorkspace bucket="story-1" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Issue details</div>} />);
    fireEvent.click(await screen.findByRole("button", { name: "Close DESIGN" }));
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    await act(async () => {
      useTerminalStore.setState({ sessions: { "session-old": {
        sessionId: "session-old", agentRunId: "run-old", taskId: "story-1", projectId: "project-1",
        moduleId: "module-1", agent: "codex", status: "ready", transport: "ready", isPlanning: false,
        isInstant: false, initialPrompt: null, viewerAttachmentDeferred: true,
      } }, sessionByRun: { "run-old": "session-old" } });
      history.resolve([]);
    });
    const terminal = await screen.findByRole("tab", { name: "codex terminal" });
    await waitFor(() => expect(terminal).toHaveAttribute("aria-selected", "true"));
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-old" });
  });

  it("[overhaul-698] explicit engagement of Details wins over delayed remembered document hydration", async () => {
    const documentRead = deferred<unknown>();
    const terminalReads = terminalSessionReadExecutor({
      readTaskTerminalSessions: async () => [], readScratchTerminalSessions: async () => [],
      readScratchResumableTerminalSessions: async () => [], readTaskResumableTerminalSessions: async () => [],
    });
    installDesktopGraphQlRuntime(async (document, variables) => {
      const operation = documentOperationName(document);
      if (operation === "WorktreeStatus") return absentWorktree as never;
      if (operation === "RefreshTaskDocumentRegistry") return await documentRead.promise as never;
      return terminalReads(document, variables);
    });
    rememberStudioWorkspaceTarget("story-1", { kind: "doc", relPath: "DESIGN.html" });
    render(<TaskWorkspace bucket="story-1" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Issue details</div>} />);
    fireEvent.mouseDown(screen.getByText("Issue details"));
    await waitFor(() => expect(screen.getByTestId("workspace-details-surface")).toHaveFocus());
    await act(async () => documentRead.resolve({ refresh_task_document_registry: [{
      __typename: "DesignDocuments", id: "design-1", relPath: "DESIGN.html", contentDigest: "digest-1",
    }] }));
    await screen.findByRole("tab", { name: "DESIGN" });
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("workspace-details-surface")).toHaveFocus();
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "details" });
  });

  it("[overhaul-699] an explicit agent run focus in the same workspace outranks delayed remembered document hydration", async () => {
    const documentRead = deferred<unknown>();
    const terminalReads = terminalSessionReadExecutor({
      readTaskTerminalSessions: async () => [], readScratchTerminalSessions: async () => [],
      readScratchResumableTerminalSessions: async () => [], readTaskResumableTerminalSessions: async () => [],
    });
    installDesktopGraphQlRuntime(async (document, variables) => {
      const operation = documentOperationName(document);
      if (operation === "WorktreeStatus") return absentWorktree as never;
      if (operation === "RefreshTaskDocumentRegistry") return await documentRead.promise as never;
      return terminalReads(document, variables);
    });
    useAgentStatusStore.setState({ runs: { "run-explicit": {
      agent_run_id: "run-explicit", project_id: "project-1", task_id: "story-1", module_id: "module-1",
      agent: "codex", scope: "task", state: "working", launch_state: "Implement", launch_model: null,
      started_at: "2026-10-09T08:00:00Z", updated_at: "2026-10-09T08:00:00Z",
    } } });
    useTerminalStore.setState({ sessions: { "session-explicit": {
      sessionId: "session-explicit", agentRunId: "run-explicit", taskId: "story-1", projectId: "project-1",
      moduleId: "module-1", agent: "codex", status: "ready", transport: "ready", isPlanning: false,
      isInstant: false, initialPrompt: null, viewerAttachmentDeferred: true,
    } }, sessionByRun: { "run-explicit": "session-explicit" } });
    rememberStudioWorkspaceTarget("story-1", { kind: "doc", relPath: "DESIGN.html" });
    render(<TaskWorkspace bucket="story-1" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Issue details</div>} />);
    const terminal = await screen.findByRole("tab", { name: "Implement codex terminal" });
    await act(async () => {
      expect(await dispatchAgentRunAction(AGENT_RUN_ACTIONS.focusAgentRun, { runId: "run-explicit" })).toBe(true);
    });
    expect(terminal).toHaveAttribute("aria-selected", "true");
    await act(async () => documentRead.resolve({ refresh_task_document_registry: [{
      __typename: "DesignDocuments", id: "design-1", relPath: "DESIGN.html", contentDigest: "digest-1",
    }] }));
    await screen.findByRole("tab", { name: "DESIGN" });
    expect(terminal).toHaveAttribute("aria-selected", "true");
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-explicit" });
  });

});

import { installWorkspaceViewerTransport, workspaceViewerInvocations } from "./renderedTaskWorkspaceTerminalFixture";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { TaskWorkspace } from "../features/task-workspace";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { ChangesWorkspace, useChangesWorkspace } from "../features/agents/worktrees";
import { useTerminalForegroundStore, useTerminalStore, type SessionMeta } from "../features/agents/terminal";
import { useStudioStore } from "../features/projects/store";
import { rememberStudioWorkspaceTarget, readStudioWorkspaceTarget } from "../features/workspace-state/studioWorkspaceTarget";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime, terminalSessionReadExecutor } from "./desktopGraphQlRuntime";

let includeDocument = false;
let includeWorktree = false;

function WorkspaceAndChanges() {
  const changesActive = useChangesWorkspace((state) => state.active);
  return <>
    <div hidden={changesActive}>
      <TaskWorkspace bucket="story-1" projectId="project-1" moduleId="module-1"
        owner="studio" workspaceActive={!changesActive} details={<div>Issue details</div>} />
    </div>
    <ChangesWorkspace />
  </>;
}

const existingSession: SessionMeta = {
  sessionId: "session-existing",
  agentRunId: "run-existing",
  taskId: "story-1",
  projectId: "project-1",
  moduleId: "module-1",
  agent: "codex",
  status: "ready",
  transport: "ready",
  isPlanning: false,
  isInstant: false,
  initialPrompt: null,
  viewerAttachmentDeferred: true,
};

describe("overhaul acceptance — rendered task workspace public entry", () => {
  beforeEach(() => {
    installWorkspaceViewerTransport();
    includeDocument = false;
    includeWorktree = false;
    useChangesWorkspace.setState(useChangesWorkspace.getInitialState(), true);
    const terminalReads = terminalSessionReadExecutor({
      readTaskTerminalSessions: async () => [],
      readScratchTerminalSessions: async () => [],
      readTaskResumableTerminalSessions: async () => [],
      readScratchResumableTerminalSessions: async () => [],
    });
    installDesktopGraphQlRuntime(async (document, variables) => {
      if (documentOperationName(document) === "WorktreeStatus") {
        return { worktree_status: {
          __typename: "WorktreeStatusView", kind: includeWorktree ? "worktree" : "none", task_id: "story-1",
          top_level_task_id: "story-1", is_shared: false, branch: null, base_branch: null,
          path: null, state: null, clean: null, dirty: null, ahead: null, behind: null,
          conflict: null, checkout_present: false, ephemeral: false, reason: null,
        } } as never;
      }
      if (documentOperationName(document) === "CurrentWorktrees") {
        return { worktrees: { __typename: "WorktrackerWorktreeConnection", nodes: [] } } as never;
      }
      if (documentOperationName(document) === "WorktreeChanges") {
        return { worktree_changes: {
          __typename: "WorktreeChangesView", task_id: "story-1", top_level_task_id: "story-1",
          is_shared: false, base_commit: "0123456789abcdef0123456789abcdef01234567",
          committed_count: 0, pull_request_url: null, pull_request_creation_eligible: false,
          work_item_done: false, closure_failure: null, pull_request: null,
          cleanup: { __typename: "WorktreeCleanupStatusView", eligible: false,
            blocker: "pull_request_absent", reason: "No pull request is mapped to this worktree." },
          clean: true, dirty: false, unpushed_count: 0, truncated: false,
          files: [], insertions: 0, deletions: 0,
        } } as never;
      }
      if (documentOperationName(document) === "RefreshTaskDocumentRegistry") {
        return { refresh_task_document_registry: includeDocument ? [{
          __typename: "DesignDocuments", id: "design-existing", relPath: "DESIGN.html", contentDigest: "digest-existing",
        }] : [] } as never;
      }
      return terminalReads(document, variables);
    });
    localStorage.clear();
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-1", selectedTaskId: "story-1",
      focusedPane: "tasks", sidebarVisible: true,
      editViewBodyEngaged: false, editViewZone: "stories", navigationModality: "pointer",
      workspaces: {}, activeByTask: {},
    });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    useTerminalStore.setState({
      sessions: { "session-existing": existingSession },
      sessionByRun: { "run-existing": "session-existing" },
    });
    useAgentStatusStore.setState({
      projectId: "project-1", automationAttempts: {}, automationByTask: {},
      runs: {
        "run-existing": {
          agent_run_id: "run-existing", task_id: "story-1", module_id: "module-1",
          agent: "codex", scope: "task", state: "working", launch_state: "Implement",
          launch_model: null, started_at: "2026-10-09T08:00:00Z",
          updated_at: "2026-10-09T08:00:00Z",
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    vi.unstubAllGlobals();
  });

  it("[overhaul-670] restores and selects an existing terminal through the public rendered entry without changing its run or session", async () => {
    rememberStudioWorkspaceTarget("story-1", { kind: "terminal", agentRunId: "run-existing" });
    render(<TaskWorkspace bucket="story-1" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Issue details</div>} />);

    const terminalTab = await screen.findByRole("tab", { name: "Implement codex terminal" });
    await waitFor(() => expect(terminalTab).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("Issue details")).toBeVisible();
    fireEvent.click(terminalTab);
    expect(terminalTab).toHaveAttribute("aria-selected", "true");
    // The terminal adapter's durable identities are the identity/deduplication
    // invariant exposed by this fixture, independent of presentation internals.
    expect(useTerminalStore.getState().sessionByRun).toEqual({ "run-existing": "session-existing" });
    expect(Object.keys(useTerminalStore.getState().sessions)).toEqual(["session-existing"]);
    expect(useTerminalStore.getState().sessions["session-existing"]).toMatchObject({
      agentRunId: "run-existing", sessionId: "session-existing", taskId: "story-1",
    });
  });

  it("[overhaul-671] preserves document engagement, first-press terminal focus and mounted viewers through the shell adapter", async () => {
    includeDocument = true;
    useTerminalStore.setState({ sessions: {
      "session-existing": { ...existingSession, viewerAttachmentDeferred: false },
    } });
    rememberStudioWorkspaceTarget("story-1", { kind: "details" });
    render(<SelectedTicketContent bucket="story-1" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Issue details</div>} />);

    const documentTab = await screen.findByRole("tab", { name: "DESIGN" });
    fireEvent.click(documentTab);
    const frame = await screen.findByTitle("DESIGN");
    fireEvent.mouseDown(frame);
    await waitFor(() => expect(frame).toHaveFocus());
    expect(frame).toBeVisible();
    expect(frame).toHaveAttribute("src", expect.stringContaining("design-existing"));

    fireEvent.click(screen.getByRole("tab", { name: "Implement codex terminal" }));
    const input = await screen.findByRole("textbox", { name: "Terminal input" });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("Issue details")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(documentTab);
    expect(screen.getByTitle("DESIGN")).toBe(frame);
    fireEvent.mouseDown(frame);
    await waitFor(() => expect(frame).toHaveFocus());
    fireEvent.click(screen.getByRole("tab", { name: "Implement codex terminal" }));
    expect(screen.getByRole("textbox", { name: "Terminal input" })).toBe(input);
    await waitFor(() => expect(input).toHaveFocus());
    expect(useTerminalStore.getState().sessionByRun).toEqual({ "run-existing": "session-existing" });
    // A view attach keeps the durable run request; tab switches do not spawn
    // another viewer or replace the existing terminal session.
    expect(workspaceViewerInvocations().filter(([command]) => command === "viewer_attach")).toEqual([
      ["viewer_attach", expect.objectContaining({ runId: "run-existing" })],
    ]);
  });

  it("[overhaul-672] restores a remembered document through the public entry and engages its retained frame", async () => {
    includeDocument = true;
    rememberStudioWorkspaceTarget("story-1", { kind: "doc", relPath: "DESIGN.html" });
    render(<TaskWorkspace bucket="story-1" projectId="project-1" moduleId="module-1"
      owner="studio" details={<div>Issue details</div>} />);
    const tab = await screen.findByRole("tab", { name: "DESIGN" });
    await waitFor(() => expect(tab).toHaveAttribute("aria-selected", "true"));
    const frame = await screen.findByTitle("DESIGN");
    expect(frame).not.toHaveFocus();
    fireEvent.mouseDown(frame);
    await waitFor(() => expect(frame).toHaveFocus());
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    fireEvent.click(tab);
    expect(screen.getByTitle("DESIGN")).toBe(frame);
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "doc", relPath: "DESIGN.html" });
    expect(useTerminalStore.getState().sessionByRun).toEqual({ "run-existing": "session-existing" });
  });

  it("[overhaul-673] opens independent Changes from the public workspace without replacing its selected terminal or mounted viewer", async () => {
    includeWorktree = true;
    rememberStudioWorkspaceTarget("story-1", { kind: "terminal", agentRunId: "run-existing" });
    render(<WorkspaceAndChanges />);
    const terminalTab = await screen.findByRole("tab", { name: "Implement codex terminal" });
    await waitFor(() => expect(terminalTab).toHaveAttribute("aria-selected", "true"));
    const viewer = await screen.findByTestId("terminal-viewer-pending");
    fireEvent.click(await screen.findByRole("tab", { name: "Changes" }));
    expect(await screen.findByRole("region", { name: "Changes workspace" })).toBeVisible();
    expect(terminalTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("terminal-viewer-pending")).toBe(viewer);
    expect(viewer).not.toBeVisible();
    expect(useChangesWorkspace.getState()).toMatchObject({ active: true, moduleId: "module-1", taskId: "story-1" });
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-existing" });
    expect(useTerminalStore.getState().sessionByRun).toEqual({ "run-existing": "session-existing" });
  });
});

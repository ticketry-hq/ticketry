import { installWorkspaceViewerTransport } from "./renderedTaskWorkspaceTerminalFixture";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskWorkspace } from "../features/task-workspace";
import { readStudioWorkspaceTarget, rememberStudioWorkspaceTarget } from "../features/workspace-state/studioWorkspaceTarget";
import { useTerminalStore } from "../features/agents/terminal";
import ToastHost from "../app/shell/ToastHost";
import { useToastStore } from "../app/shell/toastStore";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { expectRetainedRun, installDeferredWorkspaceResumes, resumeSource } from "./renderedTaskWorkspaceResumeFixture";

function workspace(bucket = "story-a", workspaceActive = true) {
  return <TaskWorkspace bucket={bucket} projectId="project-1" moduleId="module-1"
    owner="studio" workspaceActive={workspaceActive} details={<div>{bucket} details</div>} />;
}

async function startResume() {
  fireEvent.click(await screen.findByRole("button", { name: "Dormant tabs (1)" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Resume Implement codex terminal" }));
}

describe("overhaul acceptance — async resume remains local to its originating intent", () => {
  let resumes: ReturnType<typeof installDeferredWorkspaceResumes>;
  beforeEach(() => {
    installWorkspaceViewerTransport();
    resumes = installDeferredWorkspaceResumes();
    useToastStore.setState({ toasts: [] });
    rememberStudioWorkspaceTarget("story-a", { kind: "details" });
    rememberStudioWorkspaceTarget("story-b", { kind: "details" });
  });
  afterEach(() => {
    cleanup();
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    vi.unstubAllGlobals();
  });

  it("[overhaul-701] retains a completed resume after A to B without changing selection, focus or either remembered target", async () => {
    const { rerender } = render(workspace());
    await startResume();
    await resumes.request();
    rerender(workspace("story-b"));
    fireEvent.mouseDown(screen.getByText("story-b details"));
    const currentSurface = screen.getByTestId("workspace-details-surface");
    await waitFor(() => expect(currentSurface).toHaveFocus());
    await resumes.complete();
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("story-b details")).toBeVisible();
    expect(currentSurface).toHaveFocus();
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "details" });
    expect(readStudioWorkspaceTarget("story-b")).toEqual({ kind: "details" });
    expect(Object.values(useTerminalStore.getState().sessions)).toEqual([
      expect.objectContaining({ agentRunId: "successor-a", taskId: "story-a" }),
    ]);
    expect(resumes.operations.filter((entry) => entry.operationName === "UpdateTerminalSession")).toEqual([]);
  });

  it("[overhaul-702] preserves the new A entry when an old resume completes following A to B to A", async () => {
    const { rerender } = render(workspace());
    fireEvent.mouseDown(screen.getByText("story-a details"));
    const surface = screen.getByTestId("workspace-details-surface");
    await waitFor(() => expect(surface).toHaveFocus());
    await startResume();
    await resumes.request();
    rerender(workspace("story-b"));
    rerender(workspace());
    const currentFocus = document.activeElement;
    await resumes.complete();
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("story-a details")).toBeVisible();
    expect(document.activeElement).toBe(currentFocus);
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "details" });
    expect(Object.values(useTerminalStore.getState().sessions)).toEqual([
      expect.objectContaining({ agentRunId: "successor-a", taskId: "story-a" }),
    ]);
  });

  it("[overhaul-703] keeps the newer of two resume intents selected when transports complete in reverse order", async () => {
    resumes = installDeferredWorkspaceResumes([resumeSource(), resumeSource("source-b", "claude")]);
    render(workspace());
    fireEvent.click(await screen.findByRole("button", { name: "Dormant tabs (2)" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Resume Implement codex terminal" }));
    await resumes.request("source-a");
    fireEvent.click(screen.getByRole("menuitem", { name: "Resume Implement claude terminal" }));
    await resumes.request("source-b");
    await resumes.complete("source-b", "successor-b");
    const newerTab = await screen.findByRole("tab", { name: "claude terminal" });
    expect(newerTab).toHaveAttribute("aria-selected", "true");
    // Selection commits before the lazy terminal viewer receives its pending focus and canonical identity.
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Terminal input" })).toHaveFocus());
    const newerSession = expectRetainedRun("successor-b");
    const currentFocus = document.activeElement;
    await resumes.complete();
    expect(newerTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute("aria-selected", "false");
    expect(document.activeElement).toBe(currentFocus);
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "terminal", agentRunId: "successor-b" });
    expect(expectRetainedRun("successor-b")).toBe(newerSession);
    expect(Object.values(useTerminalStore.getState().sessions)).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentRunId: "successor-a", taskId: "story-a" }),
      expect.objectContaining({ agentRunId: "successor-b", taskId: "story-a" }),
    ]));
    expect(Object.values(useTerminalStore.getState().sessions)).toHaveLength(2);
    expect(resumes.operations.filter((entry) => entry.operationName === "ResumeTerminalSession")).toEqual([
      expect.objectContaining({ variables: expect.objectContaining({ resumeFromAgentRunId: "source-a", issueId: "story-a" }) }),
      expect.objectContaining({ variables: expect.objectContaining({ resumeFromAgentRunId: "source-b", issueId: "story-a" }) }),
    ]);
  });

  it("[overhaul-710] keeps a newer Details selection and engagement when the same workspace resume settles", async () => {
    render(workspace());
    await startResume();
    await resumes.request();
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    fireEvent.mouseDown(screen.getByText("story-a details"));
    const surface = screen.getByTestId("workspace-details-surface");
    await waitFor(() => expect(surface).toHaveFocus());
    await resumes.complete();
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(surface).toBeVisible();
    expect(surface).toHaveFocus();
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "details" });
    expect(Object.values(useTerminalStore.getState().sessions)).toEqual([
      expect.objectContaining({ agentRunId: "successor-a", taskId: "story-a" }),
    ]);
  });

  it("[overhaul-711] preserves a legitimate resumed terminal after disposal without updating remembered intent", async () => {
    const { unmount } = render(workspace());
    await startResume();
    await resumes.request();
    unmount();
    await resumes.complete();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "details" });
    expect(Object.values(useTerminalStore.getState().sessions)).toEqual([
      expect.objectContaining({ agentRunId: "successor-a", taskId: "story-a" }),
    ]);
    expect(resumes.operations.filter((entry) => entry.operationName === "UpdateTerminalSession")).toEqual([]);
  });

  it("[overhaul-712] deduplicates repeated clicks while resume is pending and retains exactly one successor", async () => {
    render(workspace());
    await startResume();
    await resumes.request();
    const pendingItem = screen.getByRole("menuitem", { name: "Resume Implement codex terminal" });
    expect(pendingItem).toBeDisabled();
    fireEvent.click(pendingItem);
    fireEvent.click(pendingItem);
    expect(resumes.operations.filter((entry) => entry.operationName === "ResumeTerminalSession")).toHaveLength(1);
    await resumes.complete();
    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute("aria-selected", "true");
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "terminal", agentRunId: "successor-a" });
    expect(Object.values(useTerminalStore.getState().sessions)).toEqual([
      expect.objectContaining({ agentRunId: "successor-a", taskId: "story-a" }),
    ]);
  });

  it("[overhaul-713] preserves resume error feedback after a newer selection and leaves the source retryable", async () => {
    render(<>{workspace()}<ToastHost /></>);
    await startResume();
    await resumes.request();
    fireEvent.mouseDown(screen.getByText("story-a details"));
    const surface = screen.getByTestId("workspace-details-surface");
    await waitFor(() => expect(surface).toHaveFocus());
    await resumes.fail(new FoundationGraphQlError("resume_unsupported", "Unsupported resume", { error: "resume_unsupported" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not resume session");
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(surface).toHaveFocus();
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "details" });
    expect(useTerminalStore.getState().sessions).toEqual({});
    const trigger = screen.getByRole("button", { name: "Dormant tabs (1)" });
    if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Resume Implement codex terminal" })).not.toBeDisabled();
    expect(resumes.operations.filter((entry) => entry.operationName === "ResumeTerminalSession")).toHaveLength(1);
  });

  it("[overhaul-714] invalidates resume intent when the same mounted workspace loses and regains presentation authority", async () => {
    function retained(active: boolean) {
      return <><input aria-label="Other workspace input" />
        <div hidden={!active}>{workspace("story-a", active)}</div></>;
    }
    const { rerender } = render(retained(true));
    await startResume();
    await resumes.request();
    rerender(retained(false));
    screen.getByRole("textbox", { name: "Other workspace input" }).focus();
    rerender(retained(true));
    const currentFocus = document.activeElement;
    await resumes.complete();
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("story-a details")).toBeVisible();
    expect(document.activeElement).toBe(currentFocus);
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "details" });
    expect(Object.values(useTerminalStore.getState().sessions)).toEqual([
      expect.objectContaining({ agentRunId: "successor-a", taskId: "story-a" }),
    ]);
  });
});

import "./renderedTaskWorkspaceTerminalFixture";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskWorkspace } from "../features/task-workspace";
import { ackTerminal, useTerminalStore, type ForegroundOwner } from "../features/agents/terminal";
import { readStudioWorkspaceTarget, rememberStudioWorkspaceTarget } from "../features/workspace-state/studioWorkspaceTarget";
import { useClientStore } from "../state/clientStore";
import { installDeferredWorkspaceLaunches } from "./renderedTaskWorkspaceLaunchFixture";

function workspace(owner: ForegroundOwner) {
  return <>
    <button>Other control</button>
    <TaskWorkspace bucket="story-a" projectId="project-1" moduleId="module-1"
      owner={owner} details={<div>Issue details</div>} />
  </>;
}

describe("overhaul acceptance — terminal completion follows its originating session", () => {
  let originId: string;
  let unrelatedId: string;
  beforeEach(() => {
    installDeferredWorkspaceLaunches();
    rememberStudioWorkspaceTarget("story-a", { kind: "details" });
    originId = useTerminalStore.getState().openSession({
      taskId: "story-a", projectId: "project-1", moduleId: "module-1",
      agent: "codex", viewerAttachmentDeferred: true,
    });
    unrelatedId = useTerminalStore.getState().openSession({
      taskId: "story-a", projectId: "project-1", moduleId: "module-1",
      agent: "gemini", agentRunId: "run-unrelated", select: false,
    });
  });
  afterEach(() => {
    cleanup();
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    vi.unstubAllGlobals();
  });

  it("[overhaul-715] remembers the intended launched run when the authoritative terminal selection index changes before its durable rekey", async () => {
    render(workspace("studio"));
    fireEvent.click(await screen.findByRole("tab", { name: "codex terminal" }));
    // Exercise the terminal adapter's identity invariant: a projection/index
    // change is not a new user tab intent and must not substitute its run for
    // the temporary session the user selected.
    await act(async () => {
      useClientStore.getState().tabSelected("story-a", unrelatedId);
      ackTerminal(originId, "session-origin", "run-origin");
    });

    await waitFor(() => expect(readStudioWorkspaceTarget("story-a")).toEqual({
      kind: "terminal", agentRunId: "run-origin",
    }));
    expect(screen.getByRole("tab", { name: "gemini terminal" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute("aria-selected", "false");
    expect(useTerminalStore.getState().sessionByRun).toMatchObject({
      "run-origin": "session-origin", "run-unrelated": expect.any(String),
    });
    expect(Object.values(useTerminalStore.getState().sessions).filter((session) => session.agentRunId === "run-origin")).toHaveLength(1);
  });

  it("[overhaul-716] does not send an originating temporary terminal's deferred focus to an unrelated selected terminal", async () => {
    render(workspace("drawer"));
    fireEvent.click(await screen.findByRole("tab", { name: "codex terminal" }));
    await act(async () => {
      useClientStore.getState().tabSelected("story-a", unrelatedId);
    });
    const input = await screen.findByRole("textbox", { name: "Terminal input" });
    await waitFor(() => expect(useTerminalStore.getState().sessionByRun["run-unrelated"]).toBe("session-run-unrelated"));
    const otherControl = screen.getByRole("button", { name: "Other control" });
    otherControl.focus();
    expect(otherControl).toHaveFocus();

    await act(async () => {
      ackTerminal(originId, "session-origin", "run-origin");
    });

    expect(screen.getByRole("tab", { name: "gemini terminal" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute("aria-selected", "false");
    expect(otherControl).toHaveFocus();
    expect(input).not.toHaveFocus();
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "details" });
    expect(useTerminalStore.getState().sessionByRun["run-origin"]).toBe("session-origin");
    expect(Object.values(useTerminalStore.getState().sessions).filter((session) => session.agentRunId === "run-origin")).toHaveLength(1);
  });
});

import { deferred, publishLiveRuns, seedTerminal, terminalIntentFixture, terminalWorkspace } from "./workspaceTerminalIntentFixture";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { rememberStudioWorkspaceTarget, readStudioWorkspaceTarget } from "../features/workspace-state/studioWorkspaceTarget";
import type { WorkItemEndedRunFixture } from "./desktopGraphQlRuntime";
import type { ResumableTerminalSession } from "../features/agents/types";

describe("overhaul acceptance — terminal restoration intent", () => {
  let reads: ReturnType<typeof terminalIntentFixture>;
  beforeEach(() => { reads = terminalIntentFixture(); });

  it("[overhaul-684] retains a remembered run until successful run resolution establishes absence and repairs persistence", async () => {
    const ended = deferred<WorkItemEndedRunFixture[]>();
    reads.ended.mockReturnValue(ended.promise);
    rememberStudioWorkspaceTarget("story-1", { kind: "terminal", agentRunId: "run-missing" });
    render(terminalWorkspace());
    await waitFor(() => expect(reads.ended).toHaveBeenCalledWith("story-1"));
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-missing" });
    await act(async () => ended.resolve([]));
    await waitFor(() => expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "details" }));
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  });

  it("[overhaul-685] repairs an existing remembered terminal when authoritative resumability makes it ineligible", async () => {
    const resumable = deferred<ResumableTerminalSession[]>();
    reads.resumable.mockReturnValue(resumable.promise);
    publishLiveRuns(["run-ineligible"]);
    seedTerminal("run-ineligible");
    rememberStudioWorkspaceTarget("story-1", { kind: "terminal", agentRunId: "run-ineligible" });
    render(terminalWorkspace());
    await waitFor(() => expect(reads.resumable).toHaveBeenCalled());
    await act(async () => resumable.resolve([{
      agent_run_id: "run-ineligible", agent: "codex", status: "terminated",
      started_at: "2026-10-09T08:00:00Z", provider_session_id: "provider-old",
      scope: "task", launch_state: "run-ineligible", launch_model: null, resumed_from: null,
    }]));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByRole("tab", { name: "run-ineligible codex terminal" })).not.toBeInTheDocument();
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "details" });
  });

  it("[overhaul-686] waits for the authoritative live snapshot before restoring a delayed remembered projection", async () => {
    publishLiveRuns([], "story-1", false);
    rememberStudioWorkspaceTarget("story-1", { kind: "terminal", agentRunId: "run-late" });
    render(terminalWorkspace());
    await waitFor(() => expect(reads.ended).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-late" });
    publishLiveRuns(["run-late"]);
    await waitFor(() => expect(screen.getByRole("tab", { name: "run-late codex terminal" })).toHaveAttribute("aria-selected", "true"));
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-late" });
  });

  it("[overhaul-687] keeps explicit conversation entry ahead of delayed remembered terminal resolution", async () => {
    const ended = deferred<WorkItemEndedRunFixture[]>();
    reads.ended.mockReturnValue(ended.promise);
    publishLiveRuns(["run-chosen"], "story-1", false);
    rememberStudioWorkspaceTarget("story-1", { kind: "terminal", agentRunId: "run-remembered" });
    const view = render(terminalWorkspace());
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    view.rerender(terminalWorkspace("story-1", "run-chosen"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "run-chosen codex terminal" })).toHaveAttribute("aria-selected", "true"));
    publishLiveRuns(["run-chosen", "run-remembered"]);
    await act(async () => ended.resolve([]));
    expect(screen.getByRole("tab", { name: "run-chosen codex terminal" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "run-remembered codex terminal" })).not.toBeInTheDocument();
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-chosen" });
  });

  it("[overhaul-688] follows a newer conversation within the same bucket when the older read finishes later", async () => {
    const ended = deferred<WorkItemEndedRunFixture[]>();
    reads.ended.mockReturnValue(ended.promise);
    publishLiveRuns(["run-first"], "story-1", false);
    rememberStudioWorkspaceTarget("story-1", { kind: "details" });
    const view = render(terminalWorkspace("story-1", "run-first"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "run-first codex terminal" })).toHaveAttribute("aria-selected", "true"));
    view.rerender(terminalWorkspace("story-1", "run-second"));
    expect(screen.queryByRole("tab", { name: "run-first codex terminal" })).not.toBeInTheDocument();
    publishLiveRuns(["run-first", "run-second"]);
    await waitFor(() => expect(screen.getByRole("tab", { name: "run-second codex terminal" })).toHaveAttribute("aria-selected", "true"));
    await act(async () => ended.resolve([]));
    expect(screen.getByRole("tab", { name: "run-second codex terminal" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "run-first codex terminal" })).not.toBeInTheDocument();
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-second" });
  });

  it("[overhaul-689] rejects a durable remembered terminal belonging to another workspace and repairs its target", async () => {
    seedTerminal("run-other", "story-2");
    publishLiveRuns(["run-other"], "story-2");
    rememberStudioWorkspaceTarget("story-1", { kind: "terminal", agentRunId: "run-other" });
    render(terminalWorkspace());
    await waitFor(() => expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "details" }));
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "run-other codex terminal" })).not.toBeInTheDocument();
  });

  it("[overhaul-690] preserves remembered terminal intent after an ended-run read error", async () => {
    const ended = deferred<WorkItemEndedRunFixture[]>();
    reads.ended.mockReturnValue(ended.promise);
    rememberStudioWorkspaceTarget("story-1", { kind: "terminal", agentRunId: "run-unresolved" });
    render(terminalWorkspace());
    await waitFor(() => expect(reads.ended).toHaveBeenCalled());
    await act(async () => {
      ended.reject(new Error("WorkItem run read unavailable"));
      await ended.promise.catch(() => {});
    });
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-unresolved" });
    publishLiveRuns(["run-unresolved"]);
    await waitFor(() => expect(screen.getByRole("tab", { name: "run-unresolved codex terminal" })).toHaveAttribute("aria-selected", "true"));
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-unresolved" });
  });

  it("[overhaul-691] ignores an old run read and projection after switching from A to B", async () => {
    const endedA = deferred<WorkItemEndedRunFixture[]>();
    reads.ended.mockImplementation((task) => task === "story-1" ? endedA.promise : Promise.resolve([]));
    publishLiveRuns([], "story-1", false);
    rememberStudioWorkspaceTarget("story-1", { kind: "terminal", agentRunId: "run-a" });
    rememberStudioWorkspaceTarget("story-2", { kind: "details" });
    const view = render(terminalWorkspace());
    await waitFor(() => expect(reads.ended).toHaveBeenCalledWith("story-1"));
    view.rerender(terminalWorkspace("story-2"));
    await waitFor(() => expect(reads.ended).toHaveBeenCalledWith("story-2"));
    await act(async () => endedA.resolve([]));
    publishLiveRuns(["run-a"]);
    expect(screen.getByText("Issue details story-2")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "run-a codex terminal" })).not.toBeInTheDocument();
    expect(readStudioWorkspaceTarget("story-2")).toEqual({ kind: "details" });
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-a" });
  });

  it("[overhaul-692] preserves newer Details selection after A to B to A and an old run completion", async () => {
    const endedA = deferred<WorkItemEndedRunFixture[]>();
    reads.ended.mockImplementation((task) => task === "story-1" ? endedA.promise : Promise.resolve([]));
    publishLiveRuns([], "story-1", false);
    rememberStudioWorkspaceTarget("story-1", { kind: "terminal", agentRunId: "run-a" });
    const view = render(terminalWorkspace());
    await waitFor(() => expect(reads.ended).toHaveBeenCalledWith("story-1"));
    view.rerender(terminalWorkspace("story-2"));
    await waitFor(() => expect(reads.ended).toHaveBeenCalledWith("story-2"));
    view.rerender(terminalWorkspace());
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    await act(async () => endedA.resolve([]));
    publishLiveRuns(["run-a"]);
    const tab = await screen.findByRole("tab", { name: "run-a codex terminal" });
    expect(tab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Issue details story-1")).toBeVisible();
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "details" });
  });

  it("[overhaul-693] preserves remembered terminal intent while resumable-session resolution loads or fails", async () => {
    const resumable = deferred<ResumableTerminalSession[]>();
    reads.resumable.mockReturnValue(resumable.promise);
    rememberStudioWorkspaceTarget("story-1", { kind: "terminal", agentRunId: "run-unresolved" });
    render(terminalWorkspace());
    await waitFor(() => expect(reads.resumable).toHaveBeenCalled());
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-unresolved" });
    await act(async () => {
      resumable.reject(new Error("Resumable-session read unavailable"));
      await resumable.promise.catch(() => {});
    });
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-unresolved" });
    publishLiveRuns(["run-unresolved"]);
    await waitFor(() => expect(screen.getByRole("tab", { name: "run-unresolved codex terminal" })).toHaveAttribute("aria-selected", "true"));
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-unresolved" });
  });
});

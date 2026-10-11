import { deferred, publishLiveRuns, terminalIntentFixture } from "./workspaceTerminalIntentFixture";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskWorkspace } from "../features/task-workspace";
import { readStudioWorkspaceTarget, rememberStudioWorkspaceTarget } from "../features/workspace-state/studioWorkspaceTarget";
import type { WorkItemEndedRunFixture } from "./desktopGraphQlRuntime";

function workspace(workspaceActive: boolean) {
  return <TaskWorkspace bucket="story-1" projectId="project-1" moduleId="module-1"
    owner="studio" workspaceActive={workspaceActive} details={<div>Issue details</div>} />;
}

describe("overhaul acceptance — retained workspace authority reentry", () => {
  it("[overhaul-717] restores current remembered intent when a retained workspace returns after hydration completed while hidden", async () => {
    const reads = terminalIntentFixture();
    const ended = deferred<WorkItemEndedRunFixture[]>();
    reads.ended.mockReturnValue(ended.promise);
    publishLiveRuns([], "story-1", false);
    rememberStudioWorkspaceTarget("story-1", { kind: "terminal", agentRunId: "run-return" });
    const view = render(workspace(true));
    await waitFor(() => expect(reads.ended).toHaveBeenCalled());
    view.rerender(workspace(false));
    publishLiveRuns(["run-return"]);
    await act(async () => ended.resolve([]));
    view.rerender(workspace(true));
    await waitFor(() => expect(screen.getByRole("tab", { name: "run-return codex terminal" })).toHaveAttribute("aria-selected", "true"));
    expect(readStudioWorkspaceTarget("story-1")).toEqual({ kind: "terminal", agentRunId: "run-return" });
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "false");
  });
});

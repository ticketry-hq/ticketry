import { deferred, publishLiveRuns, terminalIntentFixture } from "./workspaceTerminalIntentFixture";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskWorkspace } from "../features/task-workspace";
import { readStudioWorkspaceTarget, rememberStudioWorkspaceTarget } from "../features/workspace-state/studioWorkspaceTarget";
import type { WorkItemEndedRunFixture } from "./desktopGraphQlRuntime";
import { useClientStore } from "../state/clientStore";
import { installDeferredWorkspaceDocuments, workspaceDocument } from "./renderedTaskWorkspaceDocumentFixture";
import { installWorkspaceViewerTransport } from "./renderedTaskWorkspaceTerminalFixture";

function workspace(workspaceActive: boolean, bucket = "story-1") {
  return <TaskWorkspace bucket={bucket} projectId="project-1" moduleId="module-1"
    owner="studio" workspaceActive={workspaceActive} details={<div>Issue details</div>} />;
}

describe("overhaul acceptance — retained workspace authority reentry", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

  it("[overhaul-844] keeps a hydrated remembered document selected and focused in its retained frame across configuration cover and return", async () => {
    installWorkspaceViewerTransport();
    const documents = installDeferredWorkspaceDocuments();
    useClientStore.setState({ sidebarVisible: false, editViewBodyEngaged: true, editViewZone: "active-tab-body" });
    rememberStudioWorkspaceTarget("story-a", { kind: "doc", relPath: "DESIGN.html" });
    const view = render(workspace(true, "story-a"));
    await documents.deliver("story-a", [workspaceDocument()]);
    await waitFor(() => expect(screen.getByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "true"));
    const frame = await screen.findByTitle("DESIGN", undefined, { timeout: 10_000 });
    await waitFor(() => expect(frame).toHaveFocus());

    view.rerender(workspace(false, "story-a"));
    view.rerender(workspace(true, "story-a"));

    await waitFor(() => expect(screen.getByRole("tab", { name: "DESIGN" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTitle("DESIGN")).toBe(frame);
    expect(frame).toBeVisible();
    await waitFor(() => expect(frame).toHaveFocus());
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "doc", relPath: "DESIGN.html" });
  });
});

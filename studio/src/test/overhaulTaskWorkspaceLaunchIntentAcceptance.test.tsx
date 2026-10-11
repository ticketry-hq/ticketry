import "./renderedTaskWorkspaceTerminalFixture";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModalHost } from "../app/modal/ModalHost";
import { TaskWorkspace } from "../features/task-workspace";
import { useTerminalStore } from "../features/agents/terminal";
import { useClientStore } from "../state/clientStore";
import { readStudioWorkspaceTarget, rememberStudioWorkspaceTarget } from "../features/workspace-state/studioWorkspaceTarget";
import { installDeferredWorkspaceLaunches } from "./renderedTaskWorkspaceLaunchFixture";

function workspace(taskId = "story-a") {
  return <><TaskWorkspace bucket={taskId} projectId="project-1" moduleId="module-1" owner="studio"
    launchContext={{ kind: "task", taskId, projectId: "project-1", moduleId: "module-1" }}
    details={<div>{taskId} details</div>} /><ModalHost /></>;
}

async function launch() {
  fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
  const picker = await screen.findByRole("dialog", { name: "Select Agent" });
  fireEvent.click(await within(picker).findByText("codex"));
}

function expectDetails(taskId = "story-a") {
  expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText(`${taskId} details`)).toBeVisible();
  expect(readStudioWorkspaceTarget(taskId)).toEqual({ kind: "details" });
  expect(document.activeElement?.getAttribute("aria-label")).not.toBe("Terminal input");
}

function expectRetainedRun(runId: string, taskId = "story-a") {
  const store = useTerminalStore.getState();
  const sessionId = store.sessionByRun[runId];
  expect(store.sessions[sessionId]).toMatchObject({ agentRunId: runId, taskId, projectId: "project-1", moduleId: "module-1" });
  expect(Object.values(store.sessions).filter((session) => session.agentRunId === runId)).toHaveLength(1);
}

describe("overhaul acceptance — launched terminal completion respects workspace intent", () => {
  let launches: ReturnType<typeof installDeferredWorkspaceLaunches>;
  beforeEach(() => { launches = installDeferredWorkspaceLaunches(); });
  afterEach(() => { cleanup(); useTerminalStore.setState({ sessions: {}, sessionByRun: {} }); vi.unstubAllGlobals(); });

  it("[overhaul-704] retains a launched run when its durable identity arrives after newer Details selection", async () => {
    useClientStore.setState({ sidebarVisible: false });
    render(workspace());
    await launch();
    await launches.request("story-a");
    const detailsTab = screen.getByRole("tab", { name: "Details" });
    fireEvent.click(detailsTab);
    const tabStrip = screen.getByRole("tablist", { name: "Workspace tabs" });
    tabStrip.focus();
    expect(tabStrip).toHaveFocus();
    await launches.deliver("story-a", "run-launched");
    await waitFor(() => expectRetainedRun("run-launched"));
    expectDetails();
    expect(tabStrip).toHaveFocus();
    expect(Object.keys(useTerminalStore.getState().sessionByRun)).toEqual(["run-launched"]);
  });

  it("[overhaul-705] remembers the exact launched run through temporary session rekey", async () => {
    render(workspace());
    await launch();
    await launches.request("story-a");
    await launches.deliver("story-a", "run-current");
    await waitFor(() => expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "terminal", agentRunId: "run-current" }));
    await waitFor(() => expect(useTerminalStore.getState().sessions["session-run-current"]).toMatchObject({
      sessionId: "session-run-current", agentRunId: "run-current", status: "ready",
    }));
    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute("aria-selected", "true");
    expectRetainedRun("run-current");
    expect(Object.keys(useTerminalStore.getState().sessions)).toEqual(["session-run-current"]);
  });

  it("[overhaul-706] retains a launched run after A to B without selecting or remembering its obsolete target", async () => {
    rememberStudioWorkspaceTarget("story-a", { kind: "details" });
    rememberStudioWorkspaceTarget("story-b", { kind: "details" });
    const { rerender } = render(workspace());
    await launch();
    await launches.request("story-a");
    rerender(workspace("story-b"));
    await launches.deliver("story-a", "run-away");
    expectRetainedRun("run-away");
    expectDetails("story-b");
    expect(screen.queryByRole("tab", { name: "codex terminal" })).not.toBeInTheDocument();
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "details" });
  });

  it("[overhaul-707] rejects an old launched run's persistence after A to B to A and a current Details intent", async () => {
    const { rerender } = render(workspace());
    await launch();
    await launches.request("story-a");
    rerender(workspace("story-b"));
    rerender(workspace());
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    await launches.deliver("story-a", "run-old-entry");
    expectRetainedRun("run-old-entry");
    expectDetails();
    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute("aria-selected", "false");
  });

  it("[overhaul-708] retains both launched run identities when the newer launch finishes before the older one", async () => {
    useClientStore.setState({ sidebarVisible: false });
    render(workspace());
    await launch();
    await launches.request("story-a");
    await launch();
    await launches.request("story-a", 1);
    await launches.deliver("story-a", "run-newer", 1);
    await waitFor(() => expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "terminal", agentRunId: "run-newer" }));
    let currentInput: HTMLElement | undefined;
    await waitFor(() => {
      currentInput = screen.getAllByRole("textbox", { name: "Terminal input" }).find((input) =>
        input.closest("[data-terminal-run-id]")?.getAttribute("data-terminal-run-id") === "run-newer");
      expect(currentInput).toBeDefined();
    });
    expect(currentInput!.closest("[data-terminal-run-id]")).toHaveAttribute("data-terminal-run-id", "run-newer");
    const tabStrip = screen.getByRole("tablist", { name: "Workspace tabs" });
    tabStrip.focus();
    expect(tabStrip).toHaveFocus();
    await launches.deliver("story-a", "run-older");
    expect(tabStrip).toHaveFocus();
    expectRetainedRun("run-newer");
    expectRetainedRun("run-older");
    expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "terminal", agentRunId: "run-newer" });
    expect(screen.getAllByRole("tab", { name: /codex.*terminal/ }).filter((tab) => tab.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(useTerminalStore.getState().sessionByRun).toEqual({
      "run-newer": expect.any(String), "run-older": expect.any(String),
    });
  });

  it("[overhaul-709] treats a picker commit after a newer Details selection as a fresh launch intent", async () => {
    render(workspace());
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    const picker = await screen.findByRole("dialog", { name: "Select Agent" });
    // The later explicit picker commit is allowed to replace the intervening tab intent.
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    fireEvent.click(await within(picker).findByText("codex"));
    await launches.deliver("story-a", "run-later-commit");
    await waitFor(() => expect(readStudioWorkspaceTarget("story-a")).toEqual({ kind: "terminal", agentRunId: "run-later-commit" }));
    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute("aria-selected", "true");
    expectRetainedRun("run-later-commit");
  });
});

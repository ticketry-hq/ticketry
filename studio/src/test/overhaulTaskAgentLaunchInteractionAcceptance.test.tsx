import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  providerCapability,
  setProviderCapabilities,
  terminalApi,
  terminalTransport,
  useTerminalStore,
  workspaceView,
} from "./taskAgentLaunchAcceptanceHarness";
import type { WorkspaceLauncherContext } from "./taskAgentLaunchAcceptanceHarness";

describe("overhaul acceptance — task agent launch interaction", () => {
  it("[overhaul-251] opens the shared provider picker from the workspace launcher", async () => {
    setProviderCapabilities([providerCapability("codex")]);
    render(
      workspaceView({
        launchContext: {
          kind: "task",
          taskId: "task-1417",
          projectId: "project-1417",
          moduleId: "module-1417",
        },
        bucket: "task-1417",
        projectId: "project-1417",
        moduleId: "module-1417",
      }),
    );

    const launcher = screen.getByRole("button", { name: "＋ Agent" });
    const tabScroller = screen.getByTestId("workspace-tab-scroll");
    expect(tabScroller).toHaveClass("overflow-x-auto");
    expect(tabScroller).not.toContainElement(launcher);

    fireEvent.click(launcher);

    const picker = await screen.findByRole("dialog", { name: "Select Agent" });
    expect(picker).toHaveTextContent("codex");
    expect(screen.queryByRole("menu", { name: "Launch agent" }))
      .not.toBeInTheDocument();
  });

  it("[overhaul-130] supports keyboard provider choice and returns focus when dismissed", async () => {
    setProviderCapabilities([
      providerCapability("claude"),
      providerCapability("codex"),
    ]);
    render(
      workspaceView({
        launchContext: {
          kind: "task",
          taskId: "task-572",
          projectId: "project-572",
          moduleId: "module-572",
        },
        bucket: "task-572",
        projectId: "project-572",
        moduleId: "module-572",
      }),
    );

    const launcher = screen.getByRole("button", { name: "＋ Agent" });
    launcher.focus();
    fireEvent.click(launcher);
    let picker = await screen.findByRole("dialog", { name: "Select Agent" });
    expect(within(picker).getByRole("button", { name: "Close dialog" }))
      .toHaveFocus();
    fireEvent.keyDown(picker, { key: "Escape" });
    await waitFor(() => expect(launcher).toHaveFocus());
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();

    fireEvent.click(launcher);
    picker = await screen.findByRole("dialog", { name: "Select Agent" });
    expect(within(picker).getByText("claude")).toBeVisible();
    expect(within(picker).getByText("codex")).toBeVisible();
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    fireEvent.keyDown(picker, { key: "Enter" });
    await waitFor(() => expect(terminalApi.createTerminalRun).toHaveBeenCalledTimes(1));
  });

  it("[overhaul-131] launches against the task context captured when the picker opens", async () => {
    terminalApi.createTerminalRun
      .mockResolvedValueOnce({ agent_run_id: "run-572-a" })
      .mockResolvedValueOnce({ agent_run_id: "run-572-b" });
    terminalTransport.attach.mockImplementation((params, onEvent) => {
      const handle = {
        input: vi.fn(),
        resize: vi.fn(),
        scroll: vi.fn(),
        detach: vi.fn(),
        status: vi.fn(() => "open"),
        resume: vi.fn(),
        suspend: vi.fn(),
      };
      queueMicrotask(() =>
        onEvent({
          type: "ready",
          sessionId: `terminal-${params.agentRunId}`,
          agentRunId: params.agentRunId,
        }),
      );
      return handle;
    });
    const context = {
      kind: "task" as const,
      taskId: "task-572",
      projectId: "project-572",
      moduleId: "module-572",
    };
    const view = (launchContext: WorkspaceLauncherContext, bucket = "task-572") =>
      workspaceView({
        launchContext,
        bucket,
        projectId: "project-572",
        moduleId: "module-572",
      });
    const mounted = render(view(context));
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    const picker = await screen.findByRole("dialog", { name: "Select Agent" });
    mounted.rerender(
      view({ ...context, taskId: "replacement-task" }),
    );
    fireEvent.click(within(picker).getByText("codex"));
    await waitFor(() => expect(terminalApi.createTerminalRun).toHaveBeenCalledTimes(1));
    expect(terminalApi.createTerminalRun).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: "task-572" }),
    );
    await waitFor(() =>
      expect(useTerminalStore.getState().sessions["terminal-run-572-a"]).toMatchObject({
        taskId: "task-572",
      }),
    );

    mounted.rerender(view(context));
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    const secondPicker = await screen.findByRole("dialog", { name: "Select Agent" });
    fireEvent.click(within(secondPicker).getByText("codex"));
    await waitFor(() => expect(terminalApi.createTerminalRun).toHaveBeenCalledTimes(2));
    // Launch-state projection can arrive after the tab. Provider fallbacks keep
    // both tabs named and visibly distinct during that gap.
    expect(screen.getAllByRole("tab", { name: /^codex [12] terminal$/ }))
      .toHaveLength(2);
    expect(screen.getByRole("tab", { name: "codex 1 terminal" }))
      .toHaveTextContent("codex 1");
    expect(screen.getByRole("tab", { name: "codex 2 terminal" }))
      .toHaveTextContent("codex 2");
  });
});

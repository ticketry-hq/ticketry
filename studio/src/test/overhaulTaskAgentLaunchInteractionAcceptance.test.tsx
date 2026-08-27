import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("[overhaul-130] supports keyboard choice and dismisses without stealing focus or pointer actions", async () => {
    const outsidePress = vi.fn();
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
          taskKey: "CODING-572",
          taskName: "Harden launcher",
          profileReady: true,
          profile: null,
        },
        bucket: "task-572",
        projectId: "project-572",
        moduleId: "module-572",
        children: (
          <button type="button" onPointerDown={outsidePress}>
            Outside action
          </button>
        ),
      }),
    );

    const launcher = screen.getByRole("button", { name: "＋ Agent" });
    fireEvent.click(launcher);
    expect(screen.getByRole("menuitem", { name: "claude" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(screen.getByRole("menuitem", { name: "codex" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Home" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "codex" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(launcher).toHaveFocus();
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();

    fireEvent.click(launcher);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside action" }));
    expect(outsidePress).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(launcher);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "codex" }), { key: "Enter" });
    await waitFor(() => expect(terminalApi.createTerminalRun).toHaveBeenCalledTimes(1));
  });

  it("[overhaul-131] invalidates changed launch context and commits once per intentional opening", async () => {
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
      taskKey: "CODING-572",
      taskName: "Harden launcher",
      profileReady: true,
      profile: null,
    };
    const view = (launchContext: WorkspaceLauncherContext, bucket = "task-572") =>
      workspaceView({
        launchContext,
        bucket,
        projectId: "project-572",
        moduleId: "module-572",
      });
    const mounted = render(view(context));
    const launcher = screen.getByRole("button", { name: "＋ Agent" });
    fireEvent.click(launcher);
    mounted.rerender(view({ ...context, moduleId: "module-572-alt" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    mounted.rerender(view(context));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    mounted.rerender(
      view({ ...context, taskId: "replacement-task", taskKey: "CODING-999" }),
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();

    mounted.rerender(view(context));
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    mounted.rerender(view(context, "another-workspace"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    mounted.rerender(view(context));
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    mounted.rerender(
      view({
        kind: "scratch",
        profileReady: true,
        onChooseMode: vi.fn(),
      }),
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();

    mounted.rerender(view(context));
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    const committedChoice = screen.getByRole("menuitem", { name: "codex" });
    fireEvent.click(committedChoice);
    fireEvent.click(committedChoice);
    await waitFor(() => expect(terminalApi.createTerminalRun).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(useTerminalStore.getState().sessions["terminal-run-572-a"]).toMatchObject({
        taskId: "task-572",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "codex" }));
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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  terminalApi,
  terminalTransport,
  useTerminalStore,
  workspaceView,
} from "./taskAgentLaunchAcceptanceHarness";

describe("overhaul acceptance — pending task agent launch navigation", () => {
  it("[overhaul-78] completes pending launch acknowledgement after navigating away", async () => {
    let acknowledgeCreate!: (value: { agent_run_id: string }) => void;
    terminalApi.createTerminalRun.mockReturnValue(
      new Promise((resolve) => {
        acknowledgeCreate = resolve;
      }),
    );
    terminalTransport.attach.mockImplementation((_params, onEvent) => {
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
          sessionId: "terminal-574",
          agentRunId: "run-574",
        }),
      );
      return handle;
    });
    render(
      workspaceView({
        launchContext: {
          kind: "task",
          taskId: "task-574",
          projectId: "project-574",
          moduleId: "module-574",
          taskKey: "CODING-574",
          taskName: "Retain pending task launch",
          ticketSeq: 574,
          profileReady: true,
          profile: null,
        },
        bucket: "task-574",
        projectId: "project-574",
        moduleId: "module-574",
        ticketSeq: 574,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "codex" }));
    await waitFor(() => expect(terminalApi.createTerminalRun).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    acknowledgeCreate({ agent_run_id: "run-574" });

    await waitFor(() =>
      expect(terminalTransport.attach).toHaveBeenCalledWith(
        expect.objectContaining({ agentRunId: "run-574" }),
        expect.any(Function),
      ),
    );
    await waitFor(() =>
      expect(useTerminalStore.getState().sessions["terminal-574"]).toMatchObject({
        taskId: "task-574",
        agentRunId: "run-574",
        status: "ready",
      }),
    );
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

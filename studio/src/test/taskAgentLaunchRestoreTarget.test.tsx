import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  terminalApi,
  useTerminalStore,
  workspaceView,
} from "./taskAgentLaunchAcceptanceHarness";
import {
  readStudioWorkspaceTarget,
  rememberStudioWorkspaceTarget,
} from "../app/shell/ticket-workspace/selected-ticket/internal/studioWorkspaceTarget";

const TASK_CONTEXT = {
  kind: "task" as const,
  taskId: "task-570",
  projectId: "project-570",
  moduleId: "module-570",
  taskKey: "CODING-570",
  taskName: "Remember the launched run as the workspace target",
};

const OTHER_TASK_CONTEXT = {
  kind: "task" as const,
  taskId: "task-575",
  projectId: "project-575",
  moduleId: "module-575",
  taskKey: "CODING-575",
  taskName: "Some other ticket visited in between",
};

describe("launched task run as the studio workspace restore target", () => {
  beforeEach(() => {
    localStorage.removeItem("studio.activeWorkspaceByBucket:v1");
  });

  it("restores the run launched from ＋ Agent after leaving and re-entering the ticket", async () => {
    // The ticket already carries a durable target from an earlier visit; the
    // launch has to replace it, or coming back lands on Details (CODING-1436).
    rememberStudioWorkspaceTarget("task-570", { kind: "details" });

    const view = render(workspaceView({ launchContext: TASK_CONTEXT }));

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    const picker = await screen.findByRole("dialog", { name: "Select Agent" });
    fireEvent.click(within(picker).getByText("codex"));

    await waitFor(() => expect(terminalApi.createTerminalRun).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(useTerminalStore.getState().sessions["terminal-570"]).toMatchObject({
        agentRunId: "run-570",
        status: "ready",
      }),
    );

    // The launched run is now the remembered surface for this bucket.
    await waitFor(() =>
      expect(readStudioWorkspaceTarget("task-570")).toEqual({
        kind: "terminal",
        agentRunId: "run-570",
      }),
    );

    // Navigate to another ticket, then back to this one.
    view.rerender(
      workspaceView({
        launchContext: OTHER_TASK_CONTEXT,
        bucket: "task-575",
        projectId: "project-575",
        moduleId: "module-575",
      }),
    );
    view.rerender(workspaceView({ launchContext: TASK_CONTEXT }));

    const terminalTab = await screen.findByRole("tab", { name: "codex terminal" });
    await waitFor(() =>
      expect(terminalTab).toHaveAttribute("aria-selected", "true"),
    );
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});

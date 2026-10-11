import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ToastHost from "../app/shell/ToastHost";
import {
  providerCapability,
  setProviderCapabilities,
  terminalApi,
  workspaceView,
} from "./taskAgentLaunchAcceptanceHarness";

const context = {
  kind: "task" as const,
  taskId: "task-2763",
  projectId: "project-2763",
  moduleId: "module-2763",
};

function pickCodex() {
  fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
  return screen.findByRole("dialog", { name: "Select Agent" }).then((picker) =>
    fireEvent.click(within(picker).getByText("codex")),
  );
}

describe("explicit Agent Picker launch recovery (CODING-2763)", () => {
  it("shows dismissible feedback for a refused launch, leaves no phantom terminal tab, and retries", async () => {
    setProviderCapabilities([providerCapability("codex")]);
    terminalApi.createTerminalRun
      .mockRejectedValueOnce(new Error("forced launch recovery failure"))
      .mockResolvedValueOnce({ agent_run_id: "run-2763" });
    render(
      workspaceView({
        launchContext: context,
        bucket: context.taskId,
        projectId: context.projectId,
        moduleId: context.moduleId,
        children: <ToastHost />,
      }),
    );

    await pickCodex();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Agent run could not be started: forced launch recovery failure",
    );
    await waitFor(() =>
      expect(screen.queryByRole("tab", { name: /codex.*terminal/ })).toBeNull(),
    );
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    await pickCodex();

    await waitFor(() => expect(terminalApi.createTerminalRun).toHaveBeenCalledTimes(2));
    expect(terminalApi.createTerminalRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ agent: "codex", task_id: context.taskId }),
    );
    expect(await screen.findByRole("tab", { name: /codex.*terminal/ })).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

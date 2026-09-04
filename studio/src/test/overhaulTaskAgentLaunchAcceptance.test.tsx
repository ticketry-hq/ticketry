import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  providerApi,
  providerCapability,
  setProviderCapabilities,
  terminalApi,
  useTerminalStore,
  workspaceView,
} from "./taskAgentLaunchAcceptanceHarness";
import type { WorkspaceLauncherContext } from "./taskAgentLaunchAcceptanceHarness";
import { studioApolloClient } from "../shared/apollo/client";

function clearProviderHolding(): void {
  studioApolloClient().cache.evict({ id: "ROOT_QUERY", fieldName: "provider_catalog" });
  studioApolloClient().cache.gc();
}

describe("overhaul acceptance — task agent launch", () => {
  it("[overhaul-128] launches one promptless task run and activates its acknowledged terminal tab", async () => {
    render(
      workspaceView({
        launchContext: {
          kind: "task",
          taskId: "task-570",
          projectId: "project-570",
          moduleId: "module-570",
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "codex" }));

    await waitFor(() =>
      expect(terminalApi.createTerminalRun).toHaveBeenCalledWith({
        agent: "codex",
        project_id: "project-570",
        module_id: "module-570",
        task_id: "task-570",
        initial_prompt: null,
        is_planning: false,
        is_instant: false,
        instant_prompt: null,
      }),
    );
    expect(terminalApi.createTerminalRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const terminalTab = await screen.findByRole("tab", {
      name: "codex terminal",
    });
    expect(terminalTab).toHaveAttribute("aria-selected", "true");
    expect(useTerminalStore.getState().sessions["terminal-570"]).toMatchObject({
      sessionId: "terminal-570",
      taskId: "task-570",
      projectId: "project-570",
      moduleId: "module-570",
      agent: "codex",
      agentRunId: "run-570",
      status: "ready",
      initialPrompt: null,
      isPlanning: false,
      isInstant: false,
    });
  });

  it("[overhaul-129] honors provider availability without changing the scratch launcher", async () => {
    const taskContext = {
      kind: "task" as const,
      taskId: "task-571",
      projectId: "project-571",
      moduleId: "module-571",
    };
    const renderLauncher = (launchContext: WorkspaceLauncherContext = taskContext) =>
      render(
        workspaceView({
          launchContext,
          bucket: "task-571",
          projectId: "project-571",
          moduleId: "module-571",
        }),
      );

    setProviderCapabilities([
      providerCapability("codex"),
      providerCapability("claude"),
      providerCapability("codex"),
      providerCapability("unsupported-provider"),
    ]);
    let mounted = renderLauncher();
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    expect(screen.getAllByRole("menuitem", { name: "codex" })).toHaveLength(1);
    expect(screen.getAllByRole("menuitem", { name: "claude" })).toHaveLength(1);
    expect(screen.queryByRole("menuitem", { name: "gemini" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "unsupported-provider" })).not.toBeInTheDocument();
    mounted.unmount();

    clearProviderHolding();
    providerApi.getLaunchProviderCapabilities.mockReturnValue(new Promise(() => {}));
    mounted = renderLauncher();
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    expect(screen.getByText("Loading providers…")).toBeVisible();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    mounted.unmount();

    clearProviderHolding();
    providerApi.getLaunchProviderCapabilities.mockRejectedValue(
      new Error("provider discovery failed"),
    );
    mounted = renderLauncher();
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    expect(await screen.findByText("Providers unavailable — retry.")).toBeVisible();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    mounted.unmount();

    setProviderCapabilities([]);
    mounted = renderLauncher();
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    expect(
      screen.getByText(
        "No activated providers. Activate one in Settings → Model configuration.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();
    mounted.unmount();

    setProviderCapabilities([providerCapability("codex")]);
    const chooseScratchMode = vi.fn();
    renderLauncher({
      kind: "scratch",
      onChooseMode: chooseScratchMode,
    });
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    expect(screen.getByRole("menuitem", { name: "Plan" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Instant" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "codex" })).not.toBeInTheDocument();
  });
});

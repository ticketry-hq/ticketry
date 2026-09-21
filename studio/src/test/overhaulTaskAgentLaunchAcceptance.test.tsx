import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  clearProviderHolding,
  providerApi,
  providerCapability,
  shellApi,
  setProviderCapabilities,
  terminalApi,
  TerminalPanel,
  useClientStore,
  useStudioStore,
  useTerminalStore,
  workspaceView,
} from "./taskAgentLaunchAcceptanceHarness";
import type { WorkspaceLauncherContext } from "./taskAgentLaunchAcceptanceHarness";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { initializeStudioRuntime } from "../runtime";

const { WorktreeBlock } = await import(
  "../features/agents/worktrees/WorktreeBlock"
);
const { DialogHost } = await import("../app/shell/DialogHost");

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
    const picker = await screen.findByRole("dialog", { name: "Select Agent" });
    fireEvent.click(within(picker).getByText("codex"));

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
    // The xterm renderer chunk loads lazily, so the viewer that acknowledges
    // the run under its server id attaches a tick after the tab appears.
    await waitFor(() =>
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
      }),
    );
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
    let picker = await screen.findByRole("dialog", { name: "Select Agent" });
    expect(within(picker).getByText("codex")).toBeVisible();
    expect(within(picker).getByText("claude")).toBeVisible();
    expect(within(picker).queryByText("gemini")).not.toBeInTheDocument();
    expect(within(picker).queryByText("unsupported-provider")).not.toBeInTheDocument();
    mounted.unmount();

    clearProviderHolding();
    providerApi.getLaunchProviderCapabilities.mockReturnValue(new Promise(() => {}));
    mounted = renderLauncher();
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    picker = await screen.findByRole("dialog", { name: "Select Agent" });
    expect(within(picker).getByText("Loading providers…")).toBeVisible();
    mounted.unmount();

    clearProviderHolding();
    providerApi.getLaunchProviderCapabilities.mockRejectedValue(
      new Error("provider discovery failed"),
    );
    mounted = renderLauncher();
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    picker = await screen.findByRole("dialog", { name: "Select Agent" });
    expect(await within(picker).findByText("Providers unavailable — retry.")).toBeVisible();
    mounted.unmount();

    setProviderCapabilities([]);
    mounted = renderLauncher();
    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    picker = await screen.findByRole("dialog", { name: "Select Agent" });
    expect(
      within(picker).getByText(
        "No activated providers. Activate one in Settings → Model configuration.",
      ),
    ).toBeVisible();
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
    expect(screen.queryByRole("dialog", { name: "Select Agent" }))
      .not.toBeInTheDocument();
  });

  it("[overhaul-337] launches a plain module terminal from the task Agent picker", async () => {
    useClientStore.setState({ selectedModuleId: "module-570" });
    useStudioStore.setState({ selectedProjectId: "project-570" });

    render(
      <>
        {workspaceView({
          launchContext: {
            kind: "task",
            taskId: "task-570",
            projectId: "project-570",
            moduleId: "module-570",
          },
        })}
        <TerminalPanel />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    const picker = await screen.findByRole("dialog", { name: "Select Agent" });
    fireEvent.click(within(picker).getByText("Terminal"));

    expect(await screen.findByTestId("terminal-panel")).toBeVisible();
    await waitFor(() =>
      expect(shellApi.createModuleShell).toHaveBeenCalledWith("module-570"),
    );
    await waitFor(() => {
      const sessionId = useTerminalStore.getState().sessionByRun["run-shell-570"];
      expect(useTerminalStore.getState().sessions[sessionId]).toMatchObject({
        moduleId: "module-570",
        agent: null,
        isShell: true,
      });
    });
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates an Agent Run after approving trust for a newly created worktree", async () => {
    const taskId = "60000000-0000-0000-0000-000000000001";
    const absent = {
      __typename: "WorktreeStatusView",
      kind: "none",
      task_id: taskId,
      top_level_task_id: taskId,
      is_shared: false,
      branch: null,
      base_branch: null,
      path: null,
      state: null,
      clean: null,
      dirty: null,
      ahead: null,
      behind: null,
      conflict: null,
      checkout_present: null,
      ephemeral: false,
      reason: null,
    };
    const created = {
      ...absent,
      kind: "worktree",
      branch: "wt/CODIN-1992-provider-trust",
      base_branch: "main",
      path: "/checkouts/ticketry/CODIN-1992-provider-trust",
      state: "active",
      clean: true,
      dirty: false,
      ahead: 0,
      behind: 0,
      conflict: false,
      checkout_present: true,
    };
    let worktreeCreated = false;
    const trust = vi.fn(async (provider: string, approval: string | null) => ({
      status: approval ? "prepared" as const : "approval_required" as const,
      approval: approval ? null : `${provider}-approval`,
      directory: created.path,
    }));
    await initializeStudioRuntime(
      await createDesktopRuntime({
        invoke: vi.fn(
          async (command: string, args?: Record<string, unknown>) => {
            if (command === "desktop_runtime_configuration") {
              return {
                serviceHealth: {
                  state: "ready",
                  service: "backend",
                  message: null,
                  logPointer: null,
                },
                initialNotices: [],
              };
            }
            if (command === "desktop_prepare_directory_trust") {
              return trust(
                args?.provider as string,
                (args?.approval as string | null) ?? null,
              );
            }
            throw new Error(`Unexpected command ${command}`);
          },
        ) as never,
        createGraphQlProxy: () => ({
          graphql_execute: vi.fn(async (requestJson: string) => {
            const request = JSON.parse(requestJson) as {
              operationName: string;
            };
            if (request.operationName === "WorktreeStatus") {
              return JSON.stringify({
                data: {
                  worktree_status: worktreeCreated ? created : absent,
                },
              });
            }
            if (request.operationName === "WorktreeCreate") {
              worktreeCreated = true;
              return JSON.stringify({ data: { worktree_create: created } });
            }
            throw new Error(`Unexpected operation ${request.operationName}`);
          }),
          graphql_subscribe: vi.fn(),
        }) as never,
      }),
    );
    setProviderCapabilities([providerCapability("codex")]);

    render(workspaceView({
      launchContext: {
        kind: "task",
        taskId,
        projectId: "project-1992",
        moduleId: "module-1992",
      },
      bucket: taskId,
      projectId: "project-1992",
      moduleId: "module-1992",
      children: (
        <>
          <WorktreeBlock taskId={taskId} moduleId="module-1992" />
          <DialogHost />
        </>
      ),
    }));

    fireEvent.click(
      await screen.findByRole("button", { name: "+ Create worktree" }),
    );
    const trustDialog = await screen.findByRole("dialog", {
      name: "Trust worktree?",
    });
    fireEvent.click(
      within(trustDialog).getByRole("button", { name: "Trust worktree" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Trust worktree?" }),
      ).toBeNull()
    );

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    fireEvent.click(
      within(
        await screen.findByRole("dialog", { name: "Select Agent" }),
      ).getByText("codex"),
    );

    await waitFor(() =>
      expect(terminalApi.createTerminalRun).toHaveBeenCalledWith({
        agent: "codex",
        project_id: "project-1992",
        module_id: "module-1992",
        task_id: taskId,
        initial_prompt: null,
        is_planning: false,
        is_instant: false,
        instant_prompt: null,
      })
    );
    await waitFor(() =>
      expect(
        useTerminalStore.getState().sessions["terminal-570"],
      ).toMatchObject({
        agentRunId: "run-570",
        taskId,
        status: "ready",
      })
    );
  });
});

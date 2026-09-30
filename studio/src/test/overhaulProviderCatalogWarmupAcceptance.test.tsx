import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  clearProviderHolding,
  providerApi,
  providerCapability,
  setProviderCapabilities,
  terminalApi,
  workspaceView,
} from "./taskAgentLaunchAcceptanceHarness";

const taskContext = {
  kind: "task" as const,
  taskId: "task-1463",
  projectId: "project-1463",
  moduleId: "module-1463",
};

const renderLauncher = () =>
  render(
    workspaceView({
      launchContext: taskContext,
      bucket: "task-1463",
      projectId: "project-1463",
      moduleId: "module-1463",
    }),
  );

describe("overhaul acceptance — provider catalog warm", () => {
  it("[overhaul-260] warms the provider catalog before the agent picker can open, so its first open is a usable provider list", async () => {
    clearProviderHolding();
    // Nothing but the warm may fill the list: the query the picker issues for
    // itself never lands, so whatever the first open shows came from the
    // launcher having warmed the catalog while it was still on screen.
    providerApi.getLaunchProviderCapabilities.mockReturnValue(new Promise(() => {}));
    providerApi.prefetchProviderCatalog.mockImplementation(() => {
      setProviderCapabilities([providerCapability("codex")]);
      providerApi.getLaunchProviderCapabilities.mockReturnValue(new Promise(() => {}));
    });

    renderLauncher();

    // The launcher is mounted long before the click, and warms from there, so
    // every route into the picker — this trigger, the sidebar launch keys, a
    // prompt-first chain — finds the catalog loaded.
    const trigger = screen.getByRole("button", { name: "＋ Agent" });
    expect(providerApi.prefetchProviderCatalog).toHaveBeenCalledTimes(1);

    // Hover and focus retry the warm, so an attempt that failed while the
    // workspace was opening still resolves before the run is started.
    fireEvent.pointerEnter(trigger);
    expect(providerApi.prefetchProviderCatalog).toHaveBeenCalledTimes(2);
    fireEvent.focus(trigger);
    expect(providerApi.prefetchProviderCatalog).toHaveBeenCalledTimes(3);

    fireEvent.click(trigger);
    const picker = await screen.findByRole("dialog", { name: "Select Agent" });
    expect(within(picker).queryByText("Loading providers…")).not.toBeInTheDocument();
    expect(within(picker).getByText("codex")).toBeVisible();

    // The list is actionable on that first open — confirm launches instead of
    // falling through an empty selection.
    fireEvent.keyDown(picker, { key: "Enter" });
    await waitFor(() =>
      expect(terminalApi.createTerminalRun).toHaveBeenCalledWith({
        agent: "codex",
        project_id: "project-1463",
        module_id: "module-1463",
        task_id: "task-1463",
        initial_prompt: null,
        is_planning: false,
        is_instant: false,
        instant_prompt: null,
      }),
    );
  });
});

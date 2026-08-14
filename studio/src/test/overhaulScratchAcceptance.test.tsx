import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { SelectedTicketDetails } from "../app/shell/ticket-workspace/selected-ticket/details/SelectedTicketDetails";
import { useAgentStatusStore } from "../features/agents/status";
import { scratchBucketId, useTerminalStore } from "../features/agents/terminal";
import { TEMP_TASK_ID } from "../features/agents/types";
import { useStudioStore } from "../features/projects/store";
import { seedConfig } from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";

describe("overhaul acceptance — module scratch workspace", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    seedConfig({ features: { sidebar: true, projects: true } });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: TEMP_TASK_ID,
      workspaceSelection: { kind: "task" },
      workspaces: {},
      activeByTask: {},
      sidebarVisible: true,
    });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {},
      automationAttempts: {},
      automationByTask: {},
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("[]", { headers: { "Content-Type": "application/json" } }),
    ));
  });

  it("[overhaul-13] opens a module scratch workspace, launches, and shows its run summary", async () => {
    const launch = vi.fn((mode: "plan" | "instant") => {
      useAgentStatusStore.getState().upsertRun({
        agent_run_id: "scratch-run-1",
        task_id: null,
        module_id: "module-1",
        scope: mode,
        state: "working",
        started_at: "2026-08-07T12:00:00Z",
        updated_at: "2026-08-07T12:00:00Z",
      });
    });

    render(
      <SelectedTicketContent
        bucket={scratchBucketId("module-1")}
        projectId="project-1"
        moduleId="module-1"
        owner="studio"
        details={<SelectedTicketDetails />}
        launchContext={{
          kind: "scratch",
          profileReady: true,
          onChooseMode: launch,
        }}
      />,
    );

    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("No active Scratch runs.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Plan" }));

    expect(launch).toHaveBeenCalledWith("plan");
    expect(await screen.findByTestId("scratch-run-chicklets")).toHaveTextContent(
      "▶1",
    );
  });

  it("[overhaul-73] clears a ghost scratch badge when the authoritative snapshot omits its foreign or orphaned run", () => {
    useAgentStatusStore.getState().upsertRun({
      agent_run_id: "foreign-ghost",
      project_id: "project-1",
      task_id: null,
      module_id: "module-1",
      agent: "codex",
      scope: "instant",
      state: "working",
      started_at: "2026-08-10T12:00:00Z",
      updated_at: "2026-08-10T12:00:00Z",
    });

    render(<SelectedTicketDetails />);
    expect(screen.getByTestId("scratch-run-chicklets")).toHaveTextContent("▶1");

    act(() => {
      useAgentStatusStore.getState().reconcileScope(
        { project_id: "project-1", task_id: null },
        [],
        "2026-08-12T12:00:00Z",
      );
    });

    expect(screen.getByText("No active Scratch runs.")).toBeVisible();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import { StudioFooter } from "../app/shell/StudioFooter";
import { useStudioStore } from "../features/projects/store";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";

const workflowApi = vi.hoisted(() => ({
  getIssueTypes: vi.fn(),
  getStates: vi.fn(),
  getProjectWorkItems: vi.fn(),
  getLaunchProviderCapabilities: vi.fn(),
  getIssueTypeWorkflowSettings: vi.fn(),
}));

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...workflowApi,
}));

describe("overhaul acceptance — settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useModalStore.setState({
      modalStack: [],
      presentedNoticeIds: new Set(),
    });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useWorkflowEditorStore.setState(
      useWorkflowEditorStore.getInitialState(),
      true,
    );
    workflowApi.getIssueTypes.mockResolvedValue([{
      id: "story",
      project: "project-1",
      name: "Story",
      level: "task",
      color: null,
      sort_order: 0,
      start_state: "todo",
      workflow_revision: 3,
    }]);
    workflowApi.getStates.mockResolvedValue([{
      id: "todo",
      name: "Todo",
      group: "unstarted",
      color: "#64748b",
      sort_order: 0,
    }]);
    workflowApi.getProjectWorkItems.mockResolvedValue([]);
    workflowApi.getLaunchProviderCapabilities.mockResolvedValue([]);
    workflowApi.getIssueTypeWorkflowSettings.mockResolvedValue({
      issue_type_id: "story",
      start_state_id: "todo",
      workflow_revision: 3,
      transitions: [],
      launch_bindings: [],
      warnings: [],
    });
  });

  it("[overhaul-22] cold-opens Settings and loads the selected project catalog", async () => {
    render(
      <>
        <StudioFooter />
        <ModalHost />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));

    expect(await screen.findByRole("dialog", { name: "Studio settings" }))
      .toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "State catalog" }))
      .toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "State name for Todo" }))
      .toHaveValue("Todo");
    expect(workflowApi.getIssueTypes).toHaveBeenCalledWith("project-1");
    expect(workflowApi.getIssueTypeWorkflowSettings).toHaveBeenCalledWith(
      "project-1",
      "story",
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Todo" }));
    expect(await screen.findByRole("dialog", { name: "Delete Todo?" }))
      .toHaveTextContent("referenced by workflow configuration");
  });
});

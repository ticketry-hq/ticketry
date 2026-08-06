import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { SelectedTicket } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicket";
import type { TaskState, TaskSummary } from "../features/studio/lib/types";
import { seedConfig } from "../features/studio/stores/configStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useClientStore } from "../state/clientStore";

vi.mock("../features/agents/lifecycle", () => ({
  AgentStateBadge: () => null,
  AutomationFailureChicklet: () => null,
  ScratchStateBadge: () => null,
}));

vi.mock("../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent", async () => {
  const React = await import("react");
  let nextHostId = 0;
  return {
    SelectedTicketContent: () => {
      const hostId = React.useRef<number | null>(null);
      const [value, setValue] = React.useState("live terminal and document");
      if (hostId.current === null) hostId.current = ++nextHostId;
      return (
        <button
          type="button"
          data-testid="mounted-workspace-host"
          onClick={() => setValue((current) => `${current}!`)}
        >
          {hostId.current}:{value}
        </button>
      );
    },
  };
});

const REVIEW: TaskState = {
  id: "review",
  name: "Review",
  group: "started",
  color: "#aabbcc",
  sort_order: 0,
};
const DONE: TaskState = {
  id: "done",
  name: "Done",
  group: "completed",
  color: "#abcdef",
  sort_order: 1,
};
const NO_STATE: TaskState = {
  id: null,
  name: "No state",
  group: "",
  color: null,
};

const STORY: TaskSummary = {
  id: "story-1",
  name: "Story",
  project_id: "project-1",
  sequence_id: 1,
  issue_type: { id: "type-story", name: "Story", level: "task" },
  state: REVIEW,
  description: null,
  parent_id: "module-1",
  sub_issues_count: 0,
};

function activateByKeyboard(control: HTMLElement): void {
  control.focus();
  fireEvent.keyDown(control, { key: "Enter" });
  // Browsers synthesize this click for Enter on a native button. jsdom leaves
  // that UA default to the test driver, so model the resulting activation.
  fireEvent.click(control, { detail: 0 });
  fireEvent.keyUp(control, { key: "Enter" });
}

describe("State configuration workspace selection", () => {
  beforeEach(() => {
    seedConfig({
      profiles: [
        {
          name: "Local",
          workspace_slug: "meml",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [
            { module_id: "module-1", path: "/repos/module-1" },
            { module_id: "module-2", path: "/repos/module-2" },
          ],
          recent_project_id: "project-1",
          recent_module_ids: {},
        },
      ],
      recentProfileIndex: 0,
    });
    useClientStore.setState({
      collapsedStateIds: new Set(),
      expandedIdsByModule: {},
      storySearchQuery: "",
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: STORY.id,
      workspaceSelection: { kind: "task" },
      tasks: [STORY, { ...STORY, id: "unassigned", state: NO_STATE }],
      states: [REVIEW, DONE],
      subtasks: {},
      details: null,
      loading: {
        projects: false,
        modules: false,
        tasks: false,
        details: false,
        subtasks: false,
      },
      pendingReorderTaskIds: new Set(),
    });
  });

  it("keeps header collapse and state configuration as separate pointer and keyboard actions", () => {
    render(<TasksPane />);

    const reviewHeader = screen.getByRole("button", { name: "Collapse Review" });
    const reviewSettings = screen.getByRole("button", {
      name: "Configure Review state",
    });
    expect(screen.queryByRole("button", { name: "Configure No state state" })).toBeNull();

    fireEvent.click(reviewSettings);
    expect(useTasksStore.getState().workspaceSelection).toEqual({
      kind: "state-configuration",
      projectId: "project-1",
      stateId: "review",
    });
    expect(reviewHeader).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(reviewHeader);
    expect(reviewHeader).toHaveAttribute("aria-expanded", "false");
    expect(useTasksStore.getState().workspaceSelection.kind).toBe(
      "state-configuration",
    );

    activateByKeyboard(reviewSettings);
    expect(useTasksStore.getState().workspaceSelection).toEqual({ kind: "task" });
  });

  it("toggles, switches, closes, and dismisses the overlay without remounting the workspace", async () => {
    render(
      <>
        <TasksPane />
        <SelectedTicket />
      </>,
    );

    const host = screen.getByTestId("mounted-workspace-host");
    fireEvent.click(host);
    const preservedHostText = host.textContent;
    const reviewSettings = screen.getByRole("button", {
      name: "Configure Review state",
    });

    fireEvent.click(reviewSettings);
    expect(screen.getByRole("region", { name: "Review state configuration" })).toBeVisible();
    expect(screen.getByTestId("mounted-workspace-host")).toBe(host);
    expect(host).toHaveTextContent(preservedHostText!);

    fireEvent.click(reviewSettings);
    expect(screen.queryByTestId("state-configuration-panel")).toBeNull();

    fireEvent.click(reviewSettings);
    activateByKeyboard(screen.getByRole("button", { name: "Configure Done state" }));
    expect(screen.getByRole("region", { name: "Done state configuration" })).toBeVisible();

    const closeButton = screen.getByRole("button", {
      name: "Close Done state configuration",
    });
    expect(closeButton).toHaveTextContent("×");
    fireEvent.click(closeButton);
    expect(screen.queryByTestId("state-configuration-panel")).toBeNull();

    useTasksStore.getState().toggleStateConfiguration("project-1", REVIEW.id!);
    await useTasksStore.getState().selectTask(STORY.id).catch(() => undefined);
    expect(useTasksStore.getState().workspaceSelection).toEqual({ kind: "task" });

    useTasksStore.getState().toggleStateConfiguration("project-1", REVIEW.id!);
    await useTasksStore.getState().selectModule("module-2").catch(() => undefined);
    expect(useTasksStore.getState().workspaceSelection).toEqual({ kind: "task" });

    useTasksStore.setState({ selectedProjectId: "project-1" });
    useTasksStore.getState().toggleStateConfiguration("project-1", REVIEW.id!);
    await useTasksStore.getState().selectProject("project-2").catch(() => undefined);
    expect(useTasksStore.getState().workspaceSelection).toEqual({ kind: "task" });
    expect(screen.getByTestId("mounted-workspace-host")).toBe(host);
    expect(host).toHaveTextContent(preservedHostText!);
  });
});

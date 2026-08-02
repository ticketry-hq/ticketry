import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskState, TaskSummary } from "../features/studio/lib/types";
import { TasksPane } from "../features/studio/pages/tasks/TasksPane";
import {
  stageIconForName,
} from "../features/studio/pages/tasks/components/StateHeaderRow";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";
import {
  IconCheckCircle,
  IconGrill,
  IconImplement,
  IconList,
  IconReview,
  IconSpec,
  IconTickets,
  IconX,
} from "../shared/ui/icons";

vi.mock("../features/agents/lifecycle", () => ({
  AgentStateBadge: () => null,
  AutomationFailureChicklet: () => null,
  ScratchStateBadge: () => null,
}));

const STATE_NAMES = [
  "Grill",
  "Spec",
  "Tickets",
  "Implement",
  "Review",
  "Done",
  "Cancelled",
  "Project Custom",
] as const;

const STATES: TaskState[] = STATE_NAMES.map((name, index) => ({
  id: `state-${index}`,
  name,
  group: index === 5 ? "completed" : index === 6 ? "cancelled" : "started",
  color: `#${(index + 1).toString(16).repeat(6)}`,
  sort_order: index,
}));

const STORY: TaskSummary = {
  id: "story-1",
  name: "Story",
  project_id: "project-1",
  sequence_id: 1,
  issue_type: { id: "type-story", name: "Story", level: "task" },
  state: STATES[0],
  description: null,
  parent_id: "module-1",
  sub_issues_count: 0,
};

describe("Studio state header stage icons", () => {
  beforeEach(() => {
    useUIStore.setState({
      collapsedStateNames: new Set(),
      expandedTaskIds: new Set(),
      storySearchQuery: "",
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: null,
      tasks: [STORY],
      states: STATES,
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

  it("maps every canonical stage and falls back for project-created names", () => {
    expect(stageIconForName("Grill")).toBe(IconGrill);
    expect(stageIconForName("Spec")).toBe(IconSpec);
    expect(stageIconForName("Tickets")).toBe(IconTickets);
    expect(stageIconForName("Implement")).toBe(IconImplement);
    expect(stageIconForName("Review")).toBe(IconReview);
    expect(stageIconForName("Done")).toBe(IconCheckCircle);
    expect(stageIconForName("Cancelled")).toBe(IconX);
    expect(stageIconForName("Project Custom")).toBe(IconList);
  });

  it("renders a colored decorative icon between the collapse control and name", () => {
    render(<TasksPane />);

    for (const [index, stateName] of STATE_NAMES.entries()) {
      const header = screen.getByRole("button", {
        name: `Collapse ${stateName}`,
      });
      const icon = header.querySelector(`[data-stage-icon="${stateName}"]`);
      const svg = icon?.querySelector("svg");

      expect(icon).toHaveStyle({
        color: `#${(index + 1).toString(16).repeat(6)}`,
      });
      expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
      expect(svg).toHaveAttribute("fill", "none");
      expect(svg).toHaveAttribute("stroke", "currentColor");
      expect(svg).toHaveAttribute("stroke-width", "1.75");
      expect(svg).toHaveAttribute("stroke-linecap", "round");
      expect(svg).toHaveAttribute("stroke-linejoin", "round");
      expect(svg).toHaveAttribute("width", "16");
      expect(svg).toHaveAttribute("height", "16");

      expect(header.children[1]).toBe(icon);
      expect(header.children[2]).toHaveTextContent(stateName);
    }
  });

  it("keeps the whole header as the collapse control with its existing label", () => {
    render(<TasksPane />);
    const header = screen.getByRole("button", { name: "Collapse Review" });

    fireEvent.click(header.querySelector("[data-stage-icon='Review']")!);

    expect(
      screen.getByRole("button", { name: "Expand Review" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});

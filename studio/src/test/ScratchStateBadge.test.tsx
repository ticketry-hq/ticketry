import { render, screen, within } from "@testing-library/react";
import type { RunRecord } from "@worktracker/typescript-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { ScratchStateBadge } from "../features/agents/lifecycle";
import { useAgentStatusStore } from "../features/agents/status";
import { TEMP_TASK_ID } from "../features/agents/types";
import type { TaskSummary } from "../features/studio/lib/types";
import type { FlatRow } from "../features/studio/pages/tasks/TasksPane";
import { TaskRow } from "../features/studio/pages/tasks/components/TaskRow";
import { DetailsTab } from "../features/studio/pages/workspace/tabs/DetailsTab";
import { useTasksStore } from "../features/studio/stores/tasksStore";

function run(
  runId: string,
  state: RunRecord["state"],
  scope: RunRecord["scope"] = "plan",
  moduleId = "module-1",
  taskId: string | null = null,
): RunRecord {
  return {
    agent_run_id: runId,
    task_id: taskId,
    module_id: moduleId,
    scope,
    state,
    updated_at: "2026-07-29T12:00:00Z",
  };
}

const scratchTask: TaskSummary = {
  id: TEMP_TASK_ID,
  name: "Local scratch workspace with a deliberately long name",
  project_id: "",
  sequence_id: null,
  state: {
    id: null,
    name: "Scratch",
    group: "backlog",
    color: null,
  },
  assignees: [],
  labels: [],
  description_html: null,
  description_stripped: null,
  description: null,
  parent_id: null,
  sub_issues_count: 0,
};

const scratchRow: FlatRow = {
  task: scratchTask,
  depth: 0,
  parentId: null,
  hasChildren: false,
  isExpanded: false,
  isLoading: false,
  descendantIds: [],
};

function renderScratchRowAndDetails() {
  render(
    <>
      <TaskRow
        row={scratchRow}
        isSelected
        onClick={() => undefined}
        onToggleExpand={() => undefined}
      />
      <DetailsTab />
    </>,
  );
}

describe("ScratchStateBadge", () => {
  beforeEach(() => {
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {},
      byTask: {},
      automationAttempts: {},
      automationByTask: {},
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: TEMP_TASK_ID,
      tasks: [scratchTask],
      subtasks: {},
      details: null,
      loading: {
        projects: false,
        modules: false,
        tasks: false,
        details: false,
        subtasks: false,
      },
    });
  });

  it("renders identical ordered, fixed-width lifecycle chips on the row and details pane", () => {
    const status = useAgentStatusStore.getState();
    status.upsertRun(run("error", "error", "instant"));
    status.upsertRun(run("input", "needs_input"));
    status.upsertRun(run("permission", "permission_required"));
    status.upsertRun(run("working-one", "working"));
    status.upsertRun(run("working-two", "working", "instant"));
    status.upsertRun(run("lost", "lost"));
    status.upsertRun(run("exited", "exited"));
    status.upsertRun(run("doc-chat", "working", "docchat"));
    status.upsertRun(run("task-bound", "working", "task", "module-1", "task-1"));
    status.upsertRun(run("other-module", "working", "plan", "module-2"));
    useAgentStatusStore.setState({
      automationAttempts: {
        "scratch-attempt": {
          attempt_id: "scratch-attempt",
          root_attempt_id: "scratch-attempt",
          retry_of_attempt_id: null,
          work_item_id: TEMP_TASK_ID,
          status: "failed",
          error: "must stay hidden",
          agent_run_id: null,
          updated_at: "2026-07-29T12:00:00Z",
        },
      },
      automationByTask: { [TEMP_TASK_ID]: ["scratch-attempt"] },
    });

    renderScratchRowAndDetails();

    const badges = screen.getAllByTestId("scratch-run-chicklets");
    expect(badges).toHaveLength(2);
    for (const badge of badges) {
      expect(badge).toHaveTextContent("!1?1◇1▶2");
      expect(badge).toHaveAttribute("data-state", "attention");
      expect(badge).toHaveClass("flex-none");
      expect(Array.from(badge.children)).toHaveLength(4);
      for (const chip of Array.from(badge.children)) {
        expect(chip).toHaveClass("shrink-0");
      }
      expect(
        within(badge)
          .getAllByLabelText(/Agent|permission/i)
          .map((chip) => chip.getAttribute("aria-label")),
      ).toEqual([
        "Agent session reported an error",
        "Agent is waiting for your input",
        "A permission decision is pending",
        "Agent is actively working",
      ]);
    }

    const row = screen.getByRole("treeitem");
    expect(row).toHaveClass("min-w-0");
    expect(
      within(row).getByText(/Local scratch workspace/).parentElement,
    ).toHaveClass("min-w-0", "truncate");
    expect(
      within(row).queryByTestId("automation-failure-chicklet"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing without a matching project and module", () => {
    render(
      <ScratchStateBadge projectId="project-2" moduleId="module-1" />,
    );

    expect(
      screen.queryByTestId("scratch-run-chicklets"),
    ).not.toBeInTheDocument();
  });

  it("keeps the details empty state and omits the row badge with no live qualifying runs", () => {
    const status = useAgentStatusStore.getState();
    status.upsertRun(run("lost", "lost"));
    status.upsertRun(run("exited", "exited"));
    status.upsertRun(run("doc-chat", "working", "docchat"));
    status.upsertRun(run("task-bound", "working", "task", "module-1", "task-1"));

    renderScratchRowAndDetails();

    expect(
      screen.queryByTestId("scratch-run-chicklets"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No active Scratch runs.")).toBeInTheDocument();
  });
});

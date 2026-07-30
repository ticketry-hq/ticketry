import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { AgentStatusSnapshot, RunRecord } from "@worktracker/typescript-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchStatusFrame, statusFeed } from "../features/agents/status/statusFeed";
import { useAgentStatusStore } from "../features/agents/status";
import { TasksPane } from "../features/studio/pages/tasks/TasksPane";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";

const getAgentStatus = vi.hoisted(() =>
  vi.fn<() => Promise<AgentStatusSnapshot>>(),
);
const retryAutomationAttempt = vi.hoisted(() => vi.fn());

vi.mock("@worktracker/typescript-sdk/agent-status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@worktracker/typescript-sdk/agent-status")>()),
  createAgentStatusClient: () => ({ getAgentStatus, retryAutomationAttempt }),
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close() {}
}

const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function workItem(
  id: string,
  name: string,
  parentId: string,
  subIssuesCount: number,
) {
  return {
    id,
    key: `CODIN-${id}`,
    name,
    project_id: "project-1",
    sequence_id: Number(id),
    state: { id: "todo", name: "Todo", group: "backlog", color: null },
    assignees: [],
    labels: [],
    description_html: null,
    description_stripped: null,
    description: null,
    parent_id: parentId,
    sub_issues_count: subIssuesCount,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function run(
  runId: string,
  taskId: string | null,
  state: RunRecord["state"],
): RunRecord {
  return {
    agent_run_id: runId,
    task_id: taskId,
    module_id: "module-1",
    scope: "task",
    state,
    updated_at: "2026-07-15T10:00:00Z",
  };
}

function taskRow(name: string): HTMLElement {
  const row = screen.getByText(new RegExp(name)).closest("li");
  if (!row) throw new Error(`Missing row for ${name}`);
  return row;
}

function badgeText(row: HTMLElement): string {
  return within(row).getByTestId("agent-state-badge").textContent ?? "";
}

function badgeLabels(row: HTMLElement): string[] {
  return Array.from(within(row).getByTestId("agent-state-badge").children).map(
    (chip) => chip.getAttribute("aria-label") ?? "",
  );
}

describe("Studio subtree lifecycle chicklets", () => {
  beforeEach(() => {
    statusFeed.stop();
    getAgentStatus.mockReset();
    retryAutomationAttempt.mockReset();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    useAgentStatusStore.setState({
      projectId: null,
      runs: {},
      byTask: {},
      automationAttempts: {},
      automationByTask: {},
    });
    useUIStore.setState({
      collapsedStateNames: new Set(),
      expandedTaskIds: new Set(),
      expandedModuleId: "module-1",
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: null,
      tasks: [],
      states: [],
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

  afterEach(() => statusFeed.stop());

  it("hydrates collapsed chicklets without opening an agent terminal", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return Promise.resolve(
          jsonResponse([
            workItem("1", "Root story", "module-1", 1),
            workItem("2", "Implementation child", "1", 0),
          ]),
        );
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(
          jsonResponse([
            { id: "todo", name: "Todo", group: "backlog", color: null },
          ]),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const snapshot: AgentStatusSnapshot = {
      scope: { project_id: "project-1", task_id: null },
      runs: [run("child-done", "2", "turn_complete")],
      automation_attempts: [],
      at: "2026-07-15T10:00:00Z",
    };
    getAgentStatus
      .mockRejectedValueOnce(new Error("status service starting"))
      .mockResolvedValueOnce(snapshot);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await useTasksStore.getState().loadTasks("project-1", "module-1");
    render(<TasksPane />);
    statusFeed.start("project-1", { refreshSnapshotOnSocketOpen: true });
    await waitFor(() => expect(getAgentStatus).toHaveBeenCalledTimes(1));

    act(() => FakeWebSocket.instances[0].onopen?.());

    await waitFor(() => expect(badgeText(taskRow("Root story"))).toBe("✓1"));
    expect(screen.queryByText(/Implementation child/)).not.toBeInTheDocument();
    expect(getAgentStatus).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("joins live status into collapsed subtrees and direct-only expanded rows", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return Promise.resolve(
          jsonResponse([
            workItem("1", "Root story", "module-1", 1),
            workItem("2", "Implementation child", "1", 1),
            workItem("3", "Nested task", "2", 0),
          ]),
        );
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(
          jsonResponse([
            {
              id: "todo",
              name: "Todo",
              group: "backlog",
              color: null,
              sort_order: 0,
            },
          ]),
        );
      }
      if (url.includes("/api/settings/expanded_subtasks")) {
        return Promise.resolve(jsonResponse({}));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await useTasksStore.getState().loadTasks("project-1", "module-1");
    const tasksBeforeStatus = useTasksStore.getState().tasks;
    const subtasksBeforeStatus = useTasksStore.getState().subtasks;
    const snapshot: AgentStatusSnapshot = {
      scope: { project_id: "project-1", task_id: null },
      runs: [
        run("root-working", "1", "working"),
        run("child-lost", "2", "lost"),
        run("child-input", "2", "needs_input"),
        run("nested-error", "3", "error"),
        run("nested-done", "3", "turn_complete"),
        run("nested-starting", "3", "starting"),
        run("nested-reconnecting", "3", "reconnecting"),
        run("nested-quiet", "3", "quiet"),
        run("hidden-exited", "3", "exited"),
        run("hidden-unknown", "3", "unknown"),
        run("scratch-working", null, "working"),
      ],
      automation_attempts: [],
      at: "2026-07-15T10:00:00Z",
    };
    render(<TasksPane />);
    expect(
      within(taskRow("Root story")).queryByTestId("agent-state-badge"),
    ).not.toBeInTheDocument();

    act(() => dispatchStatusFrame({ v: 1, type: "snapshot", ...snapshot }));

    expect(badgeText(taskRow("Root story"))).toBe("!1!1?1✓1▶1○1⟳1·1");
    expect(badgeLabels(taskRow("Root story"))).toEqual([
      "The backend terminal session could not be found",
      "Agent session reported an error",
      "Agent is waiting for your input",
      "Agent finished its turn and is awaiting you",
      "Agent is actively working",
      "Agent session is starting up",
      "Reconnecting to the terminal session",
      "No recent activity (heuristic — not a confirmed completion)",
    ]);
    expect(screen.queryByText(/Implementation child/)).not.toBeInTheDocument();

    fireEvent.click(
      within(taskRow("Root story")).getByRole("button", {
        name: "Expand subtasks",
      }),
    );
    expect(badgeText(taskRow("Root story"))).toBe("▶1");
    expect(badgeText(taskRow("Implementation child"))).toBe("!1!1?1✓1○1⟳1·1");

    fireEvent.click(
      within(taskRow("Implementation child")).getByRole("button", {
        name: "Expand subtasks",
      }),
    );
    expect(badgeText(taskRow("Implementation child"))).toBe("!1?1");
    expect(badgeText(taskRow("Nested task"))).toBe("!1✓1○1⟳1·1");

    act(() => {
      dispatchStatusFrame({
        v: 1,
        type: "agent_lifecycle",
        at: "2026-07-15T10:01:00Z",
        run: {
          ...run("root-working", "1", "error"),
          updated_at: "2026-07-15T10:01:00Z",
        },
      });
    });

    expect(badgeText(taskRow("Root story"))).toBe("!1");
    expect(useTasksStore.getState().tasks).toBe(tasksBeforeStatus);
    expect(useTasksStore.getState().subtasks).toBe(subtasksBeforeStatus);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/work-items"),
      ),
    ).toHaveLength(1);
  });

  it("rolls up a failed launch only while collapsed and retries it from the leaf", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return Promise.resolve(
          jsonResponse([
            workItem("1", "Root story", "module-1", 1),
            workItem("2", "Implementation child", "1", 0),
          ]),
        );
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(
          jsonResponse([
            { id: "todo", name: "Todo", group: "backlog", color: null },
          ]),
        );
      }
      if (url.includes("/api/settings/expanded_subtasks")) {
        return Promise.resolve(jsonResponse({}));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    await useTasksStore.getState().loadTasks("project-1", "module-1");
    useAgentStatusStore.getState().switchProject("project-1");
    render(<TasksPane />);

    const failed = {
      attempt_id: "attempt-1",
      root_attempt_id: "attempt-1",
      retry_of_attempt_id: null,
      work_item_id: "2",
      status: "failed" as const,
      error: "tmux unavailable",
      agent_run_id: null,
      updated_at: "2026-07-16T10:00:00Z",
    };
    act(() =>
      dispatchStatusFrame({
        v: 1,
        type: "automation_attempt",
        project_id: "project-1",
        attempt: failed,
      }),
    );

    expect(
      within(taskRow("Root story")).getByTestId("automation-failure-chicklet"),
    ).toHaveTextContent("!1Retry");
    expect(screen.queryByText(/Implementation child/)).not.toBeInTheDocument();

    fireEvent.click(
      within(taskRow("Root story")).getByRole("button", {
        name: "Expand subtasks",
      }),
    );
    expect(
      within(taskRow("Root story")).queryByTestId("automation-failure-chicklet"),
    ).not.toBeInTheDocument();
    const childFailure = within(taskRow("Implementation child")).getByTestId(
      "automation-failure-chicklet",
    );

    retryAutomationAttempt.mockResolvedValue({
      ...failed,
      attempt_id: "attempt-2",
      retry_of_attempt_id: "attempt-1",
      status: "succeeded",
      error: null,
      agent_run_id: "run-2",
      updated_at: "2026-07-16T10:01:00Z",
    });
    fireEvent.click(
      within(childFailure).getByRole("button", {
        name: "Retry failed automated launch",
      }),
    );

    await waitFor(() =>
      expect(retryAutomationAttempt).toHaveBeenCalledWith({
        attemptId: "attempt-1",
      }),
    );
    await waitFor(() =>
      expect(
        within(taskRow("Implementation child")).queryByTestId(
          "automation-failure-chicklet",
        ),
      ).not.toBeInTheDocument(),
    );
  });

  it("counts every descendant once when malformed parentage contains a cycle", () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes("/api/settings/expanded_subtasks")) {
        return Promise.resolve(jsonResponse({}));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    const root = workItem("1", "Root story", "module-1", 1);
    const child = workItem("2", "Implementation child", "1", 1);
    useTasksStore.setState({
      tasks: [root],
      states: [
        { id: "todo", name: "Todo", group: "backlog", color: null },
      ],
      subtasks: { "1": [child], "2": [root] },
    });
    const status = useAgentStatusStore.getState();
    status.upsertRun(run("root-working", "1", "working"));
    status.upsertRun(run("child-working", "2", "working"));

    render(<TasksPane />);

    expect(badgeText(taskRow("Root story"))).toBe("▶2");

    fireEvent.click(
      within(taskRow("Root story")).getByRole("button", {
        name: "Expand subtasks",
      }),
    );
    expect(badgeText(taskRow("Root story"))).toBe("▶1");
    expect(badgeText(taskRow("Implementation child"))).toBe("▶2");

    fireEvent.click(
      within(taskRow("Implementation child")).getByRole("button", {
        name: "Expand subtasks",
      }),
    );
    expect(screen.getAllByRole("treeitem")).toHaveLength(2);
    expect(badgeText(taskRow("Implementation child"))).toBe("▶1");
  });
});

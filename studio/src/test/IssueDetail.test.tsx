import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const launchAgent = vi.hoisted(() => vi.fn());

vi.mock("@worktracker/typescript-sdk/agent-status", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@worktracker/typescript-sdk/agent-status")
  >()),
  createAgentStatusClient: () => ({ launchAgent }),
}));

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>("../shared/api/client");
  return {
    ...actual,
    getWorkItem: vi.fn(),
    patchWorkItem: vi.fn(),
    createWorkItem: vi.fn(),
    listIssueTypes: vi.fn(async () => []),
    listProjectWorkItems: vi.fn(async () => []),
    updateState: vi.fn(),
  };
});

vi.mock("../features/agents/worktrees/internal/api", () => ({
  getWorktree: vi.fn(),
}));

vi.mock("../app/shell/ticket-workspace/selected-ticket/documents/RichMarkdownEditor", () => ({
  default: ({
    markdown,
    onChange,
    onParseError,
    layout,
  }: {
    markdown: string;
    onChange: (markdown: string) => void;
    onParseError: (source: string) => void;
    layout?: "document" | "compact";
  }) => (
    <div data-testid="rich-markdown-editor" data-layout={layout}>
      <textarea
        aria-label="Ticket description Markdown"
        value={markdown}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" onClick={() => onParseError(markdown)}>
        Trigger parse error
      </button>
    </div>
  ),
}));

import * as api from "../shared/api/client";
import * as worktreeApi from "../features/agents/worktrees/internal/api";
import IssueDetail from "../app/shell/ticket-workspace/selected-ticket/details/IssueDetail";
import { useIssueStore } from "../app/shell/ticket-workspace/selected-ticket";
import { useBacklogStore } from "../features/work-items/internal/backlogStore";
import { useStudioStore } from "../features/projects/store";
import { seedModules, seedProjects } from "../features/projects";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { SelectedTicketDetails } from "../app/shell/ticket-workspace/selected-ticket/details/SelectedTicketDetails";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import { useClientStore } from "../state/clientStore";
import { useSettingsStore } from "../features/settings/store";
import { seedCapabilities } from "../features/settings/queries";
import { dialog } from "../state/clientStore";
import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import type { Attachment, Module, State, WorkItem, WorkItemDetail } from "../shared/api/types";

const patchWorkItem = api.patchWorkItem as ReturnType<typeof vi.fn>;
const getWorkItem = api.getWorkItem as ReturnType<typeof vi.fn>;
const createWorkItem = api.createWorkItem as ReturnType<typeof vi.fn>;
const listProjectWorkItems = api.listProjectWorkItems as ReturnType<typeof vi.fn>;
const listIssueTypes = api.listIssueTypes as ReturnType<typeof vi.fn>;
const getWorktree = worktreeApi.getWorktree as ReturnType<typeof vi.fn>;
const deleteIssue = vi.fn();
const confirmDelete = vi.spyOn(dialog, "confirm");

const TODO: State = { id: "st-todo", name: "Todo", group: "unstarted", color: null };
const DONE: State = { id: "st-done", name: "Done", group: "completed", color: null };
const REVIEW: State = { id: "st-review", name: "Review", group: "started", color: null };
const IMPLEMENT: State = { id: "st-implement", name: "Implement", group: "started", color: null };
const CANCELLED: State = { id: "st-cancelled", name: "Cancelled", group: "cancelled", color: null };
const STORY_TYPE = { id: "ty-story", name: "Story", level: "task" } as WorkItem["issue_type"];
const IMPL_TYPE = { id: "ty-impl", name: "Implementation", level: "task" } as WorkItem["issue_type"];
const MODULE_TYPE = { id: "ty-epic", name: "Epic", level: "module" } as Module["issue_type"];
const EPIC: Module = { id: "m1", name: "Epic One", project_id: "p1", sequence_id: 609, key: "MEML-609", issue_type: MODULE_TYPE };

function wi(partial: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    name: "An issue",
    project_id: "p1",
    sequence_id: 7,
    state: TODO,
    issue_type: STORY_TYPE,
    description: null,
    parent_id: "m1",
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    key: "MEML-7",
    ...partial,
  };
}

function detail(task: WorkItem, attachments: Attachment[] = []): WorkItemDetail {
  return { task, attachments };
}

function setup(
  task: WorkItem,
  attachments: Attachment[] = [],
  projectItems: WorkItem[] = [task],
  saving: Record<string, boolean> = {},
) {
  useIssueStore.setState({
    open: detail(task, attachments),
    children: [],
    loading: false,
    notFound: false,
    error: null,
    saving,
  });
  useBacklogStore.setState({
    projectId: "p1",
    items: projectItems,
    states: [TODO, DONE],
    filters: { query: "" },
    deleteIssue,
  });
  useStudioStore.setState({ selectedProjectId: "p1" });
  seedModules("p1", [EPIC]);
  seedProjects([{ id: "p1", name: "Worktracker", slug: "wt", description: "" }]);
  return render(<IssueDetail issueId={task.id} />);
}

beforeEach(() => {
  useIssueStore.getState().closeIssue();
  getWorkItem.mockReset().mockResolvedValue(detail(wi({ id: "a" })));
  patchWorkItem.mockReset().mockImplementation(async (_id, patch) => wi({ id: "a", ...patch }));
  createWorkItem.mockReset().mockResolvedValue(wi({ id: "c", parent_id: "a", key: "MEML-8" }));
  listProjectWorkItems.mockReset().mockResolvedValue([]);
  listIssueTypes.mockReset().mockResolvedValue([STORY_TYPE, IMPL_TYPE]);
  getWorktree.mockReset();
  launchAgent.mockReset().mockResolvedValue({
    target_id: "a",
    agent: "codex",
    agent_run_id: "run-1",
  });
  deleteIssue.mockReset().mockResolvedValue(undefined);
  confirmDelete.mockReset().mockResolvedValue(false);
  useClientStore.setState({ toasts: [] });
  useTasksStore.setState({ selectedProjectId: null, selectedTaskId: null });
  useWorkflowEditorStore.setState({ projectId: null, states: [] });
  useSettingsStore.setState({ projectId: "p1" });
  seedCapabilities("p1", { "ty-story": ["st-todo"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("IssueDetail", () => {
  it("paints a loaded selection before its one debounced detail refresh", async () => {
    vi.useFakeTimers();
    const task = wi({ id: "a", name: "Already loaded" });
    useIssueStore.setState({
      workItemsById: { [task.id]: task },
      workItemIdByKey: { [task.key]: task.id },
      childWorkItemIds: {},
      open: null,
      children: [],
      loading: false,
      notFound: false,
      loadError: null,
    });
    useBacklogStore.setState({
      projectId: "p1",
      items: [task],
      states: [TODO, DONE],
      filters: { query: "" },
      deleteIssue,
    });
    useStudioStore.setState({ selectedProjectId: "p1" });
    seedModules("p1", [EPIC]);
    seedProjects([{ id: "p1", name: "Worktracker", slug: "wt", description: "" }]);
    useTasksStore.setState({
      selectedProjectId: "p1",
      selectedModuleId: "m1",
      selectedTaskId: task.id,
    });

    const view = render(<SelectedTicketDetails />);

    expect(screen.getByTestId("issue-name")).toHaveTextContent("Already loaded");
    expect(screen.queryByText("Loading issue…")).toBeNull();
    expect(getWorkItem).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
    expect(getWorkItem).toHaveBeenCalledTimes(1);
    expect(getWorkItem).toHaveBeenLastCalledWith(task.id, expect.any(AbortSignal));

    view.unmount();
    vi.useRealTimers();
  });

  it("keeps loading reserved for an absent record and hydrates it", async () => {
    let resolveDetail!: (value: WorkItemDetail) => void;
    getWorkItem.mockImplementation(
      () => new Promise<WorkItemDetail>((resolve) => { resolveDetail = resolve; }),
    );
    useIssueStore.setState({
      workItemsById: {},
      workItemIdByKey: {},
      childWorkItemIds: {},
      open: null,
      children: [],
      loading: false,
      notFound: false,
      loadError: null,
    });

    render(<IssueDetail issueId="missing" />);
    expect(screen.getByText("Loading issue…")).toBeInTheDocument();

    const task = wi({ id: "missing", name: "Hydrated after cache miss" });
    resolveDetail(detail(task));

    expect(await screen.findByTestId("issue-name")).toHaveTextContent("Hydrated after cache miss");
    expect(useIssueStore.getState().getWorkItem(task.id)).toMatchObject({ name: task.name });
  });

  it("aborts a superseded refresh and rejects its late response", async () => {
    vi.useFakeTimers();
    const first = wi({ id: "a", name: "First" });
    const second = wi({ id: "b", key: "MEML-8", name: "Second" });
    let resolveFirst!: (value: WorkItemDetail) => void;
    let firstSignal: AbortSignal | undefined;
    getWorkItem.mockImplementationOnce((_id: string, signal?: AbortSignal) => {
      firstSignal = signal;
      return new Promise<WorkItemDetail>((resolve) => { resolveFirst = resolve; });
    }).mockResolvedValueOnce(detail(second));
    useIssueStore.setState({
      workItemsById: { [first.id]: first, [second.id]: second },
      workItemIdByKey: { [first.key]: first.id, [second.key]: second.id },
      childWorkItemIds: {},
      open: null,
      children: [],
      loading: false,
      notFound: false,
      loadError: null,
    });
    useBacklogStore.setState({
      projectId: "p1",
      items: [first, second],
      states: [TODO, DONE],
      filters: { query: "" },
      deleteIssue,
    });
    useStudioStore.setState({ selectedProjectId: "p1" });
    seedModules("p1", [EPIC]);
    seedProjects([{ id: "p1", name: "Worktracker", slug: "wt", description: "" }]);

    const view = render(<IssueDetail issueId={first.id} />);
    await vi.advanceTimersByTimeAsync(150);
    view.rerender(<IssueDetail issueId={second.id} />);
    await vi.advanceTimersByTimeAsync(0);

    expect(firstSignal?.aborted).toBe(true);
    resolveFirst(detail({ ...first, name: "Late first response" }));
    await Promise.resolve();
    expect(screen.getByTestId("issue-name")).toHaveTextContent("Second");

    view.unmount();
    vi.useRealTimers();
  });

  it("renders the two-pane fields", async () => {
    setup(wi({ id: "a", name: "Build the thing" }));
    expect(screen.getByTestId("issue-name")).toHaveTextContent("Build the thing");
    expect(await screen.findByTestId("issue-description")).toBeInTheDocument();
    expect(screen.getByTestId("child-issues")).toBeInTheDocument();
    expect(screen.queryByTestId("blocks-row")).toBeNull();
  });

  it("renders the Epic as a derived navigable link", () => {
    setup(wi({ id: "a" }));
    expect(screen.getByTestId("epic-link")).toHaveTextContent("MEML-609");
  });

  it("renders a flat hybrid Details list with the overflow trigger in the header actions slot", () => {
    const blocker = wi({ id: "b", key: "MEML-2" });
    const blocked = wi({ id: "c", key: "MEML-3" });
    const task = wi({
      id: "a",
      blocked_by_ids: ["b"],
      blocks_ids: ["c"],
    });
    setup(task, [], [task, blocker, blocked]);

    expect(screen.getByTestId("details-header")).toHaveTextContent("Details");
    expect(within(screen.getByTestId("details-actions")).getByTestId("issue-actions-trigger")).toBeInTheDocument();

    const fields = within(screen.getByTestId("details-fields")).getAllByTestId("details-field");
    expect(fields.map((field) => within(field).getByTestId("field-label").textContent)).toEqual([
      "Type",
      "Parent",
      "Module",
      "Blocked by",
      "Blocks",
      "Created",
      "Updated",
    ]);
    expect(fields.map((field) => field.getAttribute("data-arrangement"))).toEqual([
      "inline",
      "inline",
      "inline",
      "stacked",
      "stacked",
      "inline",
      "inline",
    ]);
  });

  it("omits worktree controls and does not request worktree status", () => {
    setup(wi({ id: "a" }));

    const panel = screen.getByTestId("details-panel");

    expect(within(panel).queryByTestId("worktree-block")).toBeNull();
    expect(getWorktree).not.toHaveBeenCalled();
  });

  it("orders Run agent, the status picker, and eligible Run subtree", () => {
    setup(wi({
      id: "story",
      issue_type: STORY_TYPE,
      sub_issues_count: 1,
    }));

    const row = screen.getByTestId("status-row");
    const runAgent = within(row).getByRole("button", { name: "Run agent" });
    const statePicker = within(row).getByTestId("state-picker");
    const runSubtree = within(row).getByRole("button", { name: "Run subtree" });

    expect(row.children).toHaveLength(3);
    expect(row.children[0]).toBe(runAgent);
    expect(row.children[1]).toContainElement(statePicker);
    expect(row.children[2]).toBe(runSubtree);
  });

  it("deduplicates an in-flight agent launch and reports success", async () => {
    let resolveLaunch!: () => void;
    launchAgent.mockImplementation(
      () => new Promise<void>((resolve) => { resolveLaunch = resolve; }),
    );
    setup(wi({ id: "a" }));

    const button = screen.getByRole("button", { name: "Run agent" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(launchAgent).toHaveBeenCalledTimes(1);
    expect(launchAgent).toHaveBeenCalledWith({ issueId: "a" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    resolveLaunch();
    await waitFor(() => {
      expect(useClientStore.getState().toasts.at(-1)).toMatchObject({
        kind: "success",
        message: "Agent run started.",
      });
      expect(button).toBeEnabled();
    });
  });

  it("reports a failed agent launch and re-enables the action", async () => {
    launchAgent.mockRejectedValue(
      new WorkTrackerApiError(
        503,
        "HTTP 503",
        { error: "launch_unavailable" },
      ),
    );
    setup(wi({ id: "a" }));

    const button = screen.getByRole("button", { name: "Run agent" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(useClientStore.getState().toasts.at(-1)).toMatchObject({
        kind: "error",
        message: "Agent run could not be started: launch unavailable",
      });
      expect(button).toBeEnabled();
    });
  });

  it("does not render Run subtree for an ineligible work item", () => {
    setup(wi({
      id: "implementation",
      issue_type: IMPL_TYPE,
      parent_id: "story",
      sub_issues_count: 1,
    }));

    expect(screen.queryByRole("button", { name: "Run subtree" })).toBeNull();
  });

  it("flips Run subtree from the state picker's optimistic patch", async () => {
    let resolvePatch!: (item: WorkItem) => void;
    patchWorkItem.mockImplementation(
      () => new Promise<WorkItem>((resolve) => { resolvePatch = resolve; }),
    );
    seedCapabilities("p1", { "ty-story": ["st-done"] });
    setup(wi({
      id: "story",
      issue_type: STORY_TYPE,
      sub_issues_count: 1,
    }));
    expect(screen.queryByRole("button", { name: "Run subtree" })).toBeNull();

    fireEvent.click(screen.getByTestId("state-picker").querySelector("button")!);
    fireEvent.click(screen.getByText("Done"));

    expect(screen.getByRole("button", { name: "Run subtree" })).toBeEnabled();
    resolvePatch(wi({
      id: "story",
      issue_type: STORY_TYPE,
      state: DONE,
      sub_issues_count: 1,
    }));
  });

  it("uniformly dims and disables every saving Details field without status text", () => {
    const blocker = wi({ id: "b", key: "MEML-2" });
    const task = wi({
      id: "a",
      blocked_by_ids: ["b"],
    });
    setup(task, [], [task, blocker], {
      parent_id: true,
      blocked_by_ids: true,
    });

    const savingFields = within(screen.getByTestId("details-fields"))
      .getAllByTestId("details-field")
      .filter((field) => ["Parent", "Blocked by"].includes(
        within(field).getByTestId("field-label").textContent ?? "",
      ));

    expect(savingFields).toHaveLength(2);
    for (const field of savingFields) {
      const value = within(field).getByTestId("field-value");
      expect(value).toHaveClass("opacity-50");
      expect(value).toHaveAttribute("aria-busy", "true");
      for (const control of within(value).getAllByRole("button")) {
        expect(control).toBeDisabled();
      }
    }
    expect(screen.queryByText("saving…")).toBeNull();
    expect(within(screen.getByTestId("details-fields")).queryByText("…")).toBeNull();
  });

  it("renders attachment rows with filename + human-readable size (G02)", () => {
    setup(wi({ id: "a" }), [
      { id: "f1", filename: "spec.pdf", mime_type: "application/pdf", size: 12345, url: "/media/spec.pdf" },
      { id: "f2", filename: "notes.txt", mime_type: "text/plain", size: null, url: "/media/notes.txt" },
    ]);
    const rows = screen.getAllByTestId("attachment-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("spec.pdf");
    expect(rows[0]).toHaveTextContent("12 KB");
    expect(rows[0]).toHaveAttribute("href", "/media/spec.pdf");
    expect(rows[0]).toHaveAttribute("target", "_blank");
    expect(rows[0]).toHaveAttribute("rel", "noopener noreferrer");
    // Null size renders an em-dash, not "0 B".
    expect(rows[1]).toHaveTextContent("—");
  });

  it("hides the attachments section entirely when there are none (G02)", () => {
    setup(wi({ id: "a" }));
    expect(screen.queryByTestId("attachments")).toBeNull();
  });

  it("renders a Project › Epic breadcrumb (G03)", () => {
    setup(wi({ id: "a" }));
    const crumb = screen.getByTestId("breadcrumb");
    expect(within(crumb).getByTestId("crumb-project")).toHaveTextContent("Worktracker");
    expect(within(crumb).getByTestId("crumb-epic")).toHaveTextContent("Epic One");
  });

  it("breadcrumb shows Project only when there is no owning epic (G03)", () => {
    setup(wi({ id: "a", parent_id: null }));
    const crumb = screen.getByTestId("breadcrumb");
    expect(within(crumb).getByTestId("crumb-project")).toBeInTheDocument();
    expect(within(crumb).queryByTestId("crumb-epic")).toBeNull();
  });

  it("the status picker PATCHes state_id", async () => {
    setup(wi({ id: "a" }));
    fireEvent.click(screen.getByTestId("state-picker").querySelector("button")!);
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() =>
      expect(patchWorkItem).toHaveBeenCalledWith("a", {
        state_id: "st-done",
      }),
    );
  });

  it("adopts an edited state color in the current-state and option dots without reload", async () => {
    const coloredTodo = { ...TODO, color: "#33B1FF" };
    const coloredDone = { ...DONE, color: "#22C55E" };
    const recoloredTodo = { ...coloredTodo, color: "#A855F7" };
    setup(wi({ id: "a", state: coloredTodo }));
    useBacklogStore.setState({ states: [coloredTodo, coloredDone] });
    useWorkflowEditorStore.setState({
      projectId: "p1",
      states: [coloredTodo, coloredDone],
    });
    vi.mocked(api.updateState).mockResolvedValue(recoloredTodo);

    const picker = screen.getByTestId("state-picker");
    fireEvent.click(within(picker).getByRole("button", { name: "Todo" }));
    let todoButtons = within(picker).getAllByRole("button", { name: "Todo" });
    expect(todoButtons[0].querySelector("span"))
      .toHaveStyle({ backgroundColor: "#33B1FF" });
    expect(todoButtons[1].querySelector("span"))
      .toHaveStyle({ backgroundColor: "#33B1FF" });

    await useWorkflowEditorStore
      .getState()
      .updateState("st-todo", { color: "#A855F7" });

    todoButtons = within(picker).getAllByRole("button", { name: "Todo" });
    expect(todoButtons[0].querySelector("span"))
      .toHaveStyle({ backgroundColor: "#A855F7" });
    expect(todoButtons[1].querySelector("span"))
      .toHaveStyle({ backgroundColor: "#A855F7" });
  });

  it("shows the configured task type as display-only task details", () => {
    setup(wi({ id: "a", issue_type: IMPL_TYPE }));

    const typeLabel = within(screen.getByTestId("details-fields")).getByTestId(
      "issue-type-label",
    );
    expect(typeLabel).toHaveTextContent("Implementation");
    expect(typeLabel.tagName).toBe("SPAN");
  });

  it("editing the name PATCHes name", async () => {
    setup(wi({ id: "a", name: "old" }));
    fireEvent.click(screen.getByTestId("issue-name"));
    const input = screen.getByDisplayValue("old");
    fireEvent.change(input, { target: { value: "new name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(patchWorkItem).toHaveBeenCalledWith("a", { name: "new name" }));
  });

  it("adding a sub-task POSTs with the parent_id", async () => {
    setup(wi({ id: "a" }));
    fireEvent.change(await screen.findByTestId("add-subtask-type"), {
      target: { value: STORY_TYPE.id },
    });
    const input = screen.getByTestId("add-subtask");
    fireEvent.change(input, { target: { value: "A sub-task" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(createWorkItem).toHaveBeenCalledWith("p1", {
        name: "A sub-task",
        parent_id: "a",
        issue_type_id: STORY_TYPE.id,
      }),
    );
  });

  it("selects a child issue in the Studio task store", async () => {
    const child = wi({ id: "child-id", key: "MEML-8", parent_id: "a" });
    listProjectWorkItems.mockResolvedValue([child]);
    setup(wi({ id: "a" }));

    fireEvent.click(await screen.findByRole("button", { name: /MEML-8/ }));

    expect(useTasksStore.getState().selectedTaskId).toBe("child-id");
  });

  it("toggles the Details sidebar and persists the preference (#837)", () => {
    try {
      localStorage.removeItem("studio.issueDetail.sidebarVisible:v1");
    } catch {
      /* ignore */
    }
    setup(wi({ id: "a" }));
    expect(screen.getByTestId("details-header")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("issue-sidebar-toggle"));
    expect(screen.queryByTestId("details-header")).toBeNull();
    expect(localStorage.getItem("studio.issueDetail.sidebarVisible:v1")).toBe("0");

    fireEvent.click(screen.getByTestId("issue-sidebar-toggle"));
    expect(screen.getByTestId("details-header")).toBeInTheDocument();
    expect(localStorage.getItem("studio.issueDetail.sidebarVisible:v1")).toBe("1");
    try {
      localStorage.removeItem("studio.issueDetail.sidebarVisible:v1");
    } catch {
      /* ignore */
    }
  });

  it("renders the created/updated metadata rows (G07)", () => {
    setup(wi({ id: "a", created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-02T00:00:00Z" }));
    expect(screen.getByTestId("created-at").textContent).not.toBe("—");
    expect(screen.getByTestId("updated-at").textContent).not.toBe("—");
  });

  it("keeps Delete issue out of the panel body and opens it from the header menu", () => {
    setup(wi({ id: "a" }));
    expect(screen.queryByTestId("delete-issue")).toBeNull();

    const actions = screen.getByTestId("details-actions");
    fireEvent.click(within(actions).getByTestId("issue-actions-trigger"));

    expect(within(actions).getByRole("menu")).toBeInTheDocument();
    expect(within(actions).getByTestId("delete-issue")).toHaveTextContent("Delete issue…");
  });

  it("opens and closes the issue actions menu on click, outside click, and Escape", () => {
    setup(wi({ id: "a" }));
    const trigger = screen.getByTestId("issue-actions-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("confirms before deleting and only deletes on confirm", async () => {
    setup(wi({ id: "a" }));

    fireEvent.click(screen.getByTestId("issue-actions-trigger"));
    fireEvent.click(screen.getByTestId("delete-issue"));
    await waitFor(() =>
      expect(confirmDelete).toHaveBeenCalledWith({
        title: "Delete issue",
        body: "MEML-7 'An issue' will be permanently deleted.",
        confirmLabel: "Delete",
        danger: true,
      }),
    );
    expect(deleteIssue).not.toHaveBeenCalled();

    confirmDelete.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByTestId("issue-actions-trigger"));
    fireEvent.click(screen.getByTestId("delete-issue"));
    await waitFor(() => expect(deleteIssue).toHaveBeenCalledWith("a"));
  });

  it("disables delete with the existing reason when the issue has children", () => {
    setup(wi({ id: "a", sub_issues_count: 2 }));
    fireEvent.click(screen.getByTestId("issue-actions-trigger"));
    const deleteItem = screen.getByTestId("delete-issue");
    expect(deleteItem).toBeDisabled();
    expect(deleteItem).toHaveAttribute("title", "Remove sub-tasks first");
    fireEvent.click(deleteItem);
    expect(confirmDelete).not.toHaveBeenCalled();
  });

  it("renders Blocked-by chips, warning amber on an open blocker", () => {
    const blocker = wi({ id: "b", key: "MEML-2", state: TODO }); // unstarted → warn
    const task = wi({ id: "a", blocked_by_ids: ["b"] });
    useIssueStore.setState({ open: detail(task), children: [], loading: false, notFound: false, error: null, saving: {} });
    useBacklogStore.setState({
      projectId: "p1",
      items: [task, blocker],
      states: [TODO, DONE],
      filters: { query: "" },
    });
    useStudioStore.setState({ selectedProjectId: "p1" });
    seedModules("p1", [EPIC]);
    render(<IssueDetail issueId="a" />);
    const row = screen.getByTestId("blocked-by-row");
    const chip = within(row).getByTestId("blocker-chip");
    expect(chip).toHaveTextContent("MEML-2");
    expect(chip).toHaveAttribute("data-warn", "true");
    const remove = within(chip).getByTestId("remove-blocker");
    expect(remove).toBeInTheDocument();
    expect(remove).not.toHaveAttribute("tabindex", "-1");
  });

  it("selects a blocker in the Studio task store", () => {
    const blocker = wi({ id: "blocker-id", key: "MEML-2", state: TODO });
    const task = wi({ id: "a", blocked_by_ids: [blocker.id] });
    setup(task, [], [task, blocker]);

    fireEvent.click(within(screen.getByTestId("blocker-chip")).getByRole("button", { name: /MEML-2/ }));

    expect(useTasksStore.getState().selectedTaskId).toBe("blocker-id");
  });

  it("does not warn when the blocker is done, and Blocks chips are read-only", () => {
    const blocker = wi({ id: "b", key: "MEML-2", state: DONE });
    const blocked = wi({ id: "c", key: "MEML-3", state: TODO });
    const task = wi({ id: "a", blocked_by_ids: ["b"], blocks_ids: ["c"] });
    useIssueStore.setState({ open: detail(task), children: [], loading: false, notFound: false, error: null, saving: {} });
    useBacklogStore.setState({
      projectId: "p1",
      items: [task, blocker, blocked],
      states: [TODO, DONE],
      filters: { query: "" },
    });
    useStudioStore.setState({ selectedProjectId: "p1" });
    seedModules("p1", [EPIC]);
    render(<IssueDetail issueId="a" />);
    const blockedByChip = within(screen.getByTestId("blocked-by-row")).getByTestId("blocker-chip");
    expect(blockedByChip).toHaveAttribute("data-warn", "false");
    // The Blocks (reverse) row renders, with no remove control.
    const blocksRow = screen.getByTestId("blocks-row");
    expect(within(blocksRow).getByText("MEML-3")).toBeInTheDocument();
    expect(within(blocksRow).queryByTestId("remove-blocker")).toBeNull();
  });

  it("removing a blocker PATCHes the reduced replace-set", async () => {
    const blocker = wi({ id: "b", key: "MEML-2", state: TODO });
    const task = wi({ id: "a", blocked_by_ids: ["b"] });
    patchWorkItem.mockResolvedValue(wi({ id: "a", blocked_by_ids: [] }));
    useIssueStore.setState({ open: detail(task), children: [], loading: false, notFound: false, error: null, saving: {} });
    useBacklogStore.setState({
      projectId: "p1",
      items: [task, blocker],
      states: [TODO, DONE],
      filters: { query: "" },
    });
    useStudioStore.setState({ selectedProjectId: "p1" });
    seedModules("p1", [EPIC]);
    render(<IssueDetail issueId="a" />);
    fireEvent.click(screen.getByTestId("remove-blocker"));
    await waitFor(() =>
      expect(patchWorkItem).toHaveBeenCalledWith("a", { blocked_by_ids: [] }),
    );
  });

  it("reveals the blocker picker from a ghost + and PATCHes the expanded replace-set", async () => {
    const candidate = wi({ id: "b", key: "MEML-2", state: TODO });
    const task = wi({ id: "a", blocked_by_ids: [] });
    patchWorkItem.mockResolvedValue(wi({ id: "a", blocked_by_ids: ["b"] }));
    setup(task, [], [task, candidate]);

    const reveal = screen.getByRole("button", { name: "Add blocker" });
    expect(reveal).toHaveTextContent("+");
    fireEvent.click(reveal);
    fireEvent.click(within(screen.getByTestId("blocker-picker")).getByText("MEML-2"));

    await waitFor(() =>
      expect(patchWorkItem).toHaveBeenCalledWith("a", { blocked_by_ids: ["b"] }),
    );
  });
});

// #907: the Story-detail review-findings panel — queued count, location parse,
// Review/Story scoping, and cancellation reconcile.
describe("FindingsPanel (#907)", () => {
  const finding = (over: Partial<WorkItem> & { id: string }): WorkItem =>
    wi({ issue_type: IMPL_TYPE, parent_id: "a", ...over });

  function setupStory(children: WorkItem[], storyState: State = REVIEW) {
    const story = wi({ id: "a", name: "Auth story", issue_type: STORY_TYPE, state: storyState });
    listProjectWorkItems.mockResolvedValue(children);
    useIssueStore.setState({
      open: detail(story),
      children,
      loading: false,
      notFound: false,
      error: null,
      saving: {},
    });
    useBacklogStore.setState({
      projectId: "p1",
      items: [story],
      states: [TODO, DONE, REVIEW, IMPLEMENT, CANCELLED],
      filters: { query: "" },
    });
    useStudioStore.setState({ selectedProjectId: "p1" });
    seedModules("p1", [EPIC]);
    seedProjects([{ id: "p1", name: "Worktracker", slug: "wt", description: "" }]);
    return render(<IssueDetail issueId="a" />);
  }

  it("shows Implementation findings with an Implement-stage queued count and parsed location", async () => {
    setupStory([
      finding({
        id: "f1", key: "MEML-11", name: "Fix null deref", state: IMPLEMENT,
        description: "Path: src/auth/login.ts\nLines: 40-48\nNote: guard the token",
      }),
      finding({
        id: "f2", key: "MEML-12", name: "Second fix", state: IMPLEMENT,
        description: "Path: src/auth/session.ts\nLines: 10-10",
      }),
      finding({
        id: "f3", key: "MEML-13", name: "Under review", state: REVIEW,
        description: "Path: src/x.ts\nLines: 1-2",
      }),
    ]);

    expect(screen.getByTestId("findings-panel")).toBeInTheDocument();
    // Start-stage only: the Review finding is not counted as queued.
    expect(screen.getByTestId("findings-queued-count")).toHaveTextContent("2 fixes queued");

    const rows = screen.getAllByTestId("finding-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("MEML-11");
    expect(rows[0]).toHaveTextContent("Fix null deref");
    expect(within(rows[0]).getByTestId("finding-location")).toHaveTextContent("src/auth/login.ts:40-48");
    expect(within(rows[0]).getByTestId("finding-state")).toHaveTextContent("Implement");
    // Idempotent re-fetch on mount leaves the same set (reconcile seam).
    await waitFor(() => expect(listProjectWorkItems).toHaveBeenCalled());
  });

  it("uses the singular label for a single queued fix", () => {
    setupStory([
      finding({ id: "f1", key: "MEML-11", name: "Only fix", state: IMPLEMENT, description: "Path: a.ts\nLines: 1-2" }),
    ]);
    expect(screen.getByTestId("findings-queued-count")).toHaveTextContent("1 fix queued");
  });

  it("selects a finding in the Studio task store", () => {
    setupStory([
      finding({ id: "finding-id", key: "MEML-11", name: "Only fix", state: IMPLEMENT }),
    ]);

    fireEvent.click(within(screen.getByTestId("finding-row")).getByRole("button", { name: /^MEML-11/ }));

    expect(useTasksStore.getState().selectedTaskId).toBe("finding-id");
  });

  it("does not render the panel for a Story outside Review", () => {
    setupStory(
      [finding({ id: "f1", key: "MEML-11", name: "Fix", state: IMPLEMENT, description: "Path: a.ts\nLines: 1-2" })],
      TODO,
    );
    expect(screen.queryByTestId("findings-panel")).toBeNull();
  });

  it("does not render the panel on a non-Story issue in Review", () => {
    const task = wi({ id: "a", issue_type: IMPL_TYPE, state: REVIEW });
    useIssueStore.setState({ open: detail(task), children: [], loading: false, notFound: false, error: null, saving: {} });
    useBacklogStore.setState({
      projectId: "p1", items: [task], states: [TODO, DONE, REVIEW, IMPLEMENT, CANCELLED],
      filters: { query: "" },
    });
    useStudioStore.setState({ selectedProjectId: "p1" });
    seedModules("p1", [EPIC]);
    render(<IssueDetail issueId="a" />);
    expect(screen.queryByTestId("findings-panel")).toBeNull();
  });

  it("cancels a queued finding via the child state-move path and reconciles the count", async () => {
    patchWorkItem.mockResolvedValue(
      finding({ id: "f1", key: "MEML-11", name: "Fix null deref", state: CANCELLED, description: "Path: a.ts\nLines: 1-2" }),
    );
    setupStory([
      finding({ id: "f1", key: "MEML-11", name: "Fix null deref", state: IMPLEMENT, description: "Path: a.ts\nLines: 1-2" }),
      finding({ id: "f2", key: "MEML-12", name: "Second", state: IMPLEMENT, description: "Path: b.ts\nLines: 3-4" }),
    ]);
    expect(screen.getByTestId("findings-queued-count")).toHaveTextContent("2 fixes queued");

    fireEvent.click(within(screen.getAllByTestId("finding-row")[0]).getByTestId("finding-cancel"));

    // Cancel = a normal graph-governed move to Cancelled.
    await waitFor(() =>
      expect(patchWorkItem).toHaveBeenCalledWith("f1", {
        state_id: "st-cancelled",
      }),
    );
    // The parent detail reconciles: the cancelled finding drops out of the
    // queued count and its row loses the cancel affordance.
    await waitFor(() =>
      expect(screen.getByTestId("findings-queued-count")).toHaveTextContent("1 fix queued"),
    );
    const rows = screen.getAllByTestId("finding-row");
    expect(within(rows[0]).getByTestId("finding-state")).toHaveTextContent("Cancelled");
    expect(within(rows[0]).queryByTestId("finding-cancel")).toBeNull();
  });
});

// Canonical Markdown descriptions retain sanitized legacy-HTML compatibility.
describe("DescriptionEditor", () => {
  it("renders legacy stored HTML and strips dangerous markup", async () => {
    setup(wi({ id: "a", description: "<p>Hi <strong>there</strong></p><script>window.x=1</script>" }));
    const view = await screen.findByTestId("issue-description");
    expect(view).toHaveTextContent("Hi there");
    expect(view.querySelector("strong")).not.toBeNull();
    expect(view.querySelector("script")).toBeNull();
  });

  it("renders markdown-shaped description as formatted markdown", async () => {
    setup(wi({ id: "a", description: "## Heading\n\n- One\n- **Two**" }));
    const view = await screen.findByTestId("issue-description");
    expect(view.querySelector("h2")).not.toBeNull();
    expect(view.querySelector("ul > li")?.textContent).toBe("One");
    expect(view.querySelector("strong")?.textContent).toBe("Two");
  });

  it("shows the add-description affordance when canonical description is empty", async () => {
    setup(wi({ id: "a", description: "" }));
    expect(await screen.findByTestId("issue-description")).toHaveTextContent("Add a description…");
  });

  it("opens the compact rich editor with markdown converted from stored HTML", async () => {
    setup(wi({ id: "a", description: "<p>Hi <strong>world</strong></p>" }));
    fireEvent.click(await screen.findByTestId("issue-description"));
    // The HTML→markdown converter (turndown) loads on demand at first edit.
    const editor = await screen.findByTestId("rich-markdown-editor");
    expect(editor).toHaveAttribute("data-layout", "compact");
    expect(screen.getByLabelText("Ticket description Markdown")).toHaveValue("Hi **world**");
  });

  it("saves rich-editor changes as canonical Markdown", async () => {
    setup(wi({ id: "a", description: null }));
    fireEvent.click(await screen.findByTestId("issue-description"));
    fireEvent.change(await screen.findByLabelText("Ticket description Markdown"), {
      target: { value: "# Title" },
    });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(patchWorkItem).toHaveBeenCalled());
    const [, patch] = patchWorkItem.mock.calls[0];
    expect(patch.description).toBe("# Title");
    expect(screen.getByTestId("issue-description")).toBeInTheDocument();
  });

  it("cancels a rich-editor draft without patching the work item", async () => {
    setup(wi({ id: "a", description: "<p>Original</p>" }));
    fireEvent.click(await screen.findByTestId("issue-description"));
    fireEvent.change(await screen.findByLabelText("Ticket description Markdown"), {
      target: { value: "Changed" },
    });

    fireEvent.click(screen.getByText("Cancel"));

    expect(patchWorkItem).not.toHaveBeenCalled();
    expect(screen.getByTestId("issue-description")).toHaveTextContent("Original");
  });

  it("preserves a parse-failing draft in source mode and can save it", async () => {
    setup(wi({ id: "a", description: null }));
    fireEvent.click(await screen.findByTestId("issue-description"));
    fireEvent.change(await screen.findByLabelText("Ticket description Markdown"), {
      target: { value: "<unsupported>draft</unsupported>" },
    });

    fireEvent.click(screen.getByText("Trigger parse error"));

    const source = screen.getByLabelText("Ticket description source");
    expect(source).toHaveValue("<unsupported>draft</unsupported>");
    expect(screen.getByRole("status")).toHaveTextContent(/source/i);

    fireEvent.change(source, { target: { value: "# Recovered" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(patchWorkItem).toHaveBeenCalledWith(
        "a",
        expect.objectContaining({
          description: "# Recovered",
        }),
      ),
    );
  });
});

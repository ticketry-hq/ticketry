import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Module, Project, State, WorkItem } from "../shared/api/types";
import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { seedModules, seedProjects, useStudioStore } from "../features/projects";
import { seedIssueTypes } from "../features/settings/queries";
import { seedStates } from "../shared/query/stateCatalog";
import { TaskRow } from "../app/shell/ticket-workspace/tasks/components/TaskRow";
import { SelectedTicketDetails } from "../app/shell/ticket-workspace/selected-ticket/details/SelectedTicketDetails";
import IssueDetail from "../app/shell/ticket-workspace/selected-ticket/details/IssueDetail";
import ParentPicker from "../app/shell/ticket-workspace/selected-ticket/details/fields/ParentPicker";
import BlockerPicker from "../app/shell/ticket-workspace/selected-ticket/details/fields/BlockerPicker";
import { useWorkItemsByIds } from "../features/work-items";
import { fetchWorkItem } from "../shared/api/workItemBatcher";
import * as api from "../shared/api/client";

vi.mock("../shared/api/workItemBatcher", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/workItemBatcher")>()),
  fetchWorkItem: vi.fn(),
}));

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  patchWorkItem: vi.fn(),
}));

vi.mock(
  "../app/shell/ticket-workspace/selected-ticket/documents/DescriptionEditor",
  () => ({
    default: ({ value }: { value: string | null }) => (
      <div data-testid="issue-description">{value}</div>
    ),
  }),
);

const TODO: State & { id: string } = {
  id: "todo",
  name: "Todo",
  group: "unstarted",
  color: null,
};
const STORY_TYPE = {
  id: "story",
  name: "Story",
  level: "task",
  color: null,
  sort_order: 1,
} as WorkItem["issue_type"];
const PROJECT = {
  id: "project",
  name: "Project",
  slug: "MEM",
  description: "",
} as Project;
const MODULE = {
  id: "module",
  name: "Module",
  project_id: PROJECT.id,
  key: "MEM-1",
  sequence_id: 1,
  issue_type: {
    id: "module-type",
    name: "Epic",
    level: "module",
    color: null,
    sort_order: 0,
  },
} as Module;

function item(id: string, name: string): WorkItem {
  return {
    id,
    name,
    key: `MEM-${id}`,
    project_id: PROJECT.id,
    sequence_id: Number(id),
    state: TODO,
    issue_type: STORY_TYPE,
    description: null,
    parent_id: MODULE.id,
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  } as WorkItem;
}

function seed(items: WorkItem[], selectedId: string): void {
  queryClient.setQueryData(
    queryKeys.tasks.byModule(PROJECT.id, MODULE.id),
    { rootIds: items.map(({ id }) => id), children: {}, order: items.map(({ id }) => id) },
  );
  for (const workItem of items) {
    queryClient.setQueryData(queryKeys.workItems.byId(workItem.id), workItem);
  }
  seedProjects([PROJECT]);
  seedModules(PROJECT.id, [MODULE]);
  seedStates(PROJECT.id, [TODO]);
  seedIssueTypes(PROJECT.id, [STORY_TYPE]);
  useStudioStore.setState({ selectedProjectId: PROJECT.id });
  useTasksStore.setState({
    selectedProjectId: PROJECT.id,
    selectedModuleId: MODULE.id,
    selectedTaskId: selectedId,
    workspaceSelection: { kind: "task" },
  });
}

function HoldingHarness({ items }: { items: WorkItem[] }) {
  const selectedId = useTasksStore((state) => state.selectedTaskId);
  const selectTask = useTasksStore((state) => state.selectTask);
  return (
    <QueryClientProvider client={queryClient}>
      <section aria-label="Stories">
        <ul>
          {items.map((workItem) => (
            <TaskRow
              key={workItem.id}
              row={{
                kind: "work-item",
                id: workItem.id,
                depth: 0,
                parentId: MODULE.id,
                expandable: false,
                expanded: false,
              }}
              isSelected={selectedId === workItem.id}
              onClick={(id) => void selectTask(id)}
              onToggleExpand={() => undefined}
            />
          ))}
        </ul>
      </section>
      <SelectedTicketDetails />
    </QueryClientProvider>
  );
}

function PickerHarness({ ids }: { ids: string[] }) {
  const items = useWorkItemsByIds(ids);
  return (
    <QueryClientProvider client={queryClient}>
      <ParentPicker value={MODULE.id} items={items} onChange={() => undefined} />
      <BlockerPicker
        issueId={ids[0]}
        items={items}
        currentIds={[]}
        onPick={() => undefined}
      />
    </QueryClientProvider>
  );
}

describe("per-item holding surfaces", () => {
  beforeEach(() => {
    vi.mocked(fetchWorkItem).mockReset();
    vi.mocked(api.patchWorkItem).mockReset();
  });

  it("cycles loaded selection without a request or loading flash", async () => {
    const first = item("1", "First story");
    const second = item("2", "Second story");
    seed([first, second], first.id);
    render(<HoldingHarness items={[first, second]} />);

    expect(screen.getByTestId("issue-name")).toHaveTextContent(first.name);
    fireEvent.click(screen.getByRole("treeitem", { name: /Second story/ }));

    expect(screen.getByTestId("issue-name")).toHaveTextContent(second.name);
    expect(screen.queryByText("Loading issue…")).toBeNull();
    expect(fetchWorkItem).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("treeitem", { name: /First story/ }));
    expect(screen.getByTestId("issue-name")).toHaveTextContent(first.name);
    expect(screen.queryByText("Loading issue…")).toBeNull();
    expect(fetchWorkItem).not.toHaveBeenCalled();
  });

  it("shows an optimistic details rename in the Stories row in the same frame", async () => {
    const original = item("1", "Old name");
    const renamed = { ...original, name: "New name" };
    let resolvePatch!: (value: WorkItem) => void;
    vi.mocked(api.patchWorkItem).mockReturnValue(
      new Promise<WorkItem>((resolve) => {
        resolvePatch = resolve;
      }),
    );
    vi.mocked(fetchWorkItem).mockResolvedValue(renamed);
    seed([original], original.id);
    render(<HoldingHarness items={[original]} />);

    fireEvent.click(screen.getByTestId("issue-name"));
    fireEvent.change(screen.getByDisplayValue("Old name"), {
      target: { value: "New name" },
    });
    fireEvent.keyDown(screen.getByDisplayValue("New name"), { key: "Enter" });

    await waitFor(() => {
      expect(screen.getAllByText("New name")).toHaveLength(2);
      expect(screen.queryByText("Old name")).toBeNull();
    });
    expect(api.patchWorkItem).toHaveBeenCalledWith(original.id, {
      name: "New name",
    });

    resolvePatch(renamed);
    await waitFor(() => expect(fetchWorkItem).toHaveBeenCalledWith(original.id));
  });

  it("keeps parent and blocker picker names current", () => {
    const selected = item("1", "Selected story");
    const candidate = item("2", "Old candidate name");
    seed([selected, candidate], selected.id);
    render(<PickerHarness ids={[selected.id, candidate.id]} />);

    fireEvent.click(
      screen.getByTestId("parent-picker").querySelector("button")!,
    );
    fireEvent.click(
      screen.getByTestId("blocker-picker").querySelector("button")!,
    );
    expect(screen.getAllByText(candidate.name)).toHaveLength(2);

    act(() => {
      queryClient.setQueryData(
        queryKeys.workItems.byId(candidate.id),
        { ...candidate, name: "Current candidate name" },
      );
    });

    expect(
      within(screen.getByTestId("parent-picker")).getByText(
        "Current candidate name",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("blocker-picker")).getByText(
        "Current candidate name",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(candidate.name)).toBeNull();
  });

  it("shows loading only for an unread deep link and resolves it", async () => {
    const unread = item("3", "Unread story");
    let resolveRead!: (value: WorkItem) => void;
    vi.mocked(fetchWorkItem).mockReturnValue(
      new Promise<WorkItem>((resolve) => {
        resolveRead = resolve;
      }),
    );
    seedProjects([PROJECT]);
    seedModules(PROJECT.id, [MODULE]);
    seedStates(PROJECT.id, [TODO]);
    useStudioStore.setState({ selectedProjectId: PROJECT.id });
    useTasksStore.setState({
      selectedProjectId: PROJECT.id,
      selectedModuleId: MODULE.id,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <IssueDetail issueId={unread.id} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Loading issue…")).toBeInTheDocument();

    resolveRead(unread);
    expect(await screen.findByTestId("issue-name")).toHaveTextContent(unread.name);
  });
});

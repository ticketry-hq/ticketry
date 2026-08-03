import {
  groupBacklog,
  groupBacklogByState,
  isStory,
  matchesQuery,
  NO_EPIC,
  toggleEpic,
  useBacklogStore,
} from "../features/work-items/internal/backlogStore";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>("../shared/api/client");
  return {
    ...actual,
    listProjectWorkItems: vi.fn(),
    listStates: vi.fn(),
    createWorkItem: vi.fn(),
    patchWorkItem: vi.fn(),
    deleteWorkItem: vi.fn(),
    reorderWorkItem: vi.fn(),
  };
});
import * as api from "../shared/api/client";
import { ApiError } from "../shared/api/client";
import type { Module, State, WorkItem } from "../shared/api/types";

const listProjectWorkItems = api.listProjectWorkItems as ReturnType<typeof vi.fn>;
const listStates = api.listStates as ReturnType<typeof vi.fn>;
const createWorkItem = api.createWorkItem as ReturnType<typeof vi.fn>;
const patchWorkItem = api.patchWorkItem as ReturnType<typeof vi.fn>;
const deleteWorkItem = api.deleteWorkItem as ReturnType<typeof vi.fn>;
const reorderWorkItem = api.reorderWorkItem as ReturnType<typeof vi.fn>;

const BACKLOG: State = { id: "st-backlog", name: "Backlog", group: "backlog", color: null };
const TODO: State = { id: "st-todo", name: "Todo", group: "unstarted", color: null };
const STARTED: State = { id: "st-prog", name: "In Progress", group: "started", color: null };
const DONE: State = { id: "st-done", name: "Done", group: "completed", color: null };
const CANCELLED: State = { id: "st-cancel", name: "Cancelled", group: "cancelled", color: null };

// Planning surfaces are Story-only by default (#906); fixtures represent cards,
// so default the type to Story. Non-Story tests pass an explicit issue_type.
const STORY_TYPE = { id: "ty-story", name: "Story", level: "task" } as WorkItem["issue_type"];
const IMPL_TYPE = { id: "ty-impl", name: "Implementation", level: "task" } as WorkItem["issue_type"];
const PATHFIND_TYPE = { id: "ty-pathfind", name: "PathFind", level: "task" } as WorkItem["issue_type"];
const MODULE_TYPE = { id: "ty-module", name: "Module", level: "module" } as Module["issue_type"];

function wi(partial: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    name: partial.id,
    project_id: "p1",
    sequence_id: 1,
    issue_type: STORY_TYPE,
    state: null,
    description: null,
    parent_id: null,
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    key: `MEML-${partial.id}`,
    ...partial,
  };
}

const MODULES: Module[] = [
  {
    id: "m1",
    name: "Epic One",
    project_id: "p1",
    sequence_id: 609,
    key: "MEML-609",
    issue_type: MODULE_TYPE,
  },
];

const EMPTY = { query: "" };

beforeEach(() => {
  listProjectWorkItems.mockReset();
  listStates.mockReset();
  createWorkItem.mockReset();
  patchWorkItem.mockReset();
  deleteWorkItem.mockReset();
  reorderWorkItem.mockReset();
  useBacklogStore.setState({
    projectId: null,
    items: [],
    states: [],
    filters: { query: "" },
    loading: false,
    error: null,
    seenStateRevisions: {},
    pendingStateDeltas: {},
  });
});

describe("groupBacklog", () => {
  const story = wi({ id: "s1", parent_id: "m1" });
  const subtask = wi({ id: "st1", parent_id: "s1" });
  const orphan = wi({ id: "t1", parent_id: null });

  it("builds the Epic→Story→Sub-task tree and a trailing No-Epic group", () => {
    const groups = groupBacklog([story, subtask, orphan], MODULES, { query: "" });
    expect(groups).toHaveLength(2);
    expect(groups[0].epic?.id).toBe("m1");
    expect(groups[0].rows[0].item.id).toBe("s1");
    expect(groups[0].rows[0].children[0].item.id).toBe("st1");
    expect(groups[0].total).toBe(2); // story + subtask
    expect(groups[1].epic).toBeNull();
    expect(groups[1].rows[0].item.id).toBe("t1");
  });

  it("counts completed descendants for epic progress", () => {
    const doneSub = wi({ id: "st1", parent_id: "s1", state: DONE });
    const groups = groupBacklog([story, doneSub], MODULES, { query: "" });
    expect(groups[0].done).toBe(1);
    expect(groups[0].total).toBe(2);
  });

  it("prunes non-matching rows but keeps ancestors of a match (state filter)", () => {
    const doneSub = wi({ id: "st1", parent_id: "s1", state: DONE });
    const groups = groupBacklog([story, doneSub], MODULES, { query: "" }, { epicIds: [], stateIds: ["st-done"] });
    // Story doesn't match Done, but it's kept as scaffolding for the matching sub-task.
    expect(groups[0].rows[0].item.id).toBe("s1");
    expect(groups[0].rows[0].children[0].item.id).toBe("st1");
  });

  it("restricts to a single epic when epicId is set", () => {
    const groups = groupBacklog([story, orphan], MODULES, { query: "" }, { epicIds: ["m1"], stateIds: [] });
    expect(groups).toHaveLength(1);
    expect(groups[0].epic?.id).toBe("m1");
  });

  it("shows only the No-Epic group for the NO_EPIC sentinel", () => {
    const groups = groupBacklog([story, orphan], MODULES, { query: "" }, { epicIds: [NO_EPIC], stateIds: [] });
    expect(groups).toHaveLength(1);
    expect(groups[0].epic).toBeNull();
    expect(groups[0].rows[0].item.id).toBe("t1");
  });

});

// Story-only visibility rule (#906): the same type-based predicate every
// planning surface shares. Story is a `task`-level *type name*, not an
// IssueLevel — so the rule keys on `issue_type.name`, independent of hierarchy.
describe("Story-only predicate (#906)", () => {
  it("isStory keys on the type name, not hierarchy or level", () => {
    expect(isStory(wi({ id: "s", issue_type: STORY_TYPE }))).toBe(true);
    expect(isStory(wi({ id: "i", issue_type: IMPL_TYPE }))).toBe(false);
    // A task-level "Bug" is not a Story either.
    expect(
      isStory(wi({ id: "b", issue_type: { id: "ty-bug", name: "Bug", level: "task" } as WorkItem["issue_type"] })),
    ).toBe(false);
  });

  it("the backlog tree excludes a top-level non-Story and a non-Story child by default", () => {
    const story = wi({ id: "s1", parent_id: "m1" }); // Story under the epic
    const implChild = wi({ id: "c1", parent_id: "s1", issue_type: IMPL_TYPE }); // Implementation under the Story
    const implTop = wi({ id: "i1", parent_id: "m1", issue_type: IMPL_TYPE }); // Implementation directly under the epic
    const groups = groupBacklog([story, implChild, implTop], MODULES, { query: "" });
    const epic = groups.find((g) => g.epic?.id === "m1")!;
    // Only the Story renders; neither the child nor the top-level Implementation.
    expect(epic.rows.map((r) => r.item.id)).toEqual(["s1"]);
    expect(epic.rows[0].children).toHaveLength(0);
  });

});

// Multi-select epic filter (#627): epicIds is a set; empty = all, NO_EPIC is a member.
describe("groupBacklog · multi-select epic filter (#627)", () => {
  const TWO: Module[] = [
    { id: "m1", name: "Epic One", project_id: "p1", sequence_id: 1, key: "MEML-1", issue_type: MODULE_TYPE },
    { id: "m2", name: "Epic Two", project_id: "p1", sequence_id: 2, key: "MEML-2", issue_type: MODULE_TYPE },
  ];
  const a = wi({ id: "a", parent_id: "m1" });
  const b = wi({ id: "b", parent_id: "m2" });
  const orphan = wi({ id: "t1", parent_id: null });
  const ITEMS = [a, b, orphan];

  const epicIdsOf = (ids: string[]) =>
    groupBacklog(ITEMS, TWO, { query: "" }, { epicIds: ids, stateIds: [] }).map(
      (g) => g.epic?.id ?? "none",
    );

  it("empty selection shows all groups (both epics + No-Epic)", () => {
    expect(epicIdsOf([])).toEqual(["m1", "m2", "none"]);
  });

  it("a single epic restricts to that group", () => {
    expect(epicIdsOf(["m1"])).toEqual(["m1"]);
  });

  it("two epics show both groups (the union)", () => {
    expect(epicIdsOf(["m1", "m2"])).toEqual(["m1", "m2"]);
  });

  it("an epic plus NO_EPIC shows that epic and the No-Epic group", () => {
    expect(epicIdsOf(["m1", NO_EPIC])).toEqual(["m1", "none"]);
  });
});

describe("toggleEpic (#627)", () => {
  it("adds an id that is absent", () => {
    expect(toggleEpic([], "m1")).toEqual(["m1"]);
    expect(toggleEpic(["m1"], "m2")).toEqual(["m1", "m2"]);
  });
  it("removes an id that is present", () => {
    expect(toggleEpic(["m1", "m2"], "m1")).toEqual(["m2"]);
    expect(toggleEpic(["m1"], "m1")).toEqual([]);
  });
});

describe("backlogStore", () => {
  it("loadBacklog populates items/states and resets filters", async () => {
    listProjectWorkItems.mockResolvedValue([wi({ id: "a" })]);
    listStates.mockResolvedValue([TODO]);
    useBacklogStore.setState({ filters: { query: "seed" } });

    await useBacklogStore.getState().loadBacklog("p1");
    const s = useBacklogStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.states).toEqual([TODO]);
    expect(s.filters).toEqual({ query: "" });
    expect(listProjectWorkItems).toHaveBeenCalledOnce();
    expect(listProjectWorkItems).toHaveBeenCalledWith("p1", { includePathfind: true });
  });

  it("keeps a newer state-feed delta when an older reconciliation returns", async () => {
    let resolveItems!: (items: WorkItem[]) => void;
    listProjectWorkItems.mockReturnValue(new Promise((resolve) => { resolveItems = resolve; }));
    listStates.mockResolvedValue([TODO, DONE]);

    const loading = useBacklogStore.getState().loadBacklog("p1");
    useBacklogStore.setState({
      items: [wi({ id: "a", state: DONE, updated_at: "2026-06-01T00:01:00Z" })],
    });
    resolveItems([wi({ id: "a", state: TODO, updated_at: "2026-06-01T00:00:00Z" })]);
    await loading;

    const item = useBacklogStore.getState().items[0];
    expect(item.state?.id).toBe("st-done");
    expect(item.updated_at).toBe("2026-06-01T00:01:00Z");
  });

  it("buffers a state frame received before the initial Backlog item arrives", async () => {
    let resolveItems!: (items: WorkItem[]) => void;
    listProjectWorkItems.mockReturnValue(new Promise((resolve) => { resolveItems = resolve; }));
    listStates.mockResolvedValue([TODO, STARTED]);

    const loading = useBacklogStore.getState().loadBacklog("p1");
    expect(
      useBacklogStore.getState().applyStateDelta(
        "a",
        STARTED,
        4,
        "2026-06-01T00:01:00Z",
      ),
    ).toBe(true);
    resolveItems([wi({ id: "a", state: TODO, state_revision: 3 })]);
    await loading;

    expect(useBacklogStore.getState().items[0]).toMatchObject({
      state: { id: "st-prog" },
      state_revision: 4,
    });
  });

  it("createIssue posts and appends the returned item", async () => {
    const created = wi({ id: "new", parent_id: "m1" });
    createWorkItem.mockResolvedValue(created);
    const out = await useBacklogStore.getState().createIssue("p1", {
      name: "Story",
      parent_id: "m1",
      issue_type_id: STORY_TYPE.id,
    });
    expect(out?.id).toBe("new");
    expect(useBacklogStore.getState().items.map((i) => i.id)).toContain("new");
  });

  it("reparent applies optimistically then reconciles with the server item", async () => {
    useBacklogStore.setState({ items: [wi({ id: "a", parent_id: "m1" })] });
    patchWorkItem.mockResolvedValue(wi({ id: "a", parent_id: "m2", sub_issues_count: 3 }));
    await useBacklogStore.getState().reparent("a", "m2");
    const item = useBacklogStore.getState().items.find((i) => i.id === "a")!;
    expect(item.parent_id).toBe("m2");
    expect(item.sub_issues_count).toBe(3); // reconciled from server
    expect(patchWorkItem).toHaveBeenCalledWith("a", { parent_id: "m2" });
  });

  it("reparent rolls back on ApiError", async () => {
    useBacklogStore.setState({ items: [wi({ id: "a", parent_id: "m1" })] });
    patchWorkItem.mockRejectedValue(new ApiError(400, "bad", {}));
    await useBacklogStore.getState().reparent("a", "m2");
    expect(useBacklogStore.getState().items.find((i) => i.id === "a")!.parent_id).toBe("m1");
    expect(useBacklogStore.getState().error).toContain("400");
  });

  it("deleteIssue optimistically drops a leaf row", async () => {
    useBacklogStore.setState({
      items: [wi({ id: "a", parent_id: "m1" }), wi({ id: "b", parent_id: "m1" })],
    });
    deleteWorkItem.mockResolvedValue(null);
    await useBacklogStore.getState().deleteIssue("a");
    expect(useBacklogStore.getState().items.map((i) => i.id)).toEqual(["b"]);
  });

  it("deleteIssue rolls back on a 409 (issue still has children)", async () => {
    useBacklogStore.setState({ items: [wi({ id: "p", parent_id: "m1" })] });
    deleteWorkItem.mockRejectedValue(new ApiError(409, "has children", {}));
    await useBacklogStore.getState().deleteIssue("p");
    expect(useBacklogStore.getState().items.map((i) => i.id)).toEqual(["p"]);
    expect(useBacklogStore.getState().error).toContain("409");
  });
});

describe("applyServerItem · cancel = archive (#633)", () => {
  it("drops an item from the store when the server returns is_archived", () => {
    useBacklogStore.setState({ items: [wi({ id: "a" }), wi({ id: "b" })] });
    useBacklogStore.getState().applyServerItem(wi({ id: "a", is_archived: true }));
    expect(useBacklogStore.getState().items.map((i) => i.id)).toEqual(["b"]);
  });

  it("re-adds an un-cancelled (is_archived=false) item that isn't in the store", () => {
    // Un-cancel from the deep-linked drawer: the restored item repopulates the
    // active views via the normal insert path — no reload needed.
    useBacklogStore.setState({ items: [wi({ id: "b" })] });
    useBacklogStore.getState().applyServerItem(wi({ id: "a", state: TODO }));
    expect(useBacklogStore.getState().items.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("replaces an existing active item in place (normal reconcile)", () => {
    useBacklogStore.setState({ items: [wi({ id: "a", sub_issues_count: 0 })] });
    useBacklogStore.getState().applyServerItem(wi({ id: "a", sub_issues_count: 5 }));
    const item = useBacklogStore.getState().items.find((i) => i.id === "a")!;
    expect(item.sub_issues_count).toBe(5);
  });
});

describe("revisioned targeted reconciliation (#1170)", () => {
  it("moves a cached Story immediately for only a newer revision", () => {
    const original = wi({
      id: "a",
      state: TODO,
      state_revision: 3,
      description: "<p>keep me</p>",
    });
    useBacklogStore.setState({
      projectId: "p1",
      items: [original],
      filters: { query: "MEML-a" },
    });

    expect(
      useBacklogStore.getState().applyStateDelta(
        "a",
        STARTED,
        4,
        "2026-06-01T00:01:00Z",
      ),
    ).toBe(true);
    expect(
      useBacklogStore.getState().applyStateDelta(
        "a",
        TODO,
        3,
        "2026-06-01T00:02:00Z",
      ),
    ).toBe(false);

    const moved = useBacklogStore.getState().items[0];
    expect(moved.state?.id).toBe("st-prog");
    expect(moved.state_revision).toBe(4);
    expect(moved.description).toBe("<p>keep me</p>");
    expect(useBacklogStore.getState().filters).toEqual({ query: "MEML-a" });
  });

  it("reconciles every field at the requested revision and rejects an older response", () => {
    useBacklogStore.setState({
      projectId: "p1",
      items: [wi({ id: "a", state: STARTED, state_revision: 5 })],
    });

    expect(
      useBacklogStore.getState().reconcileTargetedItem(
        wi({
          id: "a",
          state: STARTED,
          state_revision: 5,
          name: "Authoritative name",
          sub_issues_count: 7,
        }),
        5,
      ),
    ).toBe("applied");
    expect(useBacklogStore.getState().items[0]).toMatchObject({
      name: "Authoritative name",
      sub_issues_count: 7,
      state_revision: 5,
    });

    expect(
      useBacklogStore.getState().reconcileTargetedItem(
        wi({ id: "a", state: TODO, state_revision: 4, name: "Stale" }),
        5,
      ),
    ).toBe("stale");
    expect(useBacklogStore.getState().items[0].name).toBe("Authoritative name");
    expect(useBacklogStore.getState().items[0].state?.id).toBe("st-prog");
  });

  it("does not let an equal-revision detail response overwrite an optimistic move", async () => {
    useBacklogStore.setState({
      projectId: "p1",
      items: [wi({ id: "a", state: TODO, state_revision: 8 })],
      states: [TODO, STARTED],
    });
    let resolvePatch!: (item: WorkItem) => void;
    patchWorkItem.mockReturnValue(new Promise((resolve) => { resolvePatch = resolve; }));

    const mutation = useBacklogStore.getState().setItemState("a", "st-prog");
    expect(useBacklogStore.getState().items[0].state?.id).toBe("st-prog");
    expect(
      useBacklogStore.getState().reconcileTargetedItem(
        wi({ id: "a", state: TODO, state_revision: 8 }),
        8,
      ),
    ).toBe("ignored");
    expect(useBacklogStore.getState().items[0].state?.id).toBe("st-prog");

    resolvePatch(wi({ id: "a", state: STARTED, state_revision: 9 }));
    await mutation;
    expect(useBacklogStore.getState().items[0].state_revision).toBe(9);
  });

  it("does not roll a newer external revision back when an optimistic move fails", async () => {
    useBacklogStore.setState({
      projectId: "p1",
      items: [wi({ id: "a", state: TODO, state_revision: 8 })],
      states: [TODO, STARTED, DONE],
    });
    let rejectPatch!: (error: unknown) => void;
    patchWorkItem.mockReturnValue(new Promise((_resolve, reject) => { rejectPatch = reject; }));

    const mutation = useBacklogStore.getState().setItemState("a", "st-prog");
    useBacklogStore.getState().applyStateDelta(
      "a",
      DONE,
      9,
      "2026-06-01T00:02:00Z",
    );
    rejectPatch(new ApiError(409, "superseded", {}));
    await mutation;

    expect(useBacklogStore.getState().items[0]).toMatchObject({
      state: { id: "st-done" },
      state_revision: 9,
    });
  });

  it("removes only when the confirmed removal is not older than cached truth", () => {
    useBacklogStore.setState({
      projectId: "p1",
      items: [wi({ id: "a", state: STARTED, state_revision: 12 })],
    });

    expect(useBacklogStore.getState().removeReconciledItem("a", 11)).toBe(false);
    expect(useBacklogStore.getState().items).toHaveLength(1);
    expect(useBacklogStore.getState().removeReconciledItem("a", 12)).toBe(true);
    expect(useBacklogStore.getState().items).toHaveLength(0);

    useBacklogStore.getState().applyServerItem(
      wi({ id: "a", state: TODO, state_revision: 11 }),
    );
    expect(useBacklogStore.getState().items).toHaveLength(0);
  });

  it("does not let an older confirmed removal evict an optimistic state move", async () => {
    useBacklogStore.setState({
      projectId: "p1",
      items: [wi({ id: "a", state: TODO, state_revision: 8 })],
      states: [TODO, STARTED],
    });
    let resolvePatch!: (item: WorkItem) => void;
    patchWorkItem.mockReturnValue(new Promise((resolve) => { resolvePatch = resolve; }));

    const mutation = useBacklogStore.getState().setItemState("a", "st-prog");
    expect(useBacklogStore.getState().removeReconciledItem("a", 8)).toBe(false);
    expect(useBacklogStore.getState().items[0].state?.id).toBe("st-prog");

    resolvePatch(wi({ id: "a", state: STARTED, state_revision: 9 }));
    await mutation;
  });

  it("keeps the latest of two overlapping optimistic state moves guarded", async () => {
    useBacklogStore.setState({
      projectId: "p1",
      items: [wi({ id: "a", state: TODO, state_revision: 8 })],
      states: [TODO, STARTED, DONE],
    });
    const pending: Array<(item: WorkItem) => void> = [];
    patchWorkItem.mockImplementation(
      () => new Promise((resolve) => { pending.push(resolve); }),
    );

    const first = useBacklogStore.getState().setItemState("a", "st-prog");
    const second = useBacklogStore.getState().setItemState("a", "st-done");
    pending[0](wi({ id: "a", state: STARTED, state_revision: 9 }));
    await first;

    expect(useBacklogStore.getState().items[0].state?.id).toBe("st-done");
    expect(useBacklogStore.getState().removeReconciledItem("a", 8)).toBe(false);

    pending[1](wi({ id: "a", state: DONE, state_revision: 10 }));
    await second;
    expect(useBacklogStore.getState().items[0]).toMatchObject({
      state: { id: "st-done" },
      state_revision: 10,
    });
  });
});

describe("setItemState", () => {
  it("moves the item to the target state optimistically and PATCHes by UUID", async () => {
    useBacklogStore.setState({ projectId: "p1", items: [wi({ id: "a", state: TODO })], states: [TODO, DONE] });
    // Never resolves immediately — assert the optimistic swap happened first.
    let resolve!: (v: WorkItem) => void;
    patchWorkItem.mockReturnValue(new Promise<WorkItem>((r) => (resolve = r)));
    const promise = useBacklogStore.getState().setItemState("a", "st-done");
    expect(useBacklogStore.getState().items[0].state?.id).toBe("st-done");
    expect(patchWorkItem).toHaveBeenCalledWith("a", {
      state_id: "st-done",
    });
    resolve(wi({ id: "a", state: DONE }));
    await promise;
  });

  it("is a no-op when dropped on the item's current state (no PATCH)", async () => {
    useBacklogStore.setState({ projectId: "p1", items: [wi({ id: "a", state: TODO })], states: [TODO, DONE] });
    await useBacklogStore.getState().setItemState("a", "st-todo");
    expect(patchWorkItem).not.toHaveBeenCalled();
    expect(useBacklogStore.getState().items[0].state?.id).toBe("st-todo");
  });

  it("reconciles items[id] with the returned WorkItemOut on success", async () => {
    useBacklogStore.setState({ projectId: "p1", items: [wi({ id: "a", state: TODO })], states: [TODO, DONE] });
    patchWorkItem.mockResolvedValue(wi({ id: "a", state: DONE, sub_issues_count: 4 }));
    await useBacklogStore.getState().setItemState("a", "st-done");
    const item = useBacklogStore.getState().items.find((i) => i.id === "a")!;
    expect(item.state?.id).toBe("st-done");
    expect(item.sub_issues_count).toBe(4); // server-authoritative
  });

  it("restores the snapshot and sets error on ApiError", async () => {
    useBacklogStore.setState({ projectId: "p1", items: [wi({ id: "a", state: TODO })], states: [TODO, DONE] });
    patchWorkItem.mockRejectedValue(new ApiError(422, "bad state", {}));
    await useBacklogStore.getState().setItemState("a", "st-done");
    expect(useBacklogStore.getState().items[0].state?.id).toBe("st-todo");
    expect(useBacklogStore.getState().error).toContain("422");
  });
});

describe("reorderItem (#626)", () => {
  it("optimistically sets a rank between the neighbors, then reconciles", async () => {
    useBacklogStore.setState({
      items: [
        wi({ id: "a", rank: "F" }),
        wi({ id: "x", rank: "z" }),
        wi({ id: "b", rank: "V" }),
      ],
    });
    let resolve!: (v: WorkItem) => void;
    reorderWorkItem.mockReturnValue(new Promise<WorkItem>((r) => (resolve = r)));
    // Move x between a (F) and b (V).
    const promise = useBacklogStore.getState().reorderItem("x", "a", "b");
    const optimistic = useBacklogStore.getState().items.find((i) => i.id === "x")!;
    expect(optimistic.rank! > "F" && optimistic.rank! < "V").toBe(true);
    expect(reorderWorkItem).toHaveBeenCalledWith("x", {
      before_id: "a",
      after_id: "b",
    });
    resolve(wi({ id: "x", rank: "M" }));
    await promise;
    expect(useBacklogStore.getState().items.find((i) => i.id === "x")!.rank).toBe("M");
  });

  it("rolls back on a failed reorder", async () => {
    useBacklogStore.setState({
      items: [wi({ id: "a", rank: "F" }), wi({ id: "x", rank: "z" })],
    });
    reorderWorkItem.mockRejectedValue(new ApiError(422, "nope", {}));
    await useBacklogStore.getState().reorderItem("x", "a", null);
    expect(useBacklogStore.getState().items.find((i) => i.id === "x")!.rank).toBe("z");
    expect(useBacklogStore.getState().error).toContain("422");
  });
});

// --- C1 search + composable filters (#636) ----------------------------------

describe("matchesQuery (#636)", () => {
  const item = wi({ id: "x", name: "Auth refresh token", key: "MEML-609" });

  it("matches a case-insensitive substring of the name", () => {
    expect(matchesQuery(item, "auth")).toBe(true);
    expect(matchesQuery(item, "TOKEN")).toBe(true);
  });
  it("matches a substring of the key (number or prefix)", () => {
    expect(matchesQuery(item, "609")).toBe(true);
    expect(matchesQuery(item, "meml-6")).toBe(true);
  });
  it("an empty/blank query matches everything", () => {
    expect(matchesQuery(item, "")).toBe(true);
    expect(matchesQuery(item, "   ")).toBe(true);
  });
  it("a non-substring does not match", () => {
    expect(matchesQuery(item, "billing")).toBe(false);
  });
});

describe("groupBacklog · query filter (#636)", () => {
  const F = { query: "" };
  const auth = wi({ id: "a", parent_id: null, name: "Auth flow" });
  const billing = wi({ id: "b", parent_id: null, name: "Billing" });

  it("narrows by a key/name substring, keeping only matches", () => {
    const groups = groupBacklog([auth, billing], MODULES, { ...F, query: "auth" });
    const ids = groups.flatMap((g) => g.rows.map((r) => r.item.id));
    expect(ids).toEqual(["a"]);
  });

});

describe("search spans all epics, ignoring the epic selection (#636)", () => {
  const TWO: Module[] = [
    { id: "m1", name: "Epic One", project_id: "p1", sequence_id: 1, key: "MEML-1", issue_type: MODULE_TYPE },
    { id: "m2", name: "Epic Two", project_id: "p1", sequence_id: 2, key: "MEML-2", issue_type: MODULE_TYPE },
  ];
  it("groupBacklog: a query finds a No-epic hit even when an epic is selected", () => {
    const story = wi({ id: "s1", parent_id: "m1", name: "Story" });
    const orphan = wi({ id: "t1", parent_id: null, name: "Orphan" });
    const groups = groupBacklog([story, orphan], TWO, { query: "orphan" }, { epicIds: ["m1"], stateIds: [] });
    const ids = groups.flatMap((g) => g.rows.map((r) => r.item.id));
    expect(ids).toEqual(["t1"]);
  });

  it("groupBacklog: a bare ticket number matches the key across epics", () => {
    // Only No-epic selected, but "34" still finds the in-epic ticket MEML-34.
    const inEpic = wi({ id: "x", parent_id: "m1", key: "MEML-34", name: "Auth" });
    const groups = groupBacklog([inEpic], TWO, { query: "34" }, { epicIds: [NO_EPIC], stateIds: [] });
    const ids = groups.flatMap((g) => g.rows.map((r) => r.item.id));
    expect(ids).toEqual(["x"]);
  });

});

describe("groupBacklogByState (#828)", () => {
  const STATES = [DONE, BACKLOG, STARTED, TODO, CANCELLED]; // deliberately unordered
  const story = wi({ id: "s1", parent_id: "m1", state: STARTED, rank: "b" });
  const subDone = wi({ id: "st1", parent_id: "s1", state: DONE, rank: "a" });
  const subSame = wi({ id: "st2", parent_id: "s1", state: STARTED, rank: "c" });
  const orphanTodo = wi({ id: "t1", parent_id: null, state: TODO });
  const noState = wi({ id: "n1", parent_id: null, state: null });

  it("renders one section per state in frozen group order, cancelled suppressed, empty sections kept", () => {
    const groups = groupBacklogByState([story, orphanTodo], STATES, MODULES, EMPTY);
    expect(groups.map((g) => g.state?.id)).toEqual([
      "st-backlog",
      "st-todo",
      "st-prog",
      "st-done",
    ]);
    expect(groups.find((g) => g.state?.id === "st-backlog")?.rows).toHaveLength(0);
    expect(groups.find((g) => g.state?.id === "st-prog")?.rows[0].item.id).toBe("s1");
    expect(groups.find((g) => g.state?.id === "st-todo")?.rows[0].item.id).toBe("t1");
  });

  it("keeps sub-tasks nested-only: no flat row of their own in any section", () => {
    const groups = groupBacklogByState([story, subDone, subSame], STATES, MODULES, EMPTY);
    const started = groups.find((g) => g.state?.id === "st-prog")!;
    const done = groups.find((g) => g.state?.id === "st-done")!;
    // Sub-tasks never surface as their own flat section rows…
    expect(started.rows.map((r) => r.item.id)).toEqual(["s1"]);
    expect(started.total).toBe(1);
    expect(done.rows).toHaveLength(0);
    expect(done.total).toBe(0);
    // …only nested under their parent row's expandable subtree.
    const parentRow = started.rows[0];
    expect(parentRow.children.map((c) => c.item.id)).toEqual(["st1", "st2"]);
    expect(parentRow.children[0].depth).toBe(1);
    // cardMeta still annotates hierarchy for the nested rows.
    expect(started.cardMeta["st2"]).toEqual({ isSubtask: true, parentKey: "MEML-s1" });
    expect(started.cardMeta["s1"].isSubtask).toBe(false);
  });

  it("leads with a No State section only when populated and no state chips are active", () => {
    const withOrphan = groupBacklogByState([noState, story], STATES, MODULES, EMPTY);
    expect(withOrphan[0].state).toBeNull();
    expect(withOrphan[0].rows[0].item.id).toBe("n1");

    const without = groupBacklogByState([story], STATES, MODULES, EMPTY);
    expect(without[0].state?.id).toBe("st-backlog");

    const filtered = groupBacklogByState([noState, story], STATES, MODULES, { ...EMPTY }, { epicIds: [], stateIds: ["st-prog"] });
    expect(filtered.map((g) => g.state?.id)).toEqual(["st-prog"]);
    expect(filtered[0].rows.map((r) => r.item.id)).toEqual(["s1"]);
  });

  it("narrows by the epic axis and relaxes it while searching (#636)", () => {
    const inEpic = wi({ id: "e1", parent_id: "m1", state: TODO });
    const outside = wi({ id: "o1", parent_id: null, state: TODO, name: "findme" });
    const narrowed = groupBacklogByState([inEpic, outside], STATES, MODULES, { ...EMPTY }, { epicIds: ["m1"], stateIds: [] });
    const todoRows = narrowed.find((g) => g.state?.id === "st-todo")!.rows;
    expect(todoRows.map((r) => r.item.id)).toEqual(["e1"]);

    const searched = groupBacklogByState([inEpic, outside], STATES, MODULES, { ...EMPTY, query: "findme" }, { epicIds: ["m1"], stateIds: [] });
    const hits = searched.flatMap((g) => g.rows.map((r) => r.item.id));
    expect(hits).toEqual(["o1"]); // epic axis relaxed, query still filters
  });

  it("Story-only default hides a non-Story child's flat row but keeps it reachable via expansion (#906)", () => {
    // A typed Implementation child of the Story: never its own flat row under
    // the Story-only default, but still hangs off the expanded parent.
    const impl = wi({ id: "st1", parent_id: "s1", state: DONE, rank: "a", issue_type: IMPL_TYPE });
    const groups = groupBacklogByState([story, impl], STATES, MODULES, EMPTY);
    const done = groups.find((g) => g.state?.id === "st-done")!;
    expect(done.rows).toHaveLength(0); // no flat row for the non-Story child
    const started = groups.find((g) => g.state?.id === "st-prog")!;
    expect(started.rows[0].children.map((c) => c.item.id)).toEqual(["st1"]);
  });

  it("keeps PathFind children out of top-level state sections", () => {
    const pathfind = wi({ id: "pf1", parent_id: "s1", state: DONE, issue_type: PATHFIND_TYPE });
    const impl = wi({ id: "i1", parent_id: "s1", state: DONE, issue_type: IMPL_TYPE });
    const orphan = wi({ id: "pf2", parent_id: null, state: DONE, issue_type: PATHFIND_TYPE });
    const dangling = wi({ id: "pf3", parent_id: "missing", state: DONE, issue_type: PATHFIND_TYPE });
    const groups = groupBacklogByState(
      [story, pathfind, impl, orphan, dangling], STATES, MODULES, EMPTY,
    );
    const done = groups.find((g) => g.state?.id === "st-done")!;
    expect(done.rows).toHaveLength(0);
    expect(done.total).toBe(0);
    expect(groups.find((g) => g.state?.id === "st-prog")!.rows[0].children.map((c) => c.item.id))
      .toEqual(["pf1", "i1"]);
  });

  it("keeps PathFind children out of top-level state sections under filters", () => {
    const pathfind = wi({
      id: "pf1", parent_id: "s1", state: DONE, issue_type: PATHFIND_TYPE,
      name: "discovery target",
    });
    const items = [story, pathfind];
    const matching = groupBacklogByState(
      items, STATES, MODULES, { query: "discovery" },
      { epicIds: ["m1"], stateIds: ["st-done"] },
    );
    expect(matching.flatMap((g) => g.rows.map((r) => r.item.id))).toEqual([]);
    const wrongEpic = groupBacklogByState(
      items, STATES, MODULES, { query: "" },
      { epicIds: [NO_EPIC], stateIds: ["st-done"] },
    );
    expect(wrongEpic.flatMap((g) => g.rows)).toHaveLength(0);
    const wrongState = groupBacklogByState(
      items, STATES, MODULES, { query: "" },
      { epicIds: ["m1"], stateIds: ["st-todo"] },
    );
    expect(wrongState.flatMap((g) => g.rows)).toHaveLength(0);
  });

  it("keeps module grouping Story-only while counting loaded PathFind descendants", () => {
    const pathfind = wi({ id: "pf1", parent_id: "s1", state: DONE, issue_type: PATHFIND_TYPE });
    const activePathfind = wi({ id: "pf2", parent_id: "s1", state: STARTED, issue_type: PATHFIND_TYPE });
    const groups = groupBacklog([story, pathfind, activePathfind], MODULES, EMPTY);
    expect(groups[0].rows.map((r) => r.item.id)).toEqual(["s1"]);
    expect(groups[0].rows[0].children).toHaveLength(0);
    expect({ done: groups[0].done, total: groups[0].total }).toEqual({ done: 1, total: 3 });
  });

});

describe("sub-tasks are nested-only in state sections", () => {
  const STATES = [DONE, BACKLOG, STARTED, TODO, CANCELLED];
  const parent = wi({ id: "p", parent_id: "m1", state: STARTED, rank: "a" });
  const childSame = wi({ id: "c", parent_id: "p", state: STARTED, rank: "b" });
  const childDone = wi({ id: "d", parent_id: "p", state: DONE, rank: "c" });

  it("a same-state child appears only under its parent, never flat", () => {
    const groups = groupBacklogByState([parent, childSame], STATES, MODULES, EMPTY);
    const started = groups.find((g) => g.state?.id === "st-prog")!;
    expect(started.rows.map((r) => r.item.id)).toEqual(["p"]);
    expect(started.rows[0].children.map((c) => c.item.id)).toEqual(["c"]);
  });

  it("a different-state child gets no flat row in its own section either", () => {
    const groups = groupBacklogByState([parent, childDone], STATES, MODULES, EMPTY);
    expect(groups.find((g) => g.state?.id === "st-prog")!.rows.map((r) => r.item.id)).toEqual([
      "p",
    ]);
    expect(groups.find((g) => g.state?.id === "st-done")!.rows).toHaveLength(0);
    // Still reachable nested under the parent's subtree.
    expect(
      groups.find((g) => g.state?.id === "st-prog")!.rows[0].children.map((c) => c.item.id),
    ).toEqual(["d"]);
  });
});

describe("status-list order by sort_order, not group rank (CODIN-859)", () => {
  // Implement and Review share the started group; Refinement and Ready share
  // unstarted. Group rank alone can't order the pairs — sort_order must. States
  // are supplied deliberately reversed within each group.
  const IDEA = { id: "st-idea", name: "Idea", group: "backlog", color: null, sort_order: 0 };
  const READY = { id: "st-ready", name: "Ready", group: "unstarted", color: null, sort_order: 2 };
  const REFINE = { id: "st-refine", name: "Refinement", group: "unstarted", color: null, sort_order: 1 };
  const REVIEW = { id: "st-review", name: "Review", group: "started", color: null, sort_order: 4 };
  const IMPLEMENT = { id: "st-impl", name: "Implement", group: "started", color: null, sort_order: 3 };
  const STATES = [REVIEW, READY, IDEA, IMPLEMENT, REFINE]; // shuffled

  it("groupBacklogByState renders sections in sort_order", () => {
    const groups = groupBacklogByState([], STATES, MODULES, EMPTY);
    expect(groups.map((g) => g.state?.name)).toEqual([
      "Idea",
      "Refinement",
      "Ready",
      "Implement",
      "Review",
    ]);
  });
});

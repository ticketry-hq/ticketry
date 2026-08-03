import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>("../shared/api/client");
  return {
    ...actual,
    listIssueTypes: vi.fn(),
    listStates: vi.fn(),
    listSubtreeRunCapabilities: vi.fn(),
    createIssueType: vi.fn(),
    patchIssueType: vi.fn(),
    deleteIssueType: vi.fn(),
    reorderIssueTypes: vi.fn(),
    createState: vi.fn(),
    patchState: vi.fn(),
    deleteState: vi.fn(),
    reorderStates: vi.fn(),
  };
});

import * as api from "../shared/api/client";
import { ApiError } from "../shared/api/client";
import { useSettingsStore } from "../features/settings/store";
import {
  getCapabilitiesSnapshot,
  getIssueTypesSnapshot,
  seedCapabilities,
  seedIssueTypes,
} from "../features/settings/queries";
import { getStatesSnapshot, seedStates } from "../shared/query/stateCatalog";
import { queryClient } from "../shared/query/queryClient";
import type { IssueType, State } from "../shared/api/types";

// The settings surface reads server state from the query cache; these read
// through the same accessors the store's actions write.
const issueTypes = () => getIssueTypesSnapshot("p1");
const states = () => getStatesSnapshot("p1");
const capabilities = () => getCapabilitiesSnapshot("p1");

const fn = (m: unknown) => m as ReturnType<typeof vi.fn>;

const EPIC: IssueType = {
  id: "epic",
  name: "Epic",
  level: "module",
  color: null,
  sort_order: 0,
};
const TASK: IssueType = {
  id: "task",
  name: "Task",
  level: "task",
  color: null,
  sort_order: 1,
};
const STORY: IssueType = {
  id: "story",
  name: "Story",
  level: "task",
  color: null,
  sort_order: 2,
};

const STATE = (id: string, order: number): State => ({
  id,
  name: id,
  group: "started",
  color: null,
  sort_order: order,
});

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  useSettingsStore.setState({
    projectId: "p1",
    error: null,
    loadError: null,
  });
  seedIssueTypes("p1", [EPIC, TASK, STORY]);
  seedStates("p1", [STATE("s1", 0), STATE("s2", 1)]);
  seedCapabilities("p1", {});
});

describe("settingsStore", () => {
  it("loadSettings sorts both collections by sort_order", async () => {
    fn(api.listIssueTypes).mockResolvedValue([STORY, EPIC, TASK]);
    fn(api.listStates).mockResolvedValue([STATE("s2", 1), STATE("s1", 0)]);
    fn(api.listSubtreeRunCapabilities).mockResolvedValue({
      story: ["s2"],
    });

    await useSettingsStore.getState().loadSettings("p1");
    expect(issueTypes().map((t) => t.id)).toEqual(["epic", "task", "story"]);
    expect(states().map((x) => x.id)).toEqual(["s1", "s2"]);
    expect(capabilities()).toEqual({ story: ["s2"] });
  });

  it("retries settings after a failed load even when capabilities are synchronized", async () => {
    seedIssueTypes("p1", []);
    seedStates("p1", []);
    fn(api.listIssueTypes)
      .mockRejectedValueOnce(new Error("backend unavailable"))
      .mockResolvedValueOnce([TASK]);
    fn(api.listStates).mockResolvedValue([STATE("ready", 0)]);
    fn(api.listSubtreeRunCapabilities).mockResolvedValue({});

    await useSettingsStore.getState().loadSettings("p1");
    useSettingsStore
      .getState()
      .synchronizeSubtreeRunCapabilities("p1", "task", ["ready"]);
    await useSettingsStore.getState().loadSettings("p1");

    expect(api.listIssueTypes).toHaveBeenCalledTimes(2);
    expect(api.listStates).toHaveBeenCalledTimes(2);
    expect(issueTypes()).toEqual([TASK]);
    expect(states()).toEqual([STATE("ready", 0)]);
  });

  it("does not let a slow settings load overwrite a newer synchronized and refreshed capability map", async () => {
    let resolveSlowCapabilities:
      | ((capabilities: Record<string, string[]>) => void)
      | undefined;
    const slowCapabilities = new Promise<Record<string, string[]>>((resolve) => {
      resolveSlowCapabilities = resolve;
    });
    fn(api.listIssueTypes).mockResolvedValue([TASK]);
    fn(api.listStates).mockResolvedValue([STATE("ready", 0)]);
    fn(api.listSubtreeRunCapabilities)
      .mockReturnValueOnce(slowCapabilities)
      .mockResolvedValueOnce({ task: ["ready"] });

    const load = useSettingsStore.getState().loadSettings("p1");
    useSettingsStore
      .getState()
      .synchronizeSubtreeRunCapabilities("p1", "task", ["ready"]);
    await useSettingsStore.getState().refreshSubtreeRunCapabilities("p1");
    resolveSlowCapabilities?.({ task: ["stale"] });
    await load;

    expect(capabilities()).toEqual({ task: ["ready"] });
  });

  it("loadSettings always refetches, so out-of-band changes land", async () => {
    fn(api.listIssueTypes).mockResolvedValue([EPIC]);
    fn(api.listStates).mockResolvedValue([STATE("s1", 0)]);
    fn(api.listSubtreeRunCapabilities).mockResolvedValue({});

    await useSettingsStore.getState().loadSettings("p1");
    fn(api.listIssueTypes).mockResolvedValue([EPIC, TASK]);
    await useSettingsStore.getState().loadSettings("p1");

    expect(api.listIssueTypes).toHaveBeenCalledTimes(2);
    expect(issueTypes().map((t) => t.id)).toEqual(["epic", "task"]);
  });

  it("ensureSettings shares one request across concurrent callers", async () => {
    // Nothing cached yet: this is what a first visit to the project looks like.
    queryClient.clear();
    fn(api.listIssueTypes).mockResolvedValue([EPIC]);
    fn(api.listStates).mockResolvedValue([STATE("s1", 0)]);
    fn(api.listSubtreeRunCapabilities).mockResolvedValue({});

    await Promise.all([
      useSettingsStore.getState().ensureSettings("p1"),
      useSettingsStore.getState().ensureSettings("p1"),
      useSettingsStore.getState().ensureSettings("p1"),
    ]);

    expect(api.listIssueTypes).toHaveBeenCalledTimes(1);
  });

  it("ensureSettings skips a loaded project but retries after a failure", async () => {
    queryClient.clear();
    fn(api.listIssueTypes).mockResolvedValue([EPIC]);
    fn(api.listStates).mockResolvedValue([STATE("s1", 0)]);
    fn(api.listSubtreeRunCapabilities).mockResolvedValue({});

    await useSettingsStore.getState().ensureSettings("p1");
    await useSettingsStore.getState().ensureSettings("p1");
    expect(api.listIssueTypes).toHaveBeenCalledTimes(1);

    queryClient.clear();
    fn(api.listIssueTypes).mockRejectedValue(new ApiError(500, "down", null));
    await Promise.all([
      useSettingsStore.getState().ensureSettings("p1"),
      useSettingsStore.getState().ensureSettings("p1"),
    ]);
    expect(api.listIssueTypes).toHaveBeenCalledTimes(2);
    expect(useSettingsStore.getState().loadError).toContain("500");
  });

  it("createType appends the server row", async () => {
    const bug = { ...STORY, id: "bug", name: "Bug", sort_order: 3 };
    fn(api.createIssueType).mockResolvedValue(bug);
    await useSettingsStore.getState().createType({ name: "Bug", level: "task" });
    expect(issueTypes().map((t) => t.id)).toContain("bug");
  });

  it("patchType rolls back on ApiError", async () => {
    fn(api.patchIssueType).mockRejectedValue(new ApiError(409, "dup", null));
    await useSettingsStore.getState().patchType("story", { name: "Task" });
    expect(issueTypes().find((t) => t.id === "story")!.name).toBe("Story");
    expect(useSettingsStore.getState().error).toContain("409");
  });

  it("deleteType optimistically drops the row, restores on error", async () => {
    fn(api.deleteIssueType).mockResolvedValue(null);
    await useSettingsStore.getState().deleteType("story");
    expect(issueTypes().map((t) => t.id)).not.toContain("story");

    seedIssueTypes("p1", [EPIC, TASK, STORY]);
    fn(api.deleteIssueType).mockRejectedValue(new ApiError(409, "in use", null));
    await useSettingsStore.getState().deleteType("story");
    expect(issueTypes().map((t) => t.id)).toContain("story");
    expect(useSettingsStore.getState().error).toContain("409");
  });

  it("reorderStates applies the given order then reconciles with the server", async () => {
    fn(api.reorderStates).mockResolvedValue([STATE("s2", 0), STATE("s1", 1)]);
    await useSettingsStore.getState().reorderStates(["s2", "s1"]);
    expect(states().map((x) => x.id)).toEqual(["s2", "s1"]);
    expect(api.reorderStates).toHaveBeenCalledWith("p1", ["s2", "s1"]);
  });

  it("reorderStates rolls back on error", async () => {
    fn(api.reorderStates).mockRejectedValue(new ApiError(422, "bad set", null));
    await useSettingsStore.getState().reorderStates(["s2", "s1"]);
    expect(states().map((x) => x.id)).toEqual(["s1", "s2"]);
    expect(useSettingsStore.getState().error).toContain("422");
  });
});

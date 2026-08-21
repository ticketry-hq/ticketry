import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>("../shared/api/client");
  return {
    ...actual,
    listProjects: vi.fn(),
    listModules: vi.fn(),
    listModulePresentations: vi.fn(),
    getTasks: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  };
});

import * as api from "../shared/api/client";
import { ApiError } from "../shared/api/client";
import { normalizeView, useStudioStore } from "../features/projects/store";
import {
  getModulesSnapshot,
  getProjectsSnapshot,
  seedProjects,
} from "../features/projects";
import { useClientStore } from "../state/clientStore";
import { queryClient } from "../shared/query/queryClient";
import type { Module, Project } from "../shared/api/types";
import { seedModuleLinks } from "../features/module-links";
import { LAST_SELECTED_MODULE_KEY } from "../state/persistence";

const listProjects = api.listProjects as ReturnType<typeof vi.fn>;
const listModules = api.listModules as ReturnType<typeof vi.fn>;
const listModulePresentations = api.listModulePresentations as ReturnType<
  typeof vi.fn
>;
const getTasks = api.getTasks as ReturnType<typeof vi.fn>;
const createProject = api.createProject as ReturnType<typeof vi.fn>;
const updateProject = api.updateProject as ReturnType<typeof vi.fn>;
const deleteProject = api.deleteProject as ReturnType<typeof vi.fn>;

const P = (id: string): Project => ({
  id,
  name: id,
  slug: id.toUpperCase(),
    description: "",
    onboarding_required: false,
});

beforeEach(() => {
  localStorage.clear();
  queryClient.clear();
  seedModuleLinks([]);
  listProjects.mockReset();
  listModules.mockReset().mockResolvedValue([]);
  listModulePresentations.mockReset().mockResolvedValue([]);
  getTasks.mockReset().mockResolvedValue({
    rootIds: [],
    children: {},
    order: [],
    states: [],
    workItems: [],
  });
  createProject.mockReset();
  updateProject.mockReset();
  deleteProject.mockReset();
  useClientStore.getState().selectionClear();
  useStudioStore.setState({
    selectedProjectId: null,
    activeView: "backlog",
    error: null,
  });
});

describe("normalizeView", () => {
  it("passes known views and defaults unknown ones to backlog", () => {
    expect(normalizeView("orchestrator")).toBe("backlog");
    expect(normalizeView("studio")).toBe("backlog");
    expect(normalizeView("board")).toBe("backlog");
    expect(normalizeView("nonsense")).toBe("backlog");
    expect(normalizeView(undefined)).toBe("backlog");
    // "epics" is no longer a destination (#627) — a stale URL coerces to backlog.
    expect(normalizeView("epics")).toBe("backlog");
  });
});

describe("studioStore", () => {
  it("loadProjects populates the cached project list", async () => {
    listProjects.mockResolvedValue([{ id: "p1", name: "Studio", slug: "CODIN" }]);
    await useStudioStore.getState().loadProjects();
    expect(getProjectsSnapshot()).toHaveLength(1);
  });

  it("selectProject loads that project's modules", async () => {
    listModules.mockResolvedValue([
      { id: "m1", name: "Studio", project_id: "p1", sequence_id: 609, key: "CODIN-609" },
    ]);
    await useStudioStore.getState().selectProject("p1");
    const s = useStudioStore.getState();
    expect(s.selectedProjectId).toBe("p1");
    expect(getModulesSnapshot("p1")).toHaveLength(1);
    expect(listModules).toHaveBeenCalledWith("p1");
  });

  it("restores the last selected module when its project loads", async () => {
    listModules.mockResolvedValue([
      { id: "m1", name: "Studio", project_id: "p1" },
    ]);
    localStorage.setItem(LAST_SELECTED_MODULE_KEY, "m1");
    seedModuleLinks([{ id: "l1", module_id: "m1", local_path: "/repos/m1", created_at: "", updated_at: "" }]);

    await useStudioStore.getState().selectProject("p1");

    expect(useClientStore.getState().selectedModuleId).toBe("m1");
    expect(getTasks).toHaveBeenCalledWith("p1", "m1");
  });

  it("restores the remembered task after its module tree loads", async () => {
    listModules.mockResolvedValue([
      { id: "m1", name: "Studio", project_id: "p1" },
    ]);
    getTasks.mockResolvedValue({
      rootIds: ["story-1"],
      children: { "story-1": [] },
      order: ["story-1"],
      states: [],
      workItems: [],
    });
    localStorage.setItem(
      "studio.selectedTaskByModule:v1",
      JSON.stringify({ m1: "story-1" }),
    );
    localStorage.setItem(LAST_SELECTED_MODULE_KEY, "m1");
    seedModuleLinks([{ id: "l1", module_id: "m1", local_path: "/repos/m1", created_at: "", updated_at: "" }]);

    await useStudioStore.getState().selectProject("p1");

    expect(useClientStore.getState().selectedTaskId).toBe("story-1");
  });

  it("does not restore a remembered task missing from the loaded module", async () => {
    useStudioStore.setState({ selectedProjectId: "p1" });
    seedModuleLinks([{ id: "l1", module_id: "m1", local_path: "/repos/m1", created_at: "", updated_at: "" }]);
    getTasks.mockResolvedValue({
      rootIds: [],
      children: {},
      order: [],
      states: [],
      workItems: [],
    });
    localStorage.setItem(
      "studio.selectedTaskByModule:v1",
      JSON.stringify({ m1: "deleted-story" }),
    );

    await useClientStore.getState().selectModule("m1");

    expect(useClientStore.getState().selectedTaskId).toBeNull();
  });

  it("persists a module selection as one frontend-only value", async () => {
    seedModuleLinks([{ id: "l1", module_id: "m1", local_path: "/repos/m1", created_at: "", updated_at: "" }]);
    useStudioStore.setState({ selectedProjectId: "p1" });

    await useClientStore.getState().selectModule("m1");

    expect(localStorage.getItem(LAST_SELECTED_MODULE_KEY)).toBe("m1");
  });

  it("does not refetch modules for the already-selected project", async () => {
    listModules.mockResolvedValue([]);
    await useStudioStore.getState().selectProject("p1");
    await useStudioStore.getState().selectProject("p1");
    expect(listModules).toHaveBeenCalledTimes(1);
  });

  it("captures an api error instead of throwing to render", async () => {
    listProjects.mockRejectedValue(new ApiError(500, "boom", { detail: "boom" }));
    await expect(useStudioStore.getState().loadProjects()).resolves.toBeUndefined();
    expect(useStudioStore.getState().error).toBeNull();
    expect(getProjectsSnapshot()).toEqual([]);
  });

  it("selectProject keeps the server's module order", async () => {
    const M = (id: string): Module =>
      ({ id, name: id, project_id: "p1" }) as unknown as Module;
    listModules.mockResolvedValue([M("a"), M("b"), M("c")]);
    await useStudioStore.getState().selectProject("p1");
    expect(getModulesSnapshot("p1").map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("selectProject does not create a recent-project MRU list", async () => {
    await useStudioStore.getState().selectProject("p1");
    await useStudioStore.getState().selectProject("p2");
    expect(localStorage.getItem("studio.recentProjects")).toBeNull();
  });
});

describe("studioStore project CRUD (#665)", () => {
  it("createProject appends the new project to the list", async () => {
    const created = P("p1");
    createProject.mockResolvedValue(created);
    const result = await useStudioStore
      .getState()
      .createProject({ slug: "P1", name: "p1" });
    expect(result).toEqual(created);
    expect(getProjectsSnapshot()).toEqual([created]);
  });

  it("createProject returns null on a duplicate-key error and appends nothing", async () => {
    createProject.mockRejectedValue(new ApiError(409, "dup", { detail: "dup" }));
    const result = await useStudioStore
      .getState()
      .createProject({ slug: "MEML", name: "dup" });
    expect(result).toBeNull();
    expect(getProjectsSnapshot()).toEqual([]);
  });

  it("updateProject replaces the row in the list", async () => {
    seedProjects([P("p1"), P("p2")]);
    const updated = { ...P("p1"), name: "Renamed" };
    updateProject.mockResolvedValue(updated);
    await useStudioStore.getState().updateProject("p1", { name: "Renamed" });
    expect(getProjectsSnapshot()[0].name).toBe("Renamed");
    expect(getProjectsSnapshot()[1].id).toBe("p2");
  });

  it("deleteProject of the selected project removes it, clears selection, and resolves the MRU survivor", async () => {
    seedProjects([P("p1"), P("p2")]);
    // p2 then p1 used → MRU [p1, p2]; deleting p1 leaves p2 as the survivor.
    await useStudioStore.getState().selectProject("p2");
    await useStudioStore.getState().selectProject("p1");
    useClientStore.getState().selectionToggle("backlog", "issue-x");
    deleteProject.mockResolvedValue(undefined);

    const result = await useStudioStore.getState().deleteProject("p1");

    expect(result).toEqual({ redirect: true, targetId: "p2" });
    expect(getProjectsSnapshot().map((p) => p.id)).toEqual(["p2"]);
    expect(useClientStore.getState().selection.ids.size).toBe(0);
  });

  it("deleteProject of a non-selected project removes it without a redirect", async () => {
    seedProjects([P("p1"), P("p2")]);
    useStudioStore.setState({ selectedProjectId: "p1" });
    deleteProject.mockResolvedValue(undefined);
    const result = await useStudioStore.getState().deleteProject("p2");
    expect(result).toEqual({ redirect: false, targetId: null });
    expect(getProjectsSnapshot().map((p) => p.id)).toEqual(["p1"]);
  });

  it("deleteProject of the last project redirects to null (→ create screen)", async () => {
    seedProjects([P("p1")]);
    useStudioStore.setState({ selectedProjectId: "p1" });
    deleteProject.mockResolvedValue(undefined);
    const result = await useStudioStore.getState().deleteProject("p1");
    expect(result).toEqual({ redirect: true, targetId: null });
  });

  it("deleteProject keeps the list intact when the request fails", async () => {
    seedProjects([P("p1"), P("p2")]);
    useStudioStore.setState({ selectedProjectId: "p1" });
    deleteProject.mockRejectedValue(new ApiError(500, "boom", { detail: "boom" }));
    const result = await useStudioStore.getState().deleteProject("p1");
    expect(result).toEqual({ redirect: false, targetId: null });
    // Nothing was removed — the delete never landed.
    expect(getProjectsSnapshot().map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

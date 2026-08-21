import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  createProject: vi.fn(),
  getConfig: vi.fn(),
  getKeybindingOverrides: vi.fn(),
  getTasks: vi.fn(),
  listModuleLinks: vi.fn(),
  listModulePresentations: vi.fn(),
  listModules: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...api,
}));

import { bootstrapStudio } from "../app/startup/bootstrapStudio";
import { useModalStore } from "../app/modal";
import { useStudioStore } from "../features/projects/store";
import { queryClient } from "../shared/query/queryClient";
import { LAST_SELECTED_MODULE_KEY } from "../state/persistence";
import { useClientStore } from "../state/clientStore";

const defaultProject = {
  id: "project-default",
  name: "Coding",
  slug: "CDN",
  description: "",
  onboarding_required: false,
};
const extraProject = {
  ...defaultProject,
  id: "project-extra",
  name: "Unrelated",
  slug: "EXT",
};
const modules = [
  {
    id: "module-a",
    name: "A",
    project_id: defaultProject.id,
    sequence_id: 1,
    key: "CDN-1",
  },
  {
    id: "module-b",
    name: "B",
    project_id: defaultProject.id,
    sequence_id: 2,
    key: "CDN-2",
  },
];

describe("default-project Module-link navigation acceptance", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    useStudioStore.setState({ selectedProjectId: null, error: null });
    useClientStore.setState({ selectedModuleId: null, selectedTaskId: null });
    useModalStore.setState({ modalStack: [] });
    api.createProject.mockReset();
    api.getConfig.mockReset();
    api.getKeybindingOverrides.mockReset().mockResolvedValue({ value: [] });
    api.getTasks.mockReset().mockResolvedValue({
      rootIds: [],
      children: {},
      order: [],
      states: [],
      workItems: [],
    });
    api.listModuleLinks.mockReset().mockResolvedValue([
      {
        id: "link-a",
        module_id: "module-a",
        local_path: "/repos/a",
        created_at: "2026-08-19T00:00:00Z",
        updated_at: "2026-08-19T00:00:00Z",
      },
      {
        id: "link-b",
        module_id: "module-b",
        local_path: "/repos/b",
        created_at: "2026-08-19T00:00:00Z",
        updated_at: "2026-08-19T00:00:00Z",
      },
    ]);
    api.listModulePresentations.mockReset().mockResolvedValue([]);
    api.listModules.mockReset().mockResolvedValue(modules);
    api.listProjects.mockReset().mockResolvedValue([
      extraProject,
      defaultProject,
    ]);
  });

  it("[overhaul-132] loads the default project's modules without changing a closed sidebar choice", async () => {
    useClientStore.getState().setSidebarVisible(false);

    expect(await bootstrapStudio()).toBe("ready");

    expect(api.getConfig).not.toHaveBeenCalled();
    expect(api.createProject).not.toHaveBeenCalled();
    expect(useStudioStore.getState().selectedProjectId).toBe(defaultProject.id);
    expect(api.listModules).toHaveBeenCalledWith(defaultProject.id);
    expect(useClientStore.getState().sidebarVisible).toBe(false);
    expect(useClientStore.getState().focusedPane).toBe("tasks");
  });

  it("[overhaul-133] restores one frontend-only last-module value", async () => {
    localStorage.setItem(LAST_SELECTED_MODULE_KEY, "module-b");

    expect(await bootstrapStudio()).toBe("ready");

    expect(useClientStore.getState().selectedModuleId).toBe("module-b");
    expect(api.getTasks).toHaveBeenCalledWith(defaultProject.id, "module-b");
    expect(localStorage.getItem(LAST_SELECTED_MODULE_KEY)).toBe("module-b");
    expect(localStorage.getItem("studio.recentProjects")).toBeNull();
  });

  it("[overhaul-144] waits for Module links and keeps a missing-folder prompt singular", async () => {
    useStudioStore.setState({ selectedProjectId: defaultProject.id });
    let resolveLinks!: (links: Awaited<ReturnType<typeof api.listModuleLinks>>) => void;
    api.listModuleLinks.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveLinks = resolve;
      }),
    );

    const selectLinkedModule = useClientStore.getState().selectModule("module-a");
    expect(useModalStore.getState().modalStack).toEqual([]);

    resolveLinks([
      {
        id: "link-a",
        module_id: "module-a",
        local_path: "/repos/a",
        created_at: "2026-08-19T00:00:00Z",
        updated_at: "2026-08-19T00:00:00Z",
      },
    ]);
    await selectLinkedModule;

    expect(useClientStore.getState().selectedModuleId).toBe("module-a");
    expect(useModalStore.getState().modalStack).toEqual([]);

    await Promise.all([
      useClientStore.getState().selectModule("module-b"),
      useClientStore.getState().selectModule("module-b"),
    ]);
    expect(useModalStore.getState().modalStack).toEqual([
      {
        type: "module-folder",
        payload: { moduleId: "module-b", resumeModuleSelection: true },
      },
    ]);
  });

  it("[overhaul-168] honors a stored-open sidebar preference after an upgrade", async () => {
    localStorage.setItem("studio.sidebarVisible:v1", "false");
    localStorage.setItem("studio.sidebarVisible:v2", "true");
    vi.resetModules();

    const [
      { bootstrapStudio: bootstrapReloaded },
      { useClientStore: reloadedStore },
    ] = await Promise.all([
      import("../app/startup/bootstrapStudio"),
      import("../state/clientStore"),
    ]);

    expect(await bootstrapReloaded()).toBe("ready");
    expect(reloadedStore.getState().sidebarVisible).toBe(true);
    expect(reloadedStore.getState().focusedPane).toBe("modules");
    expect(localStorage.getItem("studio.sidebarVisible:v1")).toBe("false");
    expect(localStorage.getItem("studio.sidebarVisible:v2")).toBe("true");
  });
});

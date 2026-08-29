import { beforeEach, describe, expect, it, vi } from "vitest";

// The two host reads startup must complete before it can prompt for anything.
vi.mock("../features/projects/queries", async () => ({
  ...(await vi.importActual("../features/projects/queries")),
  loadProjects: vi.fn(),
  loadModules: vi.fn(),
  getModulesSnapshot: vi.fn(),
}));

vi.mock("../features/projects/queries/readTransport", async () => ({
  ...(await vi.importActual("../features/projects/queries/readTransport")),
  readWorkspace: vi.fn(),
}));

// The host read: bootstrap must have answered it before anything can prompt
// for a folder, so the test replaces the read rather than the cache.
vi.mock("../features/module-links", async () => ({
  ...(await vi.importActual("../features/module-links")),
  loadModuleLinks: vi.fn(),
}));

vi.mock("../features/work-items/queries/readTransport", async () => ({
  ...(await vi.importActual("../features/work-items/queries/readTransport")),
  readModuleTreeRecords: vi.fn(),
}));

vi.mock("../app/navigation/keymapSettings", async () => ({
  ...(await vi.importActual("../app/navigation/keymapSettings")),
  loadKeybindingOverrides: vi.fn(async () => {}),
}));

import { bootstrapStudio } from "../app/startup/bootstrapStudio";
import { useModalStore } from "../app/modal";
import * as moduleLinks from "../features/module-links";
import { getModuleLinks, seedModuleLinks } from "../features/module-links";
import { getProjectsSnapshot, seedProjects, useStudioStore } from "../features/projects";
import * as projectQueries from "../features/projects/queries";
import * as projectReadTransport from "../features/projects/queries/readTransport";
import * as workItemReadTransport from "../features/work-items/queries/readTransport";
import { useClientStore } from "../state/clientStore";
import { RECENT_MODULE_KEY } from "../state/persistence";

const loadProjects = projectQueries.loadProjects as ReturnType<typeof vi.fn>;
const loadModules = projectQueries.loadModules as ReturnType<typeof vi.fn>;
const getModulesSnapshot = projectQueries.getModulesSnapshot as ReturnType<
  typeof vi.fn
>;
const readWorkspace = projectReadTransport.readWorkspace as ReturnType<typeof vi.fn>;
const loadModuleLinks = moduleLinks.loadModuleLinks as ReturnType<typeof vi.fn>;
const readModuleTree = workItemReadTransport.readModuleTreeRecords as ReturnType<
  typeof vi.fn
>;

const INSTALLATION_PROJECT = {
  id: "project-1",
  name: "Coding",
  slug: "CDN",
  description: "",
  is_automatic: false,
};

const MODULES = [
  { id: "module-1", name: "Runtime", project_id: "project-1" },
  { id: "module-2", name: "Shell", project_id: "project-1" },
];

/** The order in which the host answered each read during one bootstrap. */
let reads: string[] = [];

function seedHost({
  projects = [INSTALLATION_PROJECT],
  links = [{ id: "link-module-1", moduleId: "module-1", path: "/repos/runtime" }],
}: {
  projects?: unknown[];
  links?: { id: string; moduleId: string; path: string }[];
} = {}): void {
  loadProjects.mockImplementation(async () => {
    reads.push("projects");
    seedProjects(projects as never);
    return projects;
  });
  loadModuleLinks.mockImplementation(async () => {
    reads.push("module-links");
    seedModuleLinks(links);
    return links;
  });
}

describe("startup acceptance", () => {
  beforeEach(() => {
    reads = [];
    localStorage.clear();
    seedProjects([]);
    seedModuleLinks([]);
    loadModules.mockReset().mockResolvedValue(MODULES);
    getModulesSnapshot.mockReset().mockReturnValue(MODULES);
    readWorkspace
      .mockReset()
      .mockResolvedValue({
        id: "workspace-1",
        name: "Ticketry",
        slug: "tic",
        onboarding_required: false,
      });
    readModuleTree.mockReset().mockResolvedValue({
      rootIds: [],
      children: {},
      order: [],
      states: [],
      workItems: [],
    });
    useStudioStore.setState({ selectedProjectId: null, error: null });
    useClientStore.setState({
      selectedModuleId: null,
      selectedTaskId: null,
      sidebarVisible: false,
      focusedPane: "tasks",
    });
    useModalStore.setState({ modalStack: [] });
    seedHost();
  });

  it("opens a fresh install on the installation project with no profile file", async () => {
    expect(await bootstrapStudio()).toBe("ready");

    expect(useStudioStore.getState().selectedProjectId).toBe("project-1");
    // No profile index, no profile selection, no recent-project list.
    expect(localStorage.getItem("studio.recentProjects")).toBeNull();
    expect(getProjectsSnapshot()).toHaveLength(1);
  });

  it("reads the project and its links before anything can prompt", async () => {
    expect(await bootstrapStudio()).toBe("ready");

    expect(reads).toContain("projects");
    expect(reads).toContain("module-links");
    expect(getModuleLinks()).toHaveLength(1);
    // A folder prompt during startup would mean the links had not been read.
    expect(useModalStore.getState().modalStack).toEqual([]);
  });

  it("restores the one remembered module across a restart", async () => {
    localStorage.setItem(RECENT_MODULE_KEY, "module-1");

    expect(await bootstrapStudio()).toBe("ready");

    expect(useClientStore.getState().selectedModuleId).toBe("module-1");
    expect(useClientStore.getState().focusedPane).toBe("tasks");
  });

  it("leaves an unlinked remembered module unopened rather than prompting", async () => {
    localStorage.setItem(RECENT_MODULE_KEY, "module-2");

    expect(await bootstrapStudio()).toBe("ready");

    expect(useClientStore.getState().selectedModuleId).toBeNull();
    expect(useModalStore.getState().modalStack).toEqual([]);
    expect(useClientStore.getState().focusedPane).toBe("modules");
  });

  it("ignores a remembered module the project no longer has", async () => {
    localStorage.setItem(RECENT_MODULE_KEY, "module-removed");
    seedHost({
      links: [
        { id: "link-removed", moduleId: "module-removed", path: "/repos/gone" },
      ],
    });

    expect(await bootstrapStudio()).toBe("ready");

    expect(useClientStore.getState().selectedModuleId).toBeNull();
  });

  it("reports the host as unavailable rather than provisioning", async () => {
    loadProjects.mockRejectedValue(new TypeError("fetch failed"));

    expect(await bootstrapStudio()).toBe("unavailable");
  });

  it("reports provisioning while the installation project cannot resolve", async () => {
    loadProjects.mockRejectedValue(new Error("state.db is still adopting"));

    expect(await bootstrapStudio()).toBe("provisioning");
  });
});

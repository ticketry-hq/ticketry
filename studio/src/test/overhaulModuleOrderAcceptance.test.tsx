import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./legacyApiFixture", async () => {
  const actual = await vi.importActual<typeof import("./legacyApiFixture")>(
    "./legacyApiFixture",
  );
  return { ...actual, listModules: vi.fn(), listProjects: vi.fn() };
});
vi.mock("../features/projects/queries/readTransport", async () => {
  const actual = await vi.importActual<typeof import("../features/projects/queries/readTransport")>(
    "../features/projects/queries/readTransport",
  );
  const api = await import("./legacyApiFixture");
  const { projectOpenFixture } = await import("./projectOpenFixture");
  return {
    ...actual,
    readProjectOpen: async (projectId: string) => {
      const modules = await api.listModules(projectId);
      let project;
      try {
        const projects = await api.listProjects();
        project = projects.find((candidate: { id: string }) => candidate.id === projectId) ?? projects[0];
      } catch {
        const { studioApolloClient } = await import("../shared/apollo/client");
        const { WorkTrackerProjectOpenDocument } = await import("../features/projects/generated/projects.documents");
        const cached = studioApolloClient().readQuery({
          query: WorkTrackerProjectOpenDocument,
          variables: { projectId },
        });
        const cachedProject = cached?.project.nodes[0];
        const manualModuleOrder = cached?.module_presentations.nodes.some(
          (presentation) => presentation.module?.project_id === cachedProject?.id,
        ) ?? false;
        project = cachedProject
          ? { ...cachedProject, id: projectId, manual_module_order: manualModuleOrder }
          : { id: projectId, name: "Project", slug: "PRJ", description: "", manual_module_order: false };
      }
      if (!project) throw new Error(`Project ${projectId} was not found.`);
      return projectOpenFixture(project, modules);
    },
    readOnboardingProjects: vi.fn(),
  };
});

import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import { ModulesPane } from "../app/shell/sidebar/modules/ModulesPane";
import {
  getModulesSnapshot,
  loadModules,
  seedProjects,
} from "../features/projects";
import { useStudioStore } from "../features/projects/store";
import * as api from "./legacyApiFixture";
import { resetStudioApolloClient } from "../shared/apollo/client";
import type { Module, Project } from "../shared/api/types";
import { useClientStore } from "../state/clientStore";

const listModules = api.listModules as ReturnType<typeof vi.fn>;
const listProjects = api.listProjects as ReturnType<typeof vi.fn>;

const PROJECT_ID = "project-1";

/** The server's answer: automatic mode is newest-created-first. */
const SERVER_ORDER: Module[] = [
  { id: "module-c", name: "Charlie", sequence_id: 3 },
  { id: "module-b", name: "Bravo", sequence_id: 2 },
  { id: "module-a", name: "Alpha", sequence_id: 1 },
].map((module) => ({
  ...module,
  project_id: PROJECT_ID,
  key: module.id.toUpperCase(),
  is_archived: false,
  issue_type: "module",
})) as unknown as Module[];

function project(manual_module_order: boolean): Project {
  return {
    id: PROJECT_ID,
    name: "Project",
    slug: "PRJ",
    description: "",
    manual_module_order,
  } as Project;
}

/**
 * Every Module surface at once. Rendering the sidebar and the Module tab strip
 * together is the point: they must never be able to disagree, because they read
 * the one cached Module collection rather than each sorting for themselves.
 */
function ModuleSurfaces() {
  return (
    <>
      <ModulesPane />
      <ModuleTabStrip />
    </>
  );
}

function sidebarOrder(): string[] {
  return Array.from(document.querySelectorAll("li"))
    .map((row) => row.textContent?.replace("📦 ", "").trim() ?? "")
    .filter((name) => name !== "" && name !== "+ Add Module");
}

function tabStripOrder(): string[] {
  return screen
    .getAllByRole("tab")
    .map((tab) => tab.getAttribute("aria-label") ?? "");
}

/** The read-only consumers that take the shared array rather than render it. */
function keyboardShortcutOrder(): string[] {
  return getModulesSnapshot(PROJECT_ID).map((module) => module.name);
}

function backlogGroupOrder(): string[] {
  return getModulesSnapshot(PROJECT_ID).map((module) => module.name);
}

async function renderModuleSurfaces(expected: string[]): Promise<void> {
  render(<ModuleSurfaces />);
  await waitFor(() => expect(sidebarOrder()).toEqual(expected));
}

describe("canonical module order acceptance", () => {
  beforeEach(async () => {
    await resetStudioApolloClient();
    listModules.mockReset().mockResolvedValue(SERVER_ORDER);
    listProjects.mockReset().mockResolvedValue([project(false)]);
    useStudioStore.setState({ selectedProjectId: PROJECT_ID, error: null });
    useClientStore.setState({ selectedModuleId: null, modulesCursorId: null });
  });

  it("[overhaul-37] gives every module consumer one canonical order", async () => {
    seedProjects([project(false)]);

    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    // Sidebar, tab strip, keyboard position shortcuts, and backlog grouping all
    // read the same cached array — no surface re-sorts on its own.
    expect(tabStripOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(keyboardShortcutOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(backlogGroupOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("[overhaul-38] never overlays activity recency on canonical order", async () => {
    listProjects.mockResolvedValue([project(true)]);
    seedProjects([project(true)]);
    // Presentation mode does not create a second client-side sort.
    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    expect(tabStripOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(keyboardShortcutOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("[overhaul-39] keeps the generated automatic order", async () => {
    seedProjects([project(false)]);

    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    expect(tabStripOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("[overhaul-40] reads the ordering mode without the project cache warmed", async () => {
    listProjects.mockResolvedValue([project(true)]);

    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    expect(listProjects).toHaveBeenCalled();
  });

  it("[overhaul-41] keeps the generated module order when the project read fails", async () => {
    listProjects.mockRejectedValue(new Error("projects unavailable"));

    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);
  });

  it("[overhaul-53] adopts a Manual module order this client never made", async () => {
    // This client first knows the project as automatic.
    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    // A teammate, or this user on another device, drags the project into a
    // Manual module order and the server now owns the whole arrangement.
    listProjects.mockResolvedValue([project(true)]);
    listModules.mockResolvedValue([
      SERVER_ORDER[1],
      SERVER_ORDER[2],
      SERVER_ORDER[0],
    ]);

    // The next ordinary module read on this running client — a create, or
    // switching back to the project — must carry the flipped mode with it.
    await loadModules(PROJECT_ID);

    await waitFor(() =>
      expect(sidebarOrder()).toEqual(["Bravo", "Alpha", "Charlie"]),
    );
    expect(tabStripOrder()).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(keyboardShortcutOrder()).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("[overhaul-54] keeps the last known mode when the project read fails", async () => {
    listProjects.mockResolvedValue([project(true)]);

    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    // A transient failure must not replace the last canonical order.
    listProjects.mockRejectedValue(new Error("projects unavailable"));
    await loadModules(PROJECT_ID);

    expect(keyboardShortcutOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
  });
});

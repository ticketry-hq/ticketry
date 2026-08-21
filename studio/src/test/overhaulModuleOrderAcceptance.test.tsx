import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return {
    ...actual,
    listModulePresentations: vi.fn(),
    listModules: vi.fn(),
    listProjects: vi.fn(),
    updateModulePresentation: vi.fn(),
  };
});

import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import { ModulesPane } from "../app/shell/sidebar/modules/ModulesPane";
import {
  getModulesSnapshot,
  loadModules,
} from "../features/projects";
import { useStudioStore } from "../features/projects/store";
import { groupBacklog } from "../features/work-items";
import * as api from "../shared/api/client";
import { queryClient } from "../shared/query/queryClient";
import type { Module, Project } from "../shared/api/types";
import { useClientStore } from "../state/clientStore";

const listModules = api.listModules as ReturnType<typeof vi.fn>;
const listProjects = api.listProjects as ReturnType<typeof vi.fn>;
const listModulePresentations =
  api.listModulePresentations as ReturnType<typeof vi.fn>;

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

function project(_manualModuleOrder: boolean): Project {
  return {
    id: PROJECT_ID,
    name: "Project",
    slug: "PRJ",
    description: "",
  } as Project;
}

/**
 * Every Module surface at once. Rendering the sidebar and the Module tab strip
 * together is the point: they must never be able to disagree, because they read
 * the one cached Module collection rather than each sorting for themselves.
 */
function ModuleSurfaces() {
  return (
    <QueryClientProvider client={queryClient}>
      <ModulesPane />
      <ModuleTabStrip />
    </QueryClientProvider>
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
  return groupBacklog([], getModulesSnapshot(PROJECT_ID), [], null, {
    query: "",
  })
    .map((group) => group.epic?.name)
    .filter((name): name is string => name !== undefined);
}

async function renderModuleSurfaces(expected: string[]): Promise<void> {
  render(<ModuleSurfaces />);
  await waitFor(() => expect(sidebarOrder()).toEqual(expected));
}

describe("canonical module order acceptance", () => {
  beforeEach(() => {
    queryClient.clear();
    listModules.mockReset().mockResolvedValue(SERVER_ORDER);
    listProjects.mockReset().mockResolvedValue([project(false)]);
    listModulePresentations.mockReset().mockResolvedValue([]);
    useStudioStore.setState({ selectedProjectId: PROJECT_ID, error: null });
    useClientStore.setState({ selectedModuleId: null, modulesCursorId: null });
  });

  it("[overhaul-37] gives every module consumer one canonical order", async () => {
    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    // Sidebar, tab strip, keyboard position shortcuts, and backlog grouping all
    // read the same cached array — no surface re-sorts on its own.
    expect(tabStripOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(keyboardShortcutOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(backlogGroupOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("[overhaul-38] preserves the server order for a manual project", async () => {
    listProjects.mockResolvedValue([project(true)]);
    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    expect(tabStripOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(keyboardShortcutOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("[overhaul-39] uses the module collection as the complete ordering source", async () => {
    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    expect(tabStripOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(listModules).toHaveBeenCalledTimes(1);
  });

  it("[overhaul-40] loads module order without warming the project cache", async () => {
    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    expect(listProjects).not.toHaveBeenCalled();
  });

  it("[overhaul-41] does not depend on a readable project collection", async () => {
    listProjects.mockRejectedValue(new Error("projects unavailable"));

    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("[overhaul-53] adopts a server order this client never made", async () => {
    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    // A teammate, or this user on another device, drags the project into a
    // Manual module order and the server now owns the whole arrangement.
    listModules.mockResolvedValue([
      SERVER_ORDER[1],
      SERVER_ORDER[2],
      SERVER_ORDER[0],
    ]);

    // The next ordinary module read adopts the changed server order.
    await loadModules(PROJECT_ID);

    await waitFor(() =>
      expect(sidebarOrder()).toEqual(["Bravo", "Alpha", "Charlie"]),
    );
    expect(tabStripOrder()).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(keyboardShortcutOrder()).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("[overhaul-54] keeps module ordering independent of project-read failures", async () => {
    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    listProjects.mockRejectedValue(new Error("projects unavailable"));
    await loadModules(PROJECT_ID);

    expect(keyboardShortcutOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(listProjects).not.toHaveBeenCalled();
  });
});

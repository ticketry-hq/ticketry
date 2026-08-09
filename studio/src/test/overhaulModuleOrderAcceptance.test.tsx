import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return { ...actual, listModules: vi.fn(), listProjects: vi.fn() };
});

import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import { ModulesPane } from "../app/shell/sidebar/modules/ModulesPane";
import {
  getModulesSnapshot,
  registerModuleRecencyProvider,
  seedProjects,
} from "../features/projects";
import { useStudioStore } from "../features/projects/store";
import { groupBacklog } from "../features/work-items";
import * as api from "../shared/api/client";
import { queryClient } from "../shared/query/queryClient";
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
    registerModuleRecencyProvider(async () => ({}));
    useStudioStore.setState({ selectedProjectId: PROJECT_ID, error: null });
    useClientStore.setState({ selectedModuleId: null, modulesCursorId: null });
  });

  afterEach(() => {
    registerModuleRecencyProvider(async () => ({}));
  });

  it("[overhaul-37] gives every module consumer one canonical order", async () => {
    seedProjects([project(false)]);
    registerModuleRecencyProvider(async () => ({
      "module-a": "2026-08-09T12:00:00Z",
      "module-b": "2026-08-09T09:00:00Z",
    }));

    await renderModuleSurfaces(["Alpha", "Bravo", "Charlie"]);

    // Sidebar, tab strip, keyboard position shortcuts, and backlog grouping all
    // read the same cached array — no surface re-sorts on its own.
    expect(tabStripOrder()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(keyboardShortcutOrder()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(backlogGroupOrder()).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("[overhaul-38] applies activity recency only to automatic projects", async () => {
    seedProjects([project(true)]);
    registerModuleRecencyProvider(async () => ({
      "module-a": "2026-08-09T12:00:00Z",
      "module-b": "2026-08-09T09:00:00Z",
    }));

    // The same activity that reordered the automatic project above must leave a
    // manual project on the server's persisted rank order.
    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    expect(tabStripOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(keyboardShortcutOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("[overhaul-39] keeps the server fallback order when activity lookup fails", async () => {
    seedProjects([project(false)]);
    registerModuleRecencyProvider(async () => {
      throw new Error("activity unavailable");
    });

    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    expect(tabStripOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("[overhaul-40] reads the ordering mode without the project cache warmed", async () => {
    listProjects.mockResolvedValue([project(true)]);
    registerModuleRecencyProvider(async () => ({
      "module-a": "2026-08-09T12:00:00Z",
    }));

    await renderModuleSurfaces(["Charlie", "Bravo", "Alpha"]);

    expect(listProjects).toHaveBeenCalled();
  });

  it("[overhaul-41] treats an unreadable project as automatic", async () => {
    listProjects.mockRejectedValue(new Error("projects unavailable"));
    registerModuleRecencyProvider(async () => ({
      "module-a": "2026-08-09T12:00:00Z",
    }));

    await renderModuleSurfaces(["Alpha", "Charlie", "Bravo"]);
  });
});

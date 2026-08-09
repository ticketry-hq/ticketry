import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  createModule: vi.fn(),
  getTasks: vi.fn(),
  listIssueTypes: vi.fn(),
  listModules: vi.fn(),
  listProjects: vi.fn(),
  putProfile: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return { ...actual, ...api };
});

import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import { ModulesPane } from "../app/shell/sidebar/modules/ModulesPane";
import {
  getModulesSnapshot,
  getProjectsSnapshot,
  registerModuleRecencyProvider,
  seedProjects,
} from "../features/projects";
import { useStudioStore } from "../features/projects/store";
import {
  getConfigSnapshot,
  seedConfig,
} from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import type { Module, Project } from "../shared/api/types";
import { useClientStore } from "../state/clientStore";

const PROJECT_ID = "project-1";
const NEW_MODULE_ID = "module-new";

function module(id: string, name: string, sequence_id: number): Module {
  return {
    id,
    name,
    sequence_id,
    project_id: PROJECT_ID,
    key: id.toUpperCase(),
    is_archived: false,
    issue_type: "module",
  } as unknown as Module;
}

/** The two modules the project already had, in the server's answer order. */
const EXISTING = [module("module-b", "Bravo", 2), module("module-a", "Alpha", 1)];
const CREATED = module(NEW_MODULE_ID, "Newest", 3);

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
 * The Add Module modal mounted together with every Module surface it feeds.
 * Front placement is only real if the shared cached collection carries it, so
 * the sidebar and the Module tab strip are asserted from one render.
 */
function ModuleCreationSurfaces() {
  return (
    <QueryClientProvider client={queryClient}>
      <ModulesPane />
      <ModuleTabStrip />
      <ModalHost />
    </QueryClientProvider>
  );
}

function sidebarRows(): string[] {
  return Array.from(document.querySelectorAll("li")).map(
    (row) => row.textContent?.replace("📦 ", "").trim() ?? "",
  );
}

function sidebarOrder(): string[] {
  return sidebarRows().filter((name) => name !== "" && name !== "+ Add Module");
}

function tabStripOrder(): string[] {
  return screen
    .getAllByRole("tab")
    .map((tab) => tab.getAttribute("aria-label") ?? "");
}

/**
 * Create "Newest" through the ordinary Add Module flow. The server answers the
 * follow-up collection read with the module in front, which is exactly what a
 * project in either ordering mode returns after this create.
 */
async function createNewestModule(): Promise<void> {
  render(<ModuleCreationSurfaces />);
  await waitFor(() => expect(sidebarOrder()).toEqual(["Bravo", "Alpha"]));

  api.listModules.mockResolvedValue([CREATED, ...EXISTING]);
  fireEvent.change(await screen.findByPlaceholderText("Module name"), {
    target: { value: "Newest" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Module folder" }), {
    target: { value: "/repos/newest" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create module" }));

  await waitFor(() => expect(useModalStore.getState().modalStack).toEqual([]));
}

/** The creation behaviors front placement must not disturb. */
function expectCreationFlowIntact(): void {
  expect(api.createModule).toHaveBeenCalledOnce();
  expect(api.createModule).toHaveBeenCalledWith(
    PROJECT_ID,
    "Newest",
    "module-type",
  );
  // Selection and the module-folder link still follow the created module.
  expect(useClientStore.getState().selectedModuleId).toBe(NEW_MODULE_ID);
  expect(api.putProfile.mock.calls[0][1].module_links).toEqual([
    { module_id: NEW_MODULE_ID, path: "/repos/newest" },
  ]);
  // The sidebar's add control stays after its module rows.
  expect(sidebarRows().at(-1)).toBe("+ Add Module");
  expect(screen.getByRole("button", { name: "+ Add Module" })).toBeVisible();
}

/** Creation never changes the project's one-way ordering decision. */
function expectOrderingModeUnchanged(manual: boolean): void {
  expect(api.updateProject).not.toHaveBeenCalled();
  expect(
    getProjectsSnapshot().find((entry) => entry.id === PROJECT_ID)
      ?.manual_module_order,
  ).toBe(manual);
}

describe("module creation front-placement acceptance", () => {
  // The Module tab strip scrolls its selected tab into view, which jsdom does
  // not implement; selecting the created module is part of what these cases
  // exercise, so the no-op keeps that behavior observable.
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    queryClient.clear();
    api.createModule.mockReset().mockResolvedValue(CREATED);
    api.getTasks.mockReset().mockResolvedValue({
      rootIds: [],
      children: {},
      order: [],
      states: [],
      workItems: [],
    });
    api.listIssueTypes
      .mockReset()
      .mockResolvedValue([
        { id: "module-type", name: "Module", level: "module", sort_order: 0 },
      ]);
    api.listModules.mockReset().mockResolvedValue(EXISTING);
    api.updateProject.mockReset();
    api.putProfile
      .mockReset()
      .mockImplementation(async (_index: number, body: unknown) => ({
        recent_profile_index: 0,
        features: getConfigSnapshot().features,
        profiles: [body],
      }));
    registerModuleRecencyProvider(async () => ({}));
    seedConfig({
      profiles: [
        {
          name: "Local",
          workspace_slug: "meml",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [],
          recent_project_id: PROJECT_ID,
          recent_module_ids: {},
        },
      ],
      recentProfileIndex: 0,
    });
    useStudioStore.setState({ selectedProjectId: PROJECT_ID, error: null });
    useClientStore.setState({ selectedModuleId: null, modulesCursorId: null });
    useModalStore.setState({ modalStack: [{ type: "add-module" }] });
  });

  it("[overhaul-46] leads an automatic project's module surfaces with the module just created", async () => {
    api.listProjects.mockReset().mockResolvedValue([project(false)]);
    seedProjects([project(false)]);

    await createNewestModule();

    // The server's newest-created-first fallback is the front placement, and
    // every consumer of the one cached collection shows it. What activity
    // recency then does to an automatic project is the subject of the
    // canonical-order acceptance case, not this one.
    await waitFor(() =>
      expect(sidebarOrder()).toEqual(["Newest", "Bravo", "Alpha"]),
    );
    expect(tabStripOrder()).toEqual(["Newest", "Bravo", "Alpha"]);
    expect(getModulesSnapshot(PROJECT_ID).map((entry) => entry.name)).toEqual([
      "Newest",
      "Bravo",
      "Alpha",
    ]);
    expectOrderingModeUnchanged(false);
    expectCreationFlowIntact();
  });

  it("[overhaul-47] leads a manual project's module surfaces without leaving Manual module order", async () => {
    api.listProjects.mockReset().mockResolvedValue([project(true)]);
    seedProjects([project(true)]);
    // Activity that would pull an older module to the front of an automatic
    // project must not disturb the rank the create just allocated.
    registerModuleRecencyProvider(async () => ({
      "module-a": "2026-08-09T12:00:00Z",
    }));

    await createNewestModule();

    await waitFor(() =>
      expect(sidebarOrder()).toEqual(["Newest", "Bravo", "Alpha"]),
    );
    expect(tabStripOrder()).toEqual(["Newest", "Bravo", "Alpha"]);
    expect(getModulesSnapshot(PROJECT_ID).map((entry) => entry.name)).toEqual([
      "Newest",
      "Bravo",
      "Alpha",
    ]);
    expectOrderingModeUnchanged(true);
    expectCreationFlowIntact();
  });
});

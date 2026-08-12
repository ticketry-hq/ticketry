import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import { ModulesPane } from "../app/shell/sidebar/modules/ModulesPane";
import { useAgentStatusStore } from "../features/agents/status";
import {
  getModulesSnapshot,
  registerModuleRecencyProvider,
  resetAcceptedManualModuleOrder,
} from "../features/projects";
import { useStudioStore } from "../features/projects/store";
import { groupBacklog } from "../features/work-items";
import * as api from "../shared/api/client";
import { queryClient } from "../shared/query/queryClient";
import type { Module, Project, WorkItem } from "../shared/api/types";
import { useClientStore } from "../state/clientStore";

/**
 * Shared fixtures and surface readers for the module reorder acceptance
 * suites. Each suite still declares its own `vi.mock("../shared/api/client")`
 * so the mock factory hoists; these accessors read the mocked functions.
 */

export const listModules = api.listModules as ReturnType<typeof vi.fn>;
export const listProjects = api.listProjects as ReturnType<typeof vi.fn>;
export const reorderWorkItem = api.reorderWorkItem as ReturnType<typeof vi.fn>;

export const PROJECT_ID = "project-1";

export function modules(...ids: string[]): Module[] {
  return ids.map((id, index) => ({
    id,
    name: id.replace("module-", "").toUpperCase(),
    project_id: PROJECT_ID,
    key: id.toUpperCase(),
    sequence_id: ids.length - index,
    is_archived: false,
    issue_type: "module",
  })) as unknown as Module[];
}

export function project(manual_module_order: boolean): Project {
  return {
    id: PROJECT_ID,
    name: "Project",
    slug: "PRJ",
    description: "",
    manual_module_order,
  } as Project;
}

/** Both reorder-visible surfaces at once: they read one cached order. */
export function ModuleSurfaces() {
  return (
    <QueryClientProvider client={queryClient}>
      <ModulesPane />
      <ModuleTabStrip />
    </QueryClientProvider>
  );
}

export function rows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("li[data-module-id]"),
  );
}

export function sidebarOrder(): string[] {
  return rows().map((row) => row.dataset.moduleId ?? "");
}

export function rowFor(moduleId: string): HTMLElement {
  return rows().find((row) => row.dataset.moduleId === moduleId)!;
}

export function tabs(): HTMLElement[] {
  return screen.getAllByRole("tab");
}

export function tabFor(moduleId: string): HTMLElement {
  return tabs().find((tab) => tab.dataset.moduleId === moduleId)!;
}

export function tabStripOrder(): string[] {
  return tabs().map((tab) => tab.getAttribute("aria-label") ?? "");
}

/** The lifecycle chicklets a tab is carrying, by their accessible titles. */
export function tabBadges(moduleId: string): string[] {
  return Array.from(
    tabFor(moduleId).querySelectorAll<HTMLElement>("span[aria-label]"),
  ).map((badge) => badge.getAttribute("aria-label") ?? "");
}

/** A representative read-only consumer: it takes the shared array, never sorts. */
export function backlogGroupOrder(): string[] {
  return groupBacklog([], getModulesSnapshot(PROJECT_ID), [], null, { query: "" })
    .map((group) => group.epic?.name)
    .filter((name): name is string => name !== undefined);
}

export function moved(id: string): WorkItem {
  return { id, rank: "V" } as unknown as WorkItem;
}

export function deferred<T>() {
  let settle!: { resolve: (value: T) => void; reject: (error: Error) => void };
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject };
  });
  return { promise, ...settle };
}

export function resetModuleReorderHarness(): void {
  queryClient.clear();
  listModules.mockReset();
  listProjects.mockReset();
  reorderWorkItem.mockReset().mockResolvedValue(moved("module-c"));
  registerModuleRecencyProvider(async () => ({}));
  resetAcceptedManualModuleOrder();
  useStudioStore.setState({ selectedProjectId: PROJECT_ID, error: null });
  useAgentStatusStore.setState({ runs: {} });
  useClientStore.setState({
    selectedModuleId: null,
    modulesCursorId: null,
    toasts: [],
  });
}

/** The recency-sorted order an automatic project actually shows: a, b, c. */
export async function renderAutomaticProject(): Promise<void> {
  listModules.mockResolvedValue(modules("module-c", "module-b", "module-a"));
  listProjects.mockResolvedValue([project(false)]);
  registerModuleRecencyProvider(async () => ({
    "module-a": "2026-08-09T12:00:00Z",
    "module-b": "2026-08-09T09:00:00Z",
  }));

  render(<ModuleSurfaces />);
  await waitFor(() =>
    expect(sidebarOrder()).toEqual(["module-a", "module-b", "module-c"]),
  );
}

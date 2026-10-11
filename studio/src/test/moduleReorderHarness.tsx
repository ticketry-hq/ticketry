import { render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import { ModuleManager, openModuleManager } from "../features/module-manager";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import {
  getModulesSnapshot,
} from "../features/projects";
import { useStudioStore } from "../features/projects/store";
import { setStorySprintFilterIntent } from "../features/work-items";
import * as api from "./legacyApiFixture";
import { resetStudioApolloClient } from "../shared/apollo/client";
import type { Module, Project, WorkItem } from "../shared/api/types";
import { useClientStore } from "../state/clientStore";

/**
 * Shared fixtures and surface readers for the module reorder acceptance
 * suites. Each suite still declares its own `vi.mock("./legacyApiFixture")`
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
    <>
      <ModuleManager />
      <ModuleTabStrip />
    </>
  );
}

export function rows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("li[data-module-manager-row]"),
  );
}

export function managerOrder(): string[] {
  return rows().map((row) => row.dataset.moduleManagerRow ?? "");
}

export function rowFor(moduleId: string): HTMLElement {
  return rows().find((row) => row.dataset.moduleManagerRow === moduleId)!;
}

export function tabs(): HTMLElement[] {
  return screen.getAllByRole("tab").filter((tab) => tab.hasAttribute("data-module-id"));
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
  return getModulesSnapshot(PROJECT_ID).map((module) => module.name);
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

export async function resetModuleReorderHarness(): Promise<void> {
  await resetStudioApolloClient();
  listModules.mockReset();
  listProjects.mockReset();
  reorderWorkItem.mockReset().mockResolvedValue(moved("module-c"));
  useStudioStore.setState({ selectedProjectId: PROJECT_ID, error: null });
  setStorySprintFilterIntent(PROJECT_ID, { mode: "all" });
  useAgentStatusStore.setState({ runs: {} });
  useClientStore.setState({
    selectedModuleId: null,
    toasts: [],
  });
}

/** The server-owned creation order an automatic project shows: a, b, c. */
export async function renderAutomaticProject(): Promise<void> {
  listModules.mockResolvedValue(modules("module-a", "module-b", "module-c"));
  listProjects.mockResolvedValue([project(false)]);
  openModuleManager();
  render(<ModuleSurfaces />);
  await waitFor(() =>
    expect(managerOrder()).toEqual(["module-a", "module-b", "module-c"]),
  );
}

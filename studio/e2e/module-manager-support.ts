import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type APIRequestContext, type Page, type Route } from "@playwright/test";
import { ModuleManagerArchivedModulesDocument } from "../src/features/module-manager/generated/archivedModules.documents";
import { createModule, createWorkItem, getWorkspace, getWorkflowCatalog, selectModuleForProfile, graphql, getModules } from "./support";

export async function managerFixture(request: APIRequestContext, label: string) {
  const project = await getWorkspace(request);
  const catalog = await getWorkflowCatalog(request, project.id);
  const moduleType = catalog.issue_types.nodes.find((type) => type.level === "module")!;
  const storyType = catalog.issue_types.nodes.find((type) => type.name === "Story")!;
  const folder = await mkdtemp(join(tmpdir(), "ticketry-manager-"));
  const prefix = `Manager ${label} ${crypto.randomUUID().slice(0, 8)}`;
  const first = await createModule(request, project.id, { name: `${prefix} Alpha`, issue_type_id: moduleType.id });
  const second = await createModule(request, project.id, { name: `${prefix} Beta`, issue_type_id: moduleType.id });
  await selectModuleForProfile(request, project.id, first.id, folder);
  await selectModuleForProfile(request, project.id, second.id, folder);
  const story = await createWorkItem(request, project.id, {
    name: `${prefix} Story`, issue_type_id: storyType.id, parent_id: first.id,
  });
  return { project, first, second, story, folder, prefix, cleanup: () => rm(folder, { recursive: true, force: true }) };
}

export async function visitManager(page: Page, selectedName: string) {
  await page.goto("/");
  const tab = page.getByRole("tab", { name: selectedName, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
  const manager = page.getByRole("region", { name: "Module Manager", exact: true });
  await expect(manager.getByRole("searchbox", { name: "Search modules" })).toBeFocused();
  return manager;
}

/** Refuse one public network operation, then let every subsequent request reach the real adapter. */
export async function refuseNext(page: Page, operation: string, persistent = false) {
  let remaining = persistent ? Infinity : 1;
  const handler = async (route: Route) => {
    if (route.request().postDataJSON()?.operationName === operation && remaining > 0) {
      remaining--;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ errors: [{ message: `Injected ${operation} refusal` }] }) });
    } else await route.fallback();
  };
  await page.route("**/graphql", handler);
  return () => page.unroute("**/graphql", handler);
}

export async function readManagerModule(request: APIRequestContext, projectId: string, id: string) {
  const active = (await getModules(request, projectId)).find((row) => row.id === id);
  if (active) return active;
  const data = await graphql(request, ModuleManagerArchivedModulesDocument, { projectId, offset: 0, limit: 1000 });
  const archived = data.modules.nodes.find((row) => row.id === id);
  expect(archived).toBeTruthy();
  return archived!;
}

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type APIRequestContext, type Locator, type Page, type Route } from "@playwright/test";
import { ClearModuleLinkDocument } from "../src/features/module-links/generated/moduleLinks.documents";
import { ModuleShellSessionsDocument, UpdateTerminalSessionDocument } from "../src/features/agents/terminal/generated/terminalSessions.documents";
import { SCRATCH_RUN_TASK_ID } from "../src/features/agents/types";
import { createModule, getModules, getWorkflowCatalog, getWorkspace, graphql, selectModuleForProfile, type ModuleRow } from "./support";

/** One linked, disposable module per case so shell numbering never leaks between cases. */
export async function shellModule(request: APIRequestContext, label: string) {
  const projectId = (await getWorkspace(request)).id;
  const catalog = await getWorkflowCatalog(request, projectId);
  const moduleType = catalog.issue_types.nodes.find((row) => row.level === "module")!;
  const folder = await mkdtemp(join(tmpdir(), "ticketry-module-terminal-"));
  const module = await createModule(request, projectId, {
    name: `Shell ${label} ${crypto.randomUUID().slice(0, 8)}`, issue_type_id: moduleType.id,
  });
  await selectModuleForProfile(request, projectId, module.id, folder);
  return { projectId, folder, module };
}

export async function openShellModule(page: Page, name: string) {
  await page.goto("/");
  const tab = page.getByRole("tab", { name, exact: true }).last();
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
}

export async function liveShells(request: APIRequestContext, moduleId: string) {
  return (await graphql(request, ModuleShellSessionsDocument, { moduleId, scratchTaskId: SCRATCH_RUN_TASK_ID, limit: 100 }))
    .terminal_sessions.sessions.map((session) => session.agent_run_id);
}

/** Ends every surviving shell a case left so no private tmux session outlives it. */
export async function terminateShells(request: APIRequestContext, modules: ModuleRow[]) {
  for (const module of modules) {
    for (const agentRunId of await liveShells(request, module.id)) {
      try {
        await graphql(request, UpdateTerminalSessionDocument, { agentRunId, terminationRequestId: crypto.randomUUID() });
      } catch (error) {
        // The case's own Close may still be ending this shell under its own cause.
        if (!String(error).includes("terminal_cleanup_conflict")) throw error;
      }
    }
    await expect.poll(() => liveShells(request, module.id)).toEqual([]);
  }
}

/** Waits for a debounced per-module panel preference to reach storage before a reload. */
export async function expectSavedPanelPreference(page: Page, key: "studio.terminalPanelOpen:v1" | "studio.terminalPanelActiveShell:v1", moduleId: string, value: unknown) {
  await expect.poll(() => page.evaluate(({ key, moduleId }) => {
    try { return (JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>)[moduleId] ?? null; } catch { return null; }
  }, { key, moduleId })).toEqual(value);
}

export async function removeFolders(folders: string[]) {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
}

/** A direct fixture write can briefly race a releasing viewer lease. */
export async function clearModuleLinkEventually(request: APIRequestContext, moduleId: string) {
  await expect(async () => { await graphql(request, ClearModuleLinkDocument, { moduleId }); })
    .toPass({ timeout: 5_000, intervals: [100, 250, 500] });
}

/** Refuses one GraphQL operation at the network boundary; every other request passes. */
export function refuseOperation(operationName: string, message: string) {
  let refusals = 0;
  const handler = async (route: Route) => {
    if (route.request().postDataJSON()?.operationName !== operationName) return route.continue();
    refusals += 1;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message }] }) });
  };
  return { handler, refusals: () => refusals };
}

export function countRequests(page: Page, operationName: string) {
  let seen = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/graphql") && request.postDataJSON()?.operationName === operationName) seen += 1;
  });
  return () => seen;
}

export async function typeInShell(page: Page, terminal: Locator, command: string) {
  await terminal.click();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

export async function openFolderCommand(page: Page) {
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
  await page.getByRole("button", { name: "Open Settings" }).focus();
  await page.keyboard.press("f");
  const dialog = page.getByRole("dialog", { name: "Module Folder" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function hideEveryModuleTab(page: Page, request: APIRequestContext, projectId: string) {
  const hidden: string[] = [];
  for (const module of await getModules(request, projectId)) {
    const hide = page.getByRole("button", { name: `Hide ${module.name} tab`, exact: true });
    if (await hide.count()) {
      await hide.click();
      hidden.push(module.name);
    }
  }
  return hidden;
}

export async function restoreModuleTabs(page: Page, names: string[]) {
  await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
  const manager = page.getByRole("region", { name: "Module Manager", exact: true });
  for (const name of names) await manager.getByRole("button", { name: `Restore ${name}`, exact: true }).click();
  await manager.getByRole("button", { name: "Close Module Manager" }).click();
}

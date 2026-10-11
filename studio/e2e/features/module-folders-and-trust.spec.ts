import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ClearModuleLinkDocument, LoadModuleLinksDocument } from "../../src/features/module-links/generated/moduleLinks.documents";
import { createModule, getModules, getProjects, getWorkflowCatalog, graphql, selectModuleForProfile, type ModuleRow, type ProjectRow } from "../support";
import { featureSuite } from "./featureSuite";

const compact = (id: string) => id.replaceAll("-", "");
async function linkedPath(request: APIRequestContext, moduleId: string) {
  return (await graphql(request, LoadModuleLinksDocument, {})).moduleLinks.nodes
    .find((link) => compact(link.moduleId) === compact(moduleId))?.path;
}
async function openFolder(page: Page) {
  // Reload first renders a startup Settings button before module keyboard routing exists.
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Project module tabs" }).locator('[role="tab"][data-module-id][aria-selected="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Open Settings", exact: true }).focus();
  await page.keyboard.press("f");
  const dialog = page.getByRole("dialog", { name: "Module Folder", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

featureSuite("module-folders-and-trust", () => {
  let folder: string;
  let replacement: string;
  let project: ProjectRow;
  let module: ModuleRow;

  test.beforeEach(async ({ request, page }, testInfo) => {
    folder = await mkdtemp(join(tmpdir(), "ticketry-folder-feature-"));
    replacement = await mkdtemp(join(tmpdir(), "ticketry-folder-replacement-"));
    project = (await getProjects(request))[0]!;
    const catalog = await getWorkflowCatalog(request, project.id);
    const moduleType = catalog.issue_types.nodes.find((type) => type.level === "module")!;
    module = await createModule(request, project.id, {
      name: `Folder ${testInfo.testId}`, issue_type_id: moduleType.id,
    });
    await selectModuleForProfile(request, project.id, module.id, folder);
    await page.goto("/");
    const tab = page.getByRole("tab", { name: module.name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("module-workspace-region")).toBeVisible();
  });

  test.afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
    await rm(replacement, { recursive: true, force: true });
  });

  test("retries an invalid module folder without duplicating the persisted module", { tag: "@case-folder-creation-retry" }, async ({ page, request }) => {
    // CODING-2643 replaces the retired Modules pane/Add Module dialog.
    await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
    const manager = page.getByRole("region", { name: "Module Manager", exact: true });
    await manager.getByRole("button", { name: "New module", exact: true }).first().click();
    const form = page.getByRole("form", { name: "Create module", exact: true });
    const name = `Cancelled invalid module ${module.id}`;
    await form.getByPlaceholder("Module name").fill(name);
    await form.getByRole("textbox", { name: "Module folder", exact: true }).fill(join(folder, "folder-that-does-not-exist"));
    await form.getByRole("button", { name: "Create module", exact: true }).click();
    await expect(form.getByRole("alert")).toHaveText("Module created, but its folder could not be saved. Retry to save the folder.");
    await expect(form.getByPlaceholder("Module name")).toBeDisabled();
    const created = (await getModules(request, project.id)).filter((row) => row.name === name);
    expect(created).toHaveLength(1);
    await form.getByRole("textbox", { name: "Module folder", exact: true }).fill(folder);
    await form.getByRole("button", { name: "Save folder", exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name, exact: true })).toHaveCount(1);
    expect((await getModules(request, project.id)).filter((row) => row.name === name).map((row) => row.id)).toEqual([created[0]!.id]);
    expect(await linkedPath(request, created[0]!.id)).toBe(folder);
  });

  test("repairs a persisted module link after its folder disappears", { tag: "@case-folder-disappeared-repair" }, async ({ page, request }) => {
    await rm(folder, { recursive: true, force: true });
    await page.reload();
    await page.getByRole("button", { name: "Open terminal panel", exact: true }).click();
    const panel = page.getByTestId("terminal-panel");
    const recovery = panel.getByTestId("terminal-panel-folder-required");
    await expect(recovery).toHaveAttribute("data-refusal-reason", "module_folder_unusable");
    await expect(recovery).toContainText("This module has no usable folder.");
    await expect(panel.getByRole("tab", { name: "Shell 1", exact: true })).toHaveCount(0);
    await recovery.getByRole("textbox", { name: "Module folder for the terminal panel" }).fill(replacement);
    await recovery.getByRole("button", { name: "Use this folder", exact: true }).click();
    await expect(recovery).toHaveCount(0);
    await expect(panel.getByRole("tab", { name: "Shell 1", exact: true })).toBeVisible();
    expect(await linkedPath(request, module.id)).toBe(replacement);
    await panel.getByRole("button", { name: "Close shell 1", exact: true }).click();
    await expect(panel.getByTestId("terminal-panel-no-shells")).toBeVisible();
    await panel.getByRole("button", { name: "Minimize terminal panel", exact: true }).click();
    await page.reload();
    const dialog = await openFolder(page);
    await expect(dialog.getByPlaceholder("Local folder (optional)")).toHaveValue(replacement);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  });

  test("saves a trimmed typed folder and restores it after reload without native trust", { tag: "@case-folder-typed-persistence" }, async ({ page, request }) => {
    const dialog = await openFolder(page);
    await expect(dialog.getByRole("button", { name: "Pick Folder", exact: true })).toHaveCount(0);
    await dialog.getByPlaceholder("Local folder (optional)").fill(`  ${replacement}  `);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Trust module folder?", exact: true })).toHaveCount(0);
    expect(await linkedPath(request, module.id)).toBe(replacement);
    await page.reload();
    const restored = await openFolder(page);
    await expect(restored.getByPlaceholder("Local folder (optional)")).toHaveValue(replacement);
    await restored.getByRole("button", { name: "Cancel", exact: true }).click();
  });

  test("rejects empty and relative folder paths and preserves the link on button and keyboard cancel", { tag: "@case-folder-validation-cancel" }, async ({ page, request }) => {
    let dialog = await openFolder(page);
    const input = dialog.getByPlaceholder("Local folder (optional)");
    await input.fill("   ");
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await input.fill("relative/folder");
    await expect(dialog.getByRole("alert")).toHaveText("Enter the full folder path, starting from the filesystem root.");
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await input.fill(replacement);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await linkedPath(request, module.id)).toBe(folder);
    dialog = await openFolder(page);
    await dialog.getByPlaceholder("Local folder (optional)").fill(replacement);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.reload();
    dialog = await openFolder(page);
    await expect(dialog.getByPlaceholder("Local folder (optional)")).toHaveValue(folder);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  });

  test("rolls back a refused folder replacement and retries the real write", { tag: "@case-folder-network-retry" }, async ({ page, request }) => {
    const dialog = await openFolder(page);
    await dialog.getByPlaceholder("Local folder (optional)").fill(replacement);
    await page.route("**/graphql", async (route) => {
      if (route.request().postDataJSON()?.operationName !== "SetModuleLink") return route.continue();
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Folder link write refused for recovery test" }] }) });
    });
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    expect(await linkedPath(request, module.id)).toBe(folder);
    await page.unroute("**/graphql");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await linkedPath(request, module.id)).toBe(replacement);
    await page.reload();
    const restored = await openFolder(page);
    await expect(restored.getByPlaceholder("Local folder (optional)")).toHaveValue(replacement);
    await restored.getByRole("button", { name: "Cancel", exact: true }).click();
  });

  test("reuses recent folders by pointer and keyboard with a separate Enter to save", { tag: "@case-folder-recent-selection" }, async ({ page, request }) => {
    let dialog = await openFolder(page);
    await dialog.getByPlaceholder("Local folder (optional)").fill(replacement);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    dialog = await openFolder(page);
    const recents = dialog.getByRole("list", { name: "Recent folders", exact: true });
    await recents.getByRole("listitem").filter({ hasText: replacement }).click();
    await expect(dialog.getByPlaceholder("Local folder (optional)")).toHaveValue(replacement);
    await dialog.getByPlaceholder("Local folder (optional)").fill(folder);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
    await page.keyboard.press("ArrowUp");
    const lastRecent = await recents.getByRole("listitem").last().innerText();
    await page.keyboard.press("Enter");
    await expect(dialog.getByPlaceholder("Local folder (optional)")).toHaveValue(lastRecent);
    await expect(dialog).toBeVisible();
    expect(await linkedPath(request, module.id)).toBe(replacement);
    await page.keyboard.press("ArrowDown");
    const firstRecent = await recents.getByRole("listitem").first().innerText();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder("Local folder (optional)")).toHaveValue(firstRecent);
    expect(await linkedPath(request, module.id)).toBe(replacement);
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    expect(await linkedPath(request, module.id)).toBe(firstRecent);
  });

  test("recovers a missing folder link through the terminal panel and refuses invalid retries", { tag: "@case-folder-required-recovery" }, async ({ page, request }) => {
    await graphql(request, ClearModuleLinkDocument, { moduleId: module.id });
    await page.getByRole("button", { name: "Open terminal panel", exact: true }).click();
    const panel = page.getByTestId("terminal-panel");
    const recovery = panel.getByTestId("terminal-panel-folder-required");
    await expect(recovery).toBeVisible();
    await panel.getByRole("button", { name: "Minimize terminal panel", exact: true }).click();
    expect(await linkedPath(request, module.id)).toBeUndefined();
    await page.getByRole("button", { name: "Open terminal panel", exact: true }).click();
    await expect(recovery).toBeVisible();
    const input = recovery.getByRole("textbox", { name: "Module folder for the terminal panel" });
    await expect(input).toHaveValue("");
    await expect(recovery.getByRole("button", { name: "Use this folder", exact: true })).toBeDisabled();
    await input.fill("relative");
    await expect(recovery.getByRole("button", { name: "Use this folder", exact: true })).toBeDisabled();
    await input.fill(join(folder, "missing-module-folder"));
    await recovery.getByRole("button", { name: "Use this folder", exact: true }).click();
    await expect(recovery.getByRole("alert")).toContainText("Could not save the module folder. Retry to continue.");
    await expect(panel.getByRole("tab", { name: "Shell 1", exact: true })).toHaveCount(0);
    expect(await linkedPath(request, module.id)).toBeUndefined();
    await input.fill(replacement);
    await recovery.getByRole("button", { name: "Use this folder", exact: true }).click();
    await expect(recovery).toHaveCount(0);
    await expect(panel.getByRole("tab", { name: "Shell 1", exact: true })).toBeVisible();
    expect(await linkedPath(request, module.id)).toBe(replacement);
    await panel.getByRole("button", { name: "Close shell 1", exact: true }).click();
    await panel.getByRole("button", { name: "Minimize terminal panel", exact: true }).click();
  });
  test("requires a folder before switching modules and resumes only after saving", { tag: "@case-folder-guarded-selection" }, async ({ page, request }) => {
    const catalog = await getWorkflowCatalog(request, project.id);
    const target = await createModule(request, project.id, {
      name: `Unlinked ${module.id}`, issue_type_id: catalog.issue_types.nodes.find((type) => type.level === "module")!.id,
    });
    await page.reload();
    const targetTab = page.getByRole("tab", { name: target.name, exact: true });
    await targetTab.click();
    let dialog = page.getByRole("dialog", { name: "Module Folder", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder("Local folder (optional)")).toHaveValue("");
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await linkedPath(request, target.id)).toBeUndefined();
    await expect(page.getByRole("tab", { name: module.name, exact: true })).toHaveAttribute("aria-selected", "true");
    await targetTab.click();
    dialog = page.getByRole("dialog", { name: "Module Folder", exact: true });
    await dialog.getByPlaceholder("Local folder (optional)").fill(replacement);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(targetTab).toHaveAttribute("aria-selected", "true");
    expect(await linkedPath(request, target.id)).toBe(replacement);
    await page.reload();
    await expect(targetTab).toHaveAttribute("aria-selected", "true");
  });

  test("offers typed setup with no recent folders", { tag: "@case-folder-empty-recents" }, async ({ page, request }) => {
    const links = (await graphql(request, LoadModuleLinksDocument, {})).moduleLinks.nodes;
    for (const link of links) await graphql(request, ClearModuleLinkDocument, { moduleId: link.moduleId });
    await page.reload();
    await page.getByRole("tab", { name: module.name, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Module Folder", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("list", { name: "Recent folders", exact: true })).toHaveCount(0);
    await expect(dialog.getByPlaceholder("Local folder (optional)")).toHaveValue("");
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await dialog.getByPlaceholder("Local folder (optional)").fill(replacement);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await linkedPath(request, module.id)).toBe(replacement);
    await page.reload();
    const restored = await openFolder(page);
    await expect(restored.getByPlaceholder("Local folder (optional)")).toHaveValue(replacement);
    await restored.getByRole("button", { name: "Cancel", exact: true }).click();
  });
  test("links a typed folder through picker creation and preserves state on cancellation", { tag: "@case-folder-picker-creation" }, async ({ page, request }) => {
    const openCreation = async () => {
      await page.getByRole("button", { name: "Open module picker", exact: true }).click();
      await page.getByRole("dialog", { name: "Module picker", exact: true }).getByRole("option", { name: "Create new module", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Add Module", exact: true });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    const name = `Picker folder ${module.id}`;
    let dialog = await openCreation();
    await expect(dialog.getByRole("button", { name: "Create module", exact: true })).toBeDisabled();
    await dialog.getByPlaceholder("Module name").fill(name);
    await dialog.getByRole("textbox", { name: "Module folder", exact: true }).fill(replacement);
    await expect(dialog.getByRole("button", { name: "Pick Folder", exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await getModules(request, project.id)).filter((row) => row.name === name)).toHaveLength(0);
    await expect(page.getByRole("tab", { name: module.name, exact: true })).toHaveAttribute("aria-selected", "true");
    dialog = await openCreation();
    await dialog.getByPlaceholder("Module name").fill(name);
    await dialog.getByRole("textbox", { name: "Module folder", exact: true }).fill("relative/path");
    await expect(dialog.getByRole("button", { name: "Create module", exact: true })).toBeDisabled();
    await dialog.getByRole("textbox", { name: "Module folder", exact: true }).fill(`  ${replacement}  `);
    await dialog.getByRole("button", { name: "Create module", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const created = (await getModules(request, project.id)).filter((row) => row.name === name);
    expect(created).toHaveLength(1);
    expect(await linkedPath(request, created[0]!.id)).toBe(replacement);
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    const restored = await openFolder(page);
    await expect(restored.getByPlaceholder("Local folder (optional)")).toHaveValue(replacement);
    await restored.getByRole("button", { name: "Cancel", exact: true }).click();
  });

  test("does not reopen or select a hidden module after its cancelled folder save completes", { tag: "@case-folder-pending-cancel-safety" }, async ({ page, request }) => {
    let release!: () => void;
    let reached!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const intercepted = new Promise<void>((resolve) => { reached = resolve; });
    let pendingModuleId: string | undefined;
    const handler = async (route: import("@playwright/test").Route) => {
      const body = route.request().postDataJSON();
      if (body?.operationName !== "SetModuleLink") return route.continue();
      pendingModuleId = body.variables.moduleId;
      reached();
      await pending;
      await route.continue();
    };
    await page.route("**/graphql", handler);
    try {
      await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
      const manager = page.getByRole("region", { name: "Module Manager", exact: true });
      await manager.getByRole("button", { name: "New module", exact: true }).first().click();
      const form = manager.getByRole("form", { name: "Create module", exact: true });
      const name = `Pending folder ${module.id}`;
      await form.getByPlaceholder("Module name").fill(name);
      await form.getByRole("textbox", { name: "Module folder", exact: true }).fill(replacement);
      await form.getByRole("button", { name: "Create module", exact: true }).click();
      await intercepted;
      const created = (await getModules(request, project.id)).filter((row) => row.name === name);
      expect(created).toHaveLength(1);
      expect(compact(pendingModuleId!)).toBe(compact(created[0]!.id));
      expect(await linkedPath(request, created[0]!.id)).toBeUndefined();
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(form).toHaveCount(0);
      await manager.getByRole("button", { name: "Close Module Manager", exact: true }).click();
      const createdTab = page.getByRole("tab", { name, exact: true });
      await page.getByRole("button", { name: `Hide ${name} tab`, exact: true }).click();
      await expect(createdTab).toHaveCount(0);
      const saved = page.waitForResponse((response) => response.url().endsWith("/graphql") && response.request().postDataJSON()?.operationName === "SetModuleLink");
      release();
      const response = await saved;
      expect(response.ok()).toBe(true);
      await expect.poll(() => linkedPath(request, created[0]!.id)).toBe(replacement);
      await expect(createdTab).toHaveCount(0);
      await expect(page.getByRole("tab", { name: module.name, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(manager).toHaveCount(0);
      await page.reload();
      await expect(createdTab).toHaveCount(0);
      await expect(page.getByRole("tab", { name: module.name, exact: true })).toHaveAttribute("aria-selected", "true");
      expect((await getModules(request, project.id)).filter((row) => row.name === name).map((row) => row.id)).toEqual([created[0]!.id]);
    } finally {
      release();
      await page.unroute("**/graphql", handler);
    }
  });

});

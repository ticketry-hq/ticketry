import { expect, test, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { featureSuite } from "./featureSuite";
import { createModule, createWorkItem, getModules, getWorkspace, getWorkflowCatalog, graphql, refreshTaskDocuments, selectModuleForProfile } from "../support";
import { UpdateWorkTrackerModulePresentationDocument } from "../../src/features/projects/generated/projects.documents";

const tabs = (page: Page) => page.getByRole("tablist", { name: "Project module tabs" });
const tab = (page: Page, name: string) => tabs(page).getByRole("tab", { name, exact: true });
const picker = (page: Page) => page.getByRole("dialog", { name: "Module picker" });
let folder: string;
let names: { first: string; second: string; story: string };
let projectId: string;
async function select(page: Page, name: string) {
  await tab(page, name).click();
  await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
}
async function manager(page: Page) {
  await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
  const region = page.getByRole("region", { name: "Module Manager", exact: true });
  await expect(region).toBeVisible();
  return region;
}
async function hide(page: Page, name: string) {
  await tabs(page).getByRole("button", { name: `Hide ${name} tab`, exact: true }).click();
  await expect(tab(page, name)).toHaveCount(0);
}
async function restore(page: Page, name: string) {
  await page.getByRole("button", { name: "Open module picker" }).click();
  await picker(page).getByRole("option", { name: `Restore ${name} module tab`, exact: true }).click();
  await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
}
async function order(page: Page) {
  return (await tabs(page).locator('[role="tab"][data-module-id]').allTextContents()).filter(name => [names.first, names.second].includes(name));
}
async function drag(page: Page) {
  const box = await tab(page, names.first).boundingBox();
  expect(box).toBeTruthy();
  await tab(page, names.second).dragTo(tab(page, names.first), { targetPosition: { x: 2, y: box!.height / 2 } });
}
async function refuseOnce(page: Page, operation: string) {
  let failed = false;
  await page.route("**/graphql", async route => {
    if (!failed && route.request().postDataJSON()?.operationName === operation) {
      failed = true;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Module tabs fixture refusal" }] }) });
    } else await route.continue();
  });
  return () => failed;
}

featureSuite("module-tabs", { isolation: "case" }, () => {
  test.beforeEach(async ({ page, request }, info) => {
    const suffix = `${Date.now()}-${process.pid}-${info.testId.slice(-6)}`;
    names = { first: `Tabs first ${suffix}`, second: `Tabs second ${suffix}`, story: `Tabs Story ${suffix}` };
    const project = await getWorkspace(request);
    projectId = project.id;
    const types = (await getWorkflowCatalog(request, projectId)).issue_types.nodes;
    const moduleType = types.find(row => row.name === "Module")!;
    const first = await createModule(request, projectId, { name: names.first, issue_type_id: moduleType.id });
    const second = await createModule(request, projectId, { name: names.second, issue_type_id: moduleType.id });
    const story = await createWorkItem(request, projectId, { name: names.story, parent_id: first.id, issue_type_id: types.find(row => row.name === "Story")!.id });
    folder = await mkdtemp(join(tmpdir(), "ticketry-module-tabs-"));
    await selectModuleForProfile(request, projectId, first.id, folder);
    await selectModuleForProfile(request, projectId, second.id, folder);
    const documentFolder = join(folder, "spec", `tabs-first-${suffix}--${first.id.slice(0, 8)}`, `T${story.sequence_id}--tabs-story-${suffix}`);
    await mkdir(documentFolder, { recursive: true });
    await writeFile(join(documentFolder, "DESIGN.md"), "# Disposable module tab closure document\n");
    await writeFile(join(documentFolder, "NOTES.md"), "# Disposable capture-chord document\n");
    await expect.poll(async () => (await refreshTaskDocuments(request, story.id, projectId, first.id)).map(row => row.relPath)).toEqual(expect.arrayContaining(["DESIGN.md", "NOTES.md"]));
    await page.goto("/");
    await select(page, names.first);
  });
  test.afterEach(async () => { if (folder) await rm(folder, { recursive: true, force: true }); });

  test("reorders module tabs and restores the canonical order after reload", { tag: "@case-module-tabs-reorder-reload" }, async ({ page }) => {
    // CODING-2643: Module Manager replaces the removed Modules pane; keep both surface assertions.
    await expect.poll(() => order(page)).toEqual([names.first, names.second]);
    let region = await manager(page);
    const managerOrder = () => region.locator('[data-module-manager-row]').allTextContents().then(labels => labels.map(label => [names.first, names.second].find(name => label.includes(name))).filter(Boolean));
    await expect.poll(managerOrder).toEqual([names.first, names.second]);
    await region.getByRole("button", { name: "Close Module Manager" }).click();
    await drag(page);
    await expect.poll(() => order(page)).toEqual([names.second, names.first]);
    region = await manager(page);
    await expect.poll(managerOrder).toEqual([names.second, names.first]);
    await region.getByRole("button", { name: "Close Module Manager" }).click();
    await page.reload();
    await expect.poll(() => order(page)).toEqual([names.second, names.first]);
    region = await manager(page);
    await expect.poll(managerOrder).toEqual([names.second, names.first]);
  });

  test("hides a module tab and restores it through the module picker", { tag: "@case-module-tabs-hide-restore-reload" }, async ({ page }) => {
    await hide(page, names.second);
    // CODING-2643: the module record remains in Module Manager after hiding its presentation.
    const region = await manager(page);
    await expect(region.getByRole("button", { name: `Restore ${names.second}`, exact: true })).toBeVisible();
    await region.getByRole("button", { name: "Close Module Manager" }).click();
    await page.reload();
    await expect(tab(page, names.second)).toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: names.story })).toBeVisible();
    const trigger = page.getByRole("button", { name: "Open module picker" });
    await trigger.click();
    const search = picker(page).getByRole("combobox", { name: "Search modules" });
    await expect(search).toBeFocused();
    await search.press("Escape");
    await expect(picker(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await search.fill(names.second.toUpperCase());
    await search.press("ArrowDown");
    await expect(picker(page).getByRole("option", { name: `Restore ${names.second} module tab` })).toHaveAttribute("aria-selected", "true");
    await search.press("Enter");
    await expect(picker(page)).toHaveCount(0);
    await expect(tab(page, names.second)).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(tab(page, names.second)).toBeVisible();
  });

  test("recovers through the Modules pane after every module tab is hidden", { tag: "@case-module-tabs-all-hidden-recovery" }, async ({ page, request }) => {
    const visible = await tabs(page).locator('[role="tab"][data-module-id]').evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")!));
    expect(visible.length).toBeGreaterThan(1);
    for (const name of visible) await hide(page, name);
    // CODING-2643: the empty workspace now directs explicit recovery through Module Manager.
    await expect(page.getByTestId("empty-module-workspace")).toContainText("All module tabs are hidden. Restore a tab in the Module Manager.");
    await page.getByRole("button", { name: "Manage modules", exact: true }).click();
    const region = page.getByRole("region", { name: "Module Manager", exact: true });
    await region.getByRole("button", { name: `Restore ${names.first}`, exact: true }).click();
    await region.getByRole("button", { name: `Open ${names.first}`, exact: true }).click();
    await expect(tab(page, names.first)).toHaveAttribute("aria-selected", "true");
    for (const module of (await getModules(request, projectId)).filter(row => visible.includes(row.name))) {
      await graphql(request, UpdateWorkTrackerModulePresentationDocument, { moduleId: module.id, tabHidden: false });
    }
    await page.reload();
    for (const name of visible) await expect(tab(page, name)).toBeVisible();
    await expect(tab(page, names.first)).toHaveAttribute("aria-selected", "true");
  });

  test("navigates the strip with arrows and preserves module selection on reload", { tag: "@case-module-tabs-strip-navigation" }, async ({ page }) => {
    await tab(page, names.first).focus();
    await tab(page, names.first).press("ArrowRight");
    await expect(tab(page, names.second)).toHaveAttribute("aria-selected", "true");
    await tab(page, names.second).press("ArrowLeft");
    await expect(tab(page, names.first)).toHaveAttribute("aria-selected", "true");
    await tab(page, names.first).press("End");
    await expect(tab(page, names.second)).toHaveAttribute("aria-selected", "true");
    await tab(page, names.second).press("Home");
    await expect(page.getByTestId("workspace-tab-plan")).toHaveAttribute("aria-selected", "true");
    await select(page, names.second);
    await page.reload();
    await expect(tab(page, names.second)).toHaveAttribute("aria-selected", "true");
  });

  test("dismisses the picker and keeps creation reachable for an empty search", { tag: "@case-module-tabs-picker-cancel-empty" }, async ({ page }) => {
    const trigger = page.getByRole("button", { name: "Open module picker" });
    await trigger.click();
    await picker(page).getByRole("combobox", { name: "Search modules" }).fill("no-hidden-module-matches-this");
    await expect(picker(page).getByRole("option")).toHaveCount(1);
    await expect(picker(page).getByRole("option", { name: "Create new module" })).toBeVisible();
    await trigger.click();
    await expect(picker(page)).toHaveCount(0);
    await trigger.click();
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await expect(picker(page)).toHaveCount(0);
    await trigger.click();
    await tab(page, names.first).click();
    await expect(picker(page)).toHaveCount(0);
    await trigger.click();
    await picker(page).getByRole("option", { name: "Create new module" }).click();
    const dialog = page.getByRole("dialog", { name: "Add Module", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(tab(page, names.first)).toHaveAttribute("aria-selected", "true");
  });

  test("rolls back a failed Hide and retries a failed Restore without archiving", { tag: "@case-module-tabs-visibility-errors" }, async ({ page, request }) => {
    const failedHide = await refuseOnce(page, "UpdateWorkTrackerModulePresentation");
    await tabs(page).getByRole("button", { name: `Hide ${names.first} tab` }).click();
    await expect(page.getByText("Module tab could not be hidden: Module tabs fixture refusal", { exact: true })).toBeVisible();
    expect(failedHide()).toBeTruthy();
    await expect(tab(page, names.first)).toHaveAttribute("aria-selected", "true");
    await hide(page, names.first);
    await expect(tab(page, names.second)).toHaveAttribute("aria-selected", "true");
    const failedRestore = await refuseOnce(page, "UpdateWorkTrackerModulePresentation");
    await page.getByRole("button", { name: "Open module picker" }).click();
    await picker(page).getByRole("option", { name: `Restore ${names.first} module tab` }).click();
    await expect(page.getByText("Module tab could not be restored: Module tabs fixture refusal", { exact: true })).toBeVisible();
    expect(failedRestore()).toBeTruthy();
    await expect(tab(page, names.first)).toHaveCount(0);
    await restore(page, names.first);
    const modules = await getModules(request, projectId);
    expect(modules.find(row => row.name === names.first)?.is_archived).toBe(false);
    await page.reload();
    await expect(tab(page, names.first)).toBeVisible();
  });

  test("cancels a drag and recovers a refused tab reorder", { tag: "@case-module-tabs-reorder-errors" }, async ({ page }) => {
    const before = await order(page);
    const source = await tab(page, names.second).boundingBox();
    const target = await tab(page, names.first).boundingBox();
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();
    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
    await page.mouse.down();
    await page.mouse.move(source!.x + source!.width / 2 - 12, source!.y + source!.height / 2, { steps: 3 });
    await page.mouse.move(target!.x + 2, target!.y + target!.height / 2, { steps: 5 });
    await page.mouse.move(target!.x + 3, target!.y + target!.height / 2);
    const seam = tab(page, names.first).getByTestId("module-tab-drop-seam");
    await expect(seam).toHaveAttribute("data-drop-intent", "near");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(seam).toHaveCount(0);
    await expect.poll(() => order(page)).toEqual(before);
    await page.reload();
    await expect.poll(() => order(page)).toEqual(before);
    const failed = await refuseOnce(page, "ReorderWorkTrackerModulePresentation");
    await drag(page);
    await expect(page.getByText("Module tabs fixture refusal", { exact: false })).toBeVisible();
    expect(failed()).toBeTruthy();
    await expect.poll(() => order(page)).toEqual(before);
    await drag(page);
    await expect.poll(() => order(page)).toEqual([names.second, names.first]);
    await page.reload();
    await expect.poll(() => order(page)).toEqual([names.second, names.first]);
  });

  test("closes a disposable document and preserves the module and Details", { tag: "@case-module-tabs-close-chord" }, async ({ page }) => {
    await page.getByRole("treeitem", { name: names.story }).click();
    const details = page.getByRole("tablist", { name: "Workspace tabs" }).getByRole("tab", { name: "Details", exact: true });
    const design = page.getByRole("tablist", { name: "Workspace tabs" }).getByRole("tab", { name: "DESIGN", exact: true });
    await design.click();
    await page.keyboard.press("q");
    await expect(design).toHaveCount(0);
    const notes = page.getByRole("tablist", { name: "Workspace tabs" }).getByRole("tab", { name: "NOTES", exact: true });
    await notes.click();
    await page.keyboard.press("Meta+w");
    await expect(notes).toHaveCount(0);
    await details.click();
    await page.keyboard.press("q");
    await expect(details).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, names.first)).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(tab(page, names.first)).toBeVisible();
  });

  test("filters sprint membership and explicitly recovers hidden matching tabs", { tag: "@case-module-tabs-sprint-recovery" }, async ({ page }) => {
    const trigger = page.getByRole("button", { name: /^Sprint: / });
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole("dialog", { name: "Choose sprint" }).getByRole("option", { name: /^No sprint/ }).click();
    await expect(tab(page, names.first)).toBeVisible();
    await expect(tab(page, names.second)).toHaveCount(0);
    await expect(tab(page, names.first)).not.toHaveAttribute("draggable", "true");
    await page.reload();
    // Sprint choice is deliberately session-only; persisted root membership still projects identically.
    await trigger.click();
    await page.getByRole("dialog", { name: "Choose sprint" }).getByRole("option", { name: /^No sprint/ }).click();
    await expect(tab(page, names.first)).toBeVisible();
    await expect(tab(page, names.second)).toHaveCount(0);
    const matching = await tabs(page).locator('[role="tab"][data-module-id]').evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")!));
    for (const name of matching) await hide(page, name);
    await expect(page.getByRole("status").filter({ hasText: "All matching module tabs are hidden." })).toBeVisible();
    await page.getByRole("button", { name: "Open module picker" }).click();
    await picker(page).getByRole("option", { name: "Show all sprints", exact: true }).click();
    await expect(tab(page, names.second)).toBeVisible();
    await expect(tab(page, names.first)).toHaveCount(0);
    await restore(page, names.first);
    await expect(trigger).toHaveAccessibleName("Sprint: All sprints");
    await page.reload();
    await expect(tab(page, names.first)).toBeVisible();
    await expect(tab(page, names.second)).toBeVisible();
  });
  test("recovers failed sprint membership reads and an empty sprint projection", { tag: "@case-module-tabs-sprint-read-empty" }, async ({ page }) => {
    const failed = await refuseOnce(page, "ProjectStorySprintIndex");
    await page.reload();
    await expect(page.getByText("Sprint filter unavailable.", { exact: false })).toBeVisible();
    expect(failed()).toBeTruthy();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByText("Sprint filter unavailable.", { exact: false })).toHaveCount(0);
    await tab(page, names.first).focus();
    await tab(page, names.first).press("Home");
    await page.getByTestId("workspace-tab-plan").press("Enter");
    const back = page.getByRole("button", { name: "Back to sprints" });
    if (await back.count()) await back.click();
    await page.getByRole("button", { name: "New sprint", exact: true }).click();
    const sprintName = `Empty sprint ${names.first}`;
    await page.getByRole("textbox", { name: "Sprint name" }).fill(sprintName);
    await page.getByRole("textbox", { name: "Sprint name" }).press("Enter");
    await expect(page.getByTestId("plan-sprint").getByRole("heading", { name: sprintName, exact: true, level: 1 })).toBeVisible();
    await select(page, names.first);
    await page.getByRole("button", { name: /^Sprint: / }).click();
    const choices = page.getByRole("dialog", { name: "Choose sprint" });
    const planned = choices.getByRole("button", { name: /Planned/ });
    if (await planned.getAttribute("aria-expanded") === "false") await planned.click();
    await choices.getByRole("option", { name: new RegExp(`^${sprintName}`) }).click();
    await expect(page.getByRole("status").filter({ hasText: "No modules have stories in this sprint." })).toBeVisible();
    await expect(tabs(page).locator('[role="tab"][data-module-id]')).toHaveCount(0);
    await page.getByRole("button", { name: "Show all sprints", exact: true }).click();
    await expect(tab(page, names.first)).toBeVisible();
    await expect(tab(page, names.second)).toBeVisible();
  });
});

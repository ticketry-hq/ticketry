import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createModule, createWorkItem, getModules, getWorkItems, getWorkflowCatalog, getWorkspace, selectModuleForProfile } from "../support";
import { featureSuite } from "./featureSuite";

const moduleName = "Shell chrome coverage module";
const storyName = "Shell chrome confirmation story";
let projectId: string;
let moduleId: string;
let storyTypeId: string;
let moduleFolder: string;

// CODING-2643 replaced the Modules pane. Keep the migrated behavior and titles,
// but drive the current Module Manager instead of removed sidebar selectors.
async function workspace(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: moduleName, exact: true }).last().click();
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
}
const footer = (page: Page) => page.locator("[data-studio-status-bar]");

featureSuite("shell-layout-and-footer", () => {
  test.beforeAll(async ({ request }) => {
    projectId = (await getWorkspace(request)).id;
    const catalog = await getWorkflowCatalog(request, projectId);
    const moduleType = catalog.issue_types.nodes.find((row) => row.level === "module")!;
    storyTypeId = catalog.issue_types.nodes.find((row) => row.name === "Story")!.id;
    moduleFolder = await mkdtemp(join(tmpdir(), "ticketry-shell-e2e-"));
    moduleId = ((await getModules(request, projectId)).find((row) => row.name === moduleName)
      ?? await createModule(request, projectId, { name: moduleName, issue_type_id: moduleType.id })).id;
    await selectModuleForProfile(request, projectId, moduleId, moduleFolder);
  });

  test.afterAll(async () => { if (moduleFolder) await rm(moduleFolder, { recursive: true, force: true }); });

  test("resizes adjacent panes and persists the split", { tag: "@case-shell-split-persistence" }, async ({ page }) => {
    await workspace(page);
    const handle = page.getByTestId("module-workspace-region").getByTestId("pane-resize-handle");
    await expect(handle).toBeVisible();
    await expect(handle).toHaveAttribute("role", "separator");
    await expect(handle).toHaveAttribute("aria-label", "Resize adjacent panes");
    const before = Number(await handle.getAttribute("aria-valuenow"));
    const minimum = Number(await handle.getAttribute("aria-valuemin"));
    const maximum = Number(await handle.getAttribute("aria-valuemax"));
    const box = await handle.boundingBox();
    expect(box).toBeTruthy();
    const delta = before + 5 < maximum ? 90 : before - 5 > minimum ? -90 : 0;
    expect(delta).not.toBe(0);
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + delta, box!.y + box!.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => Number(await handle.getAttribute("aria-valuenow"))).not.toBe(before);
    const resized = Number(await handle.getAttribute("aria-valuenow"));
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("studio.panelLayout:v1") ?? "[]")[0])).toBeCloseTo(resized, 0);
    await page.reload();
    await expect(handle).toBeVisible();
    expect(Math.abs(Number(await handle.getAttribute("aria-valuenow")) - resized)).toBeLessThanOrEqual(1);
    // The separator also owns its accessible keyboard resize entry point.
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => Number(await handle.getAttribute("aria-valuenow"))).not.toBe(resized);
  });

  test("persists and restores Modules pane visibility", { tag: "@case-shell-manager-visibility" }, async ({ page }) => {
    await workspace(page);
    const toggle = footer(page).locator("[data-module-manager-toggle]");
    const manager = page.getByRole("region", { name: "Module Manager", exact: true });
    await toggle.click();
    await expect(manager).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("tree")).toHaveCount(0);
    await toggle.click();
    await expect(manager).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    await expect(manager).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(manager).toBeVisible();
    await manager.getByRole("button", { name: "Close Module Manager" }).click();
    await expect(page.getByRole("tree")).toBeVisible();
    await toggle.focus();
    await page.keyboard.press("Meta+Shift+m");
    await expect(manager).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(manager).toHaveCount(0);
    await page.keyboard.press("\\");
    await expect(manager).toBeVisible();
    await page.keyboard.press("\\");
    // Search typing owns backslash; Escape is the manager's cancel path.
    await page.keyboard.press("Escape");
    await expect(manager).toHaveCount(0);
  });

  test("keeps footer controls reachable and updates navigation hints", { tag: "@case-shell-footer-hints" }, async ({ page, request }) => {
    await workspace(page);
    await expect(footer(page).getByLabel(`${(await getModules(request, projectId)).length} active modules`)).toBeVisible();
    await expect(footer(page).getByText("— Next Zone", { exact: true })).toBeVisible();
    await expect(footer(page).getByText("— Story", { exact: true })).toBeVisible();
    await footer(page).getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(footer(page).getByText("— Tab", { exact: true })).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await expect(footer(page).getByText("— Engage", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 700, height: 650 });
    await expect(footer(page).getByRole("button", { name: "Open Settings" })).toBeVisible();
    await expect(footer(page).getByTestId("footer-terminal-toggle")).toBeVisible();
  });

  test("toggles the module terminal panel from pointer and chord and restores it after reload", { tag: "@case-shell-terminal-toggle" }, async ({ page }) => {
    await workspace(page);
    const toggle = footer(page).getByTestId("footer-terminal-toggle");
    const panel = page.getByTestId("terminal-panel");
    await expect(toggle).toHaveAccessibleName("Open terminal panel");
    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAccessibleName("Minimize terminal panel");
    await expect.poll(() => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("studio.terminalPanelOpen:v1") ?? "{}")).some(Boolean))).toBe(true);
    await page.reload();
    await expect(panel).toBeVisible();
    await toggle.click();
    await expect(panel).toHaveCount(0);
    await toggle.focus();
    await page.keyboard.press("Control+`");
    await expect(panel).toBeVisible();
    await page.keyboard.press("Control+`");
    await expect(panel).toHaveCount(0);
  });

  test("opens one settings modal from footer and chord and closes through both controls", { tag: "@case-shell-modal-entry" }, async ({ page }) => {
    await workspace(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await footer(page).getByRole("button", { name: "Open Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Studio settings" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await footer(page).getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("e");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("contains a failed modal chunk and supports loading retry and close", { tag: "@case-shell-modal-recovery" }, async ({ page }) => {
    await workspace(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/src/features/studio/modals/SettingsModal.tsx*", async (route) => { await held; await route.abort(); });
    await footer(page).getByRole("button", { name: "Open Settings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Loading Settings" })).toBeVisible();
    release();
    const alert = page.getByRole("alert").filter({ hasText: "Settings could not be loaded" });
    await expect(alert).toBeVisible();
    await expect(footer(page)).toBeVisible();
    await alert.getByRole("button", { name: "Close", exact: true }).click();
    await expect(alert).toHaveCount(0);
    await footer(page).getByRole("button", { name: "Open Settings" }).click();
    await expect(alert).toBeVisible();
    await page.unroute("**/src/features/studio/modals/SettingsModal.tsx*");
    await alert.getByRole("button", { name: "Retry" }).click();
    const dialog = page.getByRole("dialog", { name: "Studio settings" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await footer(page).getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("e");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("resolves confirmation cancel close and confirm without losing the shell", { tag: "@case-shell-confirmation" }, async ({ page, request }) => {
    await createWorkItem(request, projectId, { name: storyName, issue_type_id: storyTypeId, parent_id: moduleId });
    await workspace(page);
    await page.getByRole("treeitem", { name: storyName }).click();
    const open = async () => {
      await page.getByRole("button", { name: "Issue actions" }).click();
      await page.getByRole("menuitem", { name: "Delete issue…" }).click();
      return page.getByRole("dialog", { name: "Delete issue", exact: true });
    };
    let dialog = await open();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await getWorkItems(request, projectId)).some((item) => item.name === storyName)).toBe(true);
    dialog = await open();
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    expect((await getWorkItems(request, projectId)).some((item) => item.name === storyName)).toBe(true);
    dialog = await open();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    dialog = await open();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: storyName })).toHaveCount(0);
    await page.reload();
    expect((await getWorkItems(request, projectId)).some((item) => item.name === storyName)).toBe(false);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
  test("announces and dismisses a refused module action then recovers", { tag: "@case-shell-toast-error" }, async ({ page }) => {
    await workspace(page);
    await expect(page.getByTestId("toast-host")).toHaveCount(0);
    await page.route("**/graphql", async (route) => {
      const body = route.request().postDataJSON();
      if (body.operationName === "UpdateWorkTrackerModulePresentation") await route.abort();
      else await route.continue();
    });
    const hide = page.getByRole("button", { name: `Hide ${moduleName} tab`, exact: true });
    await hide.click();
    const error = page.getByTestId("toast-error");
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute("role", "alert");
    await expect(error).toHaveAttribute("aria-live", "assertive");
    await error.getByRole("button", { name: "Dismiss" }).click();
    await expect(error).toHaveCount(0);
    await hide.click();
    await expect(error).toBeVisible();
    await expect(error).toHaveCount(0, { timeout: 10000 });
    await page.unroute("**/graphql");
    await expect(page.getByRole("tab", { name: moduleName, exact: true }).last()).toBeVisible();
    await hide.click();
    await expect(page.getByRole("tab", { name: moduleName, exact: true })).toHaveCount(0);
    await footer(page).getByRole("button", { name: "Open Module Manager" }).click();
    await page.getByRole("region", { name: "Module Manager", exact: true }).getByRole("button", { name: `Restore ${moduleName}`, exact: true }).click();
    await expect(page.getByRole("tab", { name: moduleName, exact: true }).last()).toBeVisible();
  });

  test("explains the empty workspace and disabled terminal and restores a module", { tag: "@case-shell-empty-workspace" }, async ({ page, request }) => {
    await workspace(page);
    const modules = await getModules(request, projectId);
    for (const module of modules) {
      const hide = page.getByRole("button", { name: `Hide ${module.name} tab`, exact: true });
      if (await hide.count()) await hide.click();
    }
    await expect(page.getByTestId("empty-module-workspace")).toBeVisible();
    await expect(footer(page).getByTestId("footer-terminal-toggle")).toBeDisabled();
    await expect(footer(page).getByTestId("footer-terminal-toggle")).toHaveAccessibleName("Select a module to open a terminal panel");
    await expect(page.getByTestId("pane-resize-handle")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("empty-module-workspace")).toBeVisible();
    await page.getByRole("button", { name: "Manage modules", exact: true }).click();
    const manager = page.getByRole("region", { name: "Module Manager", exact: true });
    await manager.getByRole("button", { name: `Restore ${moduleName}`, exact: true }).click();
    await manager.getByRole("button", { name: "Close Module Manager" }).click();
    await page.getByRole("tab", { name: moduleName, exact: true }).last().click();
    await expect(page.getByRole("tree")).toBeVisible();
    await expect(footer(page).getByTestId("footer-terminal-toggle")).toBeEnabled();
  });

});

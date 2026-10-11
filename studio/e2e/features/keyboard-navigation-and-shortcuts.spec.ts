import { expect, test, type Page, type Locator } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { featureSuite } from "./featureSuite";
import { createModule, createWorkItem, getWorkspace, getWorkflowCatalog, openWorkItem, selectModuleForProfile, refreshTaskDocuments } from "../support";

let folder: string;
const suffix = `${Date.now()}-${process.pid}`;
const names = { module: `Keyboard navigation fixture ${suffix}`, parent: `Keyboard navigation Story ${suffix}` };
async function openModule(page: Page, name: string) {
  await page.goto("/");
  const tab = page.getByRole("tab", { name, exact: true }).last();
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
}
async function openSettings(page: Page): Promise<Locator> {
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
  await page.getByRole("button", { name: "Open Settings" }).click();
  return page.getByRole("dialog", { name: "Studio settings" });
}
async function searchBinding(page: Page) {
  const dialog = await openSettings(page);
  await dialog.getByRole("tab", { name: "Keyboard shortcuts" }).click();
  await dialog.getByRole("searchbox", { name: "Search bindings" }).fill("Search");
  return { dialog, binding: dialog.locator('button[aria-label^="Search,"]') };
}
featureSuite("keyboard-navigation-and-shortcuts", () => {
  test.beforeAll(async ({ request }) => {
    const project = await getWorkspace(request);
    const types = (await getWorkflowCatalog(request, project.id)).issue_types.nodes;
    const module = await createModule(request, project.id, { name: names.module, issue_type_id: types.find(row => row.name === "Module")!.id });
    const story = await createWorkItem(request, project.id, { name: names.parent, parent_id: module.id, issue_type_id: types.find(row => row.name === "Story")!.id });
    folder = await mkdtemp(join(tmpdir(), "ticketry-keyboard-"));
    await selectModuleForProfile(request, project.id, module.id, folder);
    const directory = join(folder, "spec", `keyboard-navigation-fixture-${suffix}--${module.id.slice(0, 8)}`, `T${story.sequence_id}--keyboard-navigation-story-${suffix}`);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "DESIGN.md"), "# Keyboard design fixture\n");
    await writeFile(join(directory, "NOTES.md"), "# Keyboard notes fixture\n");
    await expect.poll(async () => (await refreshTaskDocuments(request, story.id, project.id, module.id)).map(row => row.relPath)).toEqual(expect.arrayContaining(["DESIGN.md", "NOTES.md"]));
  });
  test.afterAll(async () => { if (folder) await rm(folder, { recursive: true, force: true }); });
  test("focuses story search with a shortcut and returns to the tree", { tag: "@case-keyboard-search-return" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("/");
    const search = page.getByRole("textbox", { name: "Search stories" });
    await expect(search).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tree")).toBeFocused();
  });

  test("opens keyboard shortcut help directly with question mark", { tag: "@case-keyboard-help-chord" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    const trigger = page.getByRole("button", { name: "Open Settings" });
    await trigger.focus();
    await page.keyboard.press("?");

    const dialog = page.getByRole("dialog", { name: "Studio settings" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Keyboard shortcuts" })).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("heading", { name: "Keyboard shortcuts" }))
      .toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("supports three-zone edit-view keyboard navigation", { tag: "@case-keyboard-three-zones" }, async ({ page }) => {
    await openModule(page, names.module);
    // CODING-2643 replaces pane visibility with a takeover that restores its invoker.
    const storiesZone = page.locator('[data-navigation-zone="stories"]');
    await storiesZone.focus();
    await page.keyboard.press("Backslash");
    await expect(page.getByRole("region", { name: "Module Manager", exact: true })).toBeVisible();
    await page.keyboard.press("Meta+Shift+m");
    await expect(page.getByRole("region", { name: "Module Manager", exact: true })).not.toBeVisible();
    await expect(storiesZone).toBeFocused();

    await page.getByRole("treeitem", {
      name: new RegExp(`${names.parent}(?: renamed)?`),
    }).click();
    await expect(page.getByTestId("issue-name")).toContainText(names.parent);

    await page.keyboard.press("Shift+Tab");
    const workspaceTabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await expect(workspaceTabs).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator('[data-navigation-zone="active-tab-body"]'))
      .toBeFocused();

    await page.keyboard.press("Backslash");
    await expect(page.getByRole("region", { name: "Module Manager", exact: true })).toBeVisible();
  });

  test("supports shortcut discovery, filtering, focus, and responsive dialogs", { tag: "@case-keyboard-binding-discovery" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    await page.setViewportSize({ width: 900, height: 650 });
    const trigger = page.getByRole("button", { name: "Open Settings" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Studio settings" });
    await dialog.getByRole("tab", { name: "Keyboard shortcuts" }).click();
    const filter = dialog.getByRole("searchbox", {
      name: "Search bindings",
    });
    await filter.click();
    await expect(filter).toBeFocused();
    await filter.fill("Search");
    await expect(dialog.getByRole("button", {
      name: "Search, current shortcut Slash, change binding",
    })).toHaveText("/");
    await filter.fill("definitely-no-such-shortcut");
    await expect(dialog.getByText("No bindings match", { exact: false }))
      .toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("persists, executes, and resets a custom Search shortcut", { tag: "@case-keyboard-search-persistence" }, async ({
    page,
  }) => {
    await openModule(page, names.module);

    const openSearchBinding = async (): Promise<{
      binding: Locator;
      dialog: Locator;
    }> => {
      const dialog = await openSettings(page);
      await dialog.getByRole("tab", { name: "Keyboard shortcuts" }).click();
      await dialog.getByRole("searchbox", { name: "Search bindings" })
        .fill("Search");
      const binding = dialog.locator('button[aria-label^="Search,"]');
      await expect(binding).toBeVisible();
      return { binding, dialog };
    };

    let { binding, dialog } = await openSearchBinding();
    await expect(binding).toHaveText("/");
    await expect(binding).toHaveAccessibleName(
      "Search, current shortcut Slash, change binding",
    );
    await binding.click();
    await expect(binding).toHaveText("Press a chord…");
    await expect(binding).toHaveAccessibleName(
      "Search, current shortcut Slash, recording, press a new shortcut",
    );
    await page.keyboard.press("Alt+k");
    await expect(binding).toHaveText("Alt+K");
    await expect(binding).toHaveAccessibleName(
      "Search, current shortcut Alt+K, change binding",
    );
    await expect(dialog.getByRole("button", { name: "Reset Search binding" }))
      .toBeVisible();
    await dialog.getByRole("button", { name: "Close dialog" }).click();

    await page.reload();
    ({ binding, dialog } = await openSearchBinding());
    await expect(binding).toHaveText("Alt+K");
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await page.keyboard.press("Alt+k");
    await expect(page.getByRole("textbox", { name: "Search stories" }))
      .toBeFocused();

    ({ binding, dialog } = await openSearchBinding());
    await dialog.getByRole("button", { name: "Reset Search binding" }).click();
    await expect(binding).toHaveText("/");
    await expect(binding).toHaveAccessibleName(
      "Search, current shortcut Slash, change binding",
    );
    await expect(dialog.getByRole("button", { name: "Reset Search binding" }))
      .toHaveCount(0);
    await dialog.getByRole("button", { name: "Close dialog" }).click();

    await page.reload();
    await expect(page.getByTestId("module-workspace-region")).toBeVisible();
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("/");
    await expect(page.getByRole("textbox", { name: "Search stories" }))
      .toBeFocused();
  });


  test("filters shortcut help and clears an empty result", { tag: "@case-keyboard-help-filter" }, async ({ page }) => {
    await openModule(page, names.module);
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("?");
    const dialog = page.getByRole("dialog", { name: "Studio settings" });
    const filter = dialog.getByRole("searchbox", { name: "Search bindings" });
    await filter.fill("Search");
    await expect(dialog.getByRole("button", { name: "Search, current shortcut Slash, change binding" })).toBeVisible();
    await filter.fill("no-keyboard-action-exists");
    await expect(dialog.getByText("No bindings match", { exact: false })).toBeVisible();
    await filter.clear();
    await expect(dialog.getByRole("button", { name: "Search, current shortcut Slash, change binding" })).toBeVisible();
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog).toHaveCount(0);
  });
  test("cancels recording, refuses conflicts, and recovers a failed binding save", { tag: "@case-keyboard-binding-errors" }, async ({ page }) => {
    await openModule(page, names.module);
    let { binding, dialog } = await searchBinding(page);
    await binding.click();
    await page.keyboard.press("Shift");
    await expect(binding).toHaveText("Press a chord…");
    await page.keyboard.press("Escape");
    await expect(binding).toHaveText("/");
    await expect(dialog).toBeVisible();
    await binding.click();
    await page.keyboard.press("e");
    await expect(dialog.getByText("That chord is already assigned to Settings.")).toBeVisible();
    await expect(binding).toHaveText("/");
    let failed = false;
    await page.route("**/graphql", async route => {
      if (!failed && route.request().postDataJSON()?.operationName === "UpdateKeybindingSetting") {
        failed = true;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Keyboard save unavailable" }] }) });
      } else await route.continue();
    });
    await binding.click();
    await page.keyboard.press("Alt+k");
    await expect(dialog.getByText("Keyboard save unavailable", { exact: false })).toBeVisible();
    await expect(binding).toHaveText("/");
    await binding.click();
    await page.keyboard.press("Alt+k");
    await expect(binding).toHaveText("Alt+K");
    await dialog.getByRole("button", { name: "Restore defaults" }).click();
    await expect(binding).toHaveText("/");
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await page.reload();
    ({ binding, dialog } = await searchBinding(page));
    await expect(binding).toHaveText("/");
  });
  test("falls back to defaults after a settings load error and recovers persisted shortcuts", { tag: "@case-keyboard-load-recovery" }, async ({ page }) => {
    await openModule(page, names.module);
    let { binding, dialog } = await searchBinding(page);
    await binding.click();
    await page.keyboard.press("Alt+k");
    await expect(binding).toHaveText("Alt+K");
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    let failed = false;
    await page.route("**/graphql", async route => {
      if (!failed && route.request().postDataJSON()?.operationName === "LoadKeybindingSetting") {
        failed = true;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Keyboard load unavailable" }] }) });
      } else await route.continue();
    });
    await page.reload();
    ({ binding, dialog } = await searchBinding(page));
    expect(failed).toBeTruthy();
    await expect(binding).toHaveText("/");
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await page.reload();
    ({ binding, dialog } = await searchBinding(page));
    await expect(binding).toHaveText("Alt+K");
    await dialog.getByRole("button", { name: "Restore defaults" }).click();
    await expect(binding).toHaveText("/");
  });
  test("cycles document tabs, clamps boundaries, and closes documents while retaining Details", { tag: "@case-keyboard-tab-boundaries" }, async ({ page }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    const tabs = page.getByRole("tablist", { name: "Workspace tabs" });
    const details = tabs.getByRole("tab", { name: "Details", exact: true });
    await details.click();
    await page.keyboard.press("Meta+ArrowLeft");
    await expect(details).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Meta+ArrowRight");
    await expect(tabs.getByRole("tab", { name: "DESIGN", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Meta+ArrowRight");
    await expect(tabs.getByRole("tab", { name: "NOTES", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Meta+ArrowRight");
    await expect(tabs.getByRole("tab", { name: "NOTES", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Meta+w");
    await expect(tabs.getByRole("tab", { name: "NOTES", exact: true })).toHaveCount(0);
    await tabs.getByRole("tab", { name: "DESIGN", exact: true }).click();
    await page.keyboard.press("q");
    await expect(tabs.getByRole("tab", { name: "DESIGN", exact: true })).toHaveCount(0);
    await details.click();
    await page.keyboard.press("q");
    await page.keyboard.press("Meta+w");
    await expect(details).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(details).toHaveAttribute("aria-selected", "true");
  });

  test("keeps text input and modals isolated and navigates the visible terminal zone", { tag: "@case-keyboard-context-terminal-zone" }, async ({ page }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    const search = page.getByRole("textbox", { name: "Search stories" });
    await search.fill("Keyboard");
    await search.press("?");
    await expect(search).toHaveValue("Keyboard?");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await search.clear();
    const { dialog } = await searchBinding(page);
    const filter = dialog.getByRole("searchbox", { name: "Search bindings" });
    await filter.fill("?");
    await expect(page.getByRole("textbox", { name: "Search stories" })).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("Control+Backquote");
    const panel = page.getByTestId("terminal-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("terminal-host")).toContainText(folder.split("/").at(-1)!);
    const stories = page.locator('[data-navigation-zone="stories"]');
    await stories.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("tablist", { name: "Workspace tabs" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator('[data-navigation-zone="active-tab-body"]')).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Meta+Escape");
    await expect(page.locator('[data-navigation-zone="terminal-panel"]')).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.locator('[data-navigation-zone="active-tab-body"]')).toBeFocused();
    await panel.getByRole("button", { name: "Close shell 1" }).click();
    await expect(panel.getByTestId("terminal-panel-no-shells")).toBeVisible();
    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
    await stories.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(stories).toBeFocused();
  });
});

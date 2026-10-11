import { expect, test } from "@playwright/test";
import { getModules, getWorkItem } from "../support";
import { featureSuite } from "./featureSuite";
import { managerFixture, refuseNext, visitManager, readManagerModule } from "../module-manager-support";

featureSuite("module-manager", { isolation: "case" }, () => {
  test("creates, switches, and searches the visible module workspace", { tag: "@case-manager-workspace" }, async ({ page, request }) => {
    const fixture = await managerFixture(request, "workspace");
    try {
      await visitManager(page, fixture.first.name);
      await page.getByRole("region", { name: "Module Manager", exact: true }).getByRole("button", { name: `Open ${fixture.second.name}`, exact: true }).click();
      await expect(page.getByRole("tab", { name: fixture.second.name, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("textbox", { name: "Search stories" })).toBeVisible();
      await page.getByRole("tab", { name: fixture.first.name, exact: true }).click();
      await expect(page.getByRole("treeitem", { name: new RegExp(fixture.story.name) })).toBeVisible();
      const ideaName = `${fixture.prefix} Created through the idea field`;
      const idea = page.getByRole("textbox", { name: "Capture an idea" });
      await idea.fill(ideaName);
      await idea.press("Enter");
      await expect(page.getByRole("treeitem", { name: new RegExp(ideaName) })).toBeVisible();
      await page.getByRole("textbox", { name: "Search stories" }).fill(ideaName);
      await expect(page.getByRole("treeitem", { name: new RegExp(ideaName) })).toBeVisible();
      await expect(page.getByRole("treeitem", { name: new RegExp(fixture.story.name) })).toHaveCount(0);
      await page.getByRole("button", { name: "Clear search", exact: true }).click();
      await expect(page.getByRole("treeitem", { name: new RegExp(fixture.story.name) })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("treeitem", { name: new RegExp(ideaName) })).toBeVisible();
    } finally { await fixture.cleanup(); }
  });

  test("opens from footer and both keyboard entries, restores focus, and respects editor Escape", { tag: "@case-manager-entry-keyboard" }, async ({ page, request }) => {
    const fixture = await managerFixture(request, "keyboard");
    try {
      const manager = await visitManager(page, fixture.first.name);
      await manager.getByRole("button", { name: "Close Module Manager", exact: true }).click();
      const footer = page.getByRole("button", { name: "Open Module Manager", exact: true });
      await expect(footer).toBeFocused();
      await page.keyboard.press("Meta+Shift+m");
      await expect(manager).toBeVisible();
      await manager.getByRole("button", { name: `Rename ${fixture.first.name}`, exact: true }).click();
      await manager.getByRole("textbox", { name: "Module name", exact: true }).fill("abandoned draft");
      await page.keyboard.press("Escape");
      await expect(manager.getByRole("textbox", { name: "Module name", exact: true })).toHaveCount(0);
      await expect(manager.getByRole("button", { name: `Rename ${fixture.first.name}`, exact: true })).toBeFocused();
      expect((await readManagerModule(request, fixture.project.id, fixture.first.id)).name).toBe(fixture.first.name);
      await page.keyboard.press("Escape");
      await expect(manager).toHaveCount(0);
      await page.keyboard.press("\\");
      await expect(manager).toBeVisible();
      const group = manager.locator('[data-module-manager-group="open"]');
      await group.focus();
      await page.keyboard.press("ArrowLeft");
      await expect(group).toHaveAttribute("aria-expanded", "false");
      await page.keyboard.press("ArrowRight");
      await expect(group).toHaveAttribute("aria-expanded", "true");
      await manager.getByRole("button", { name: `Inspect ${fixture.first.name}`, exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(manager).toHaveCount(0);
      await expect(page.getByRole("tab", { name: fixture.first.name, exact: true })).toHaveAttribute("aria-selected", "true");
    } finally { await fixture.cleanup(); }
  });

  test("searches names, keys and folders and inspects Stories without changing tabs", { tag: "@case-manager-search-inspect" }, async ({ page, request }) => {
    const fixture = await managerFixture(request, "search");
    try {
      const manager = await visitManager(page, fixture.first.name);
      const writes: string[] = [];
      page.on("request", (request) => { const op = request.postDataJSON()?.operationName; if ((op?.startsWith("Update") || op?.startsWith("Reorder"))) writes.push(op); });
      const search = manager.getByRole("searchbox", { name: "Search modules" });
      await search.fill(`  ${fixture.second.name.toUpperCase()}  `);
      await expect(manager.getByRole("button", { name: `Inspect ${fixture.second.name}`, exact: true })).toBeVisible();
      await expect(manager.getByRole("button", { name: `Inspect ${fixture.first.name}`, exact: true })).toHaveCount(0);
      await manager.getByRole("button", { name: "Clear module search" }).click();
      const key = `${fixture.project.slug}-${fixture.first.sequence_id}`;
      await search.fill(key);
      await expect(manager.getByRole("button", { name: `Inspect ${fixture.first.name}`, exact: true })).toBeVisible();
      await search.fill(fixture.folder);
      await expect(manager.getByRole("button", { name: `Inspect ${fixture.second.name}`, exact: true })).toBeVisible();
      await search.fill("no-such-module-unique");
      await expect(manager.getByText("No matching modules").first()).toBeVisible();
      await manager.getByRole("button", { name: "Clear module search" }).click();
      await manager.getByRole("button", { name: `Inspect ${fixture.first.name}`, exact: true }).click();
      const details = manager.getByRole("region", { name: `Module details: ${fixture.first.name}`, exact: true });
      await expect(details).toContainText(fixture.folder);
      await expect(details).toContainText("No active agents");
      await manager.getByRole("button", { name: `Expand ${fixture.first.name} stories`, exact: true }).click();
      await expect(manager.getByRole("tree", { name: `Stories in ${fixture.first.name}` })).toContainText(fixture.story.name);
      await manager.getByRole("button", { name: `Collapse ${fixture.first.name} stories`, exact: true }).click();
      await expect(manager.getByRole("tree", { name: `Stories in ${fixture.first.name}` })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: fixture.first.name, exact: true })).toHaveAttribute("aria-selected", "true");
      expect(writes).toEqual([]);
    } finally { await fixture.cleanup(); }
  });

  test("closes and restores presentation with refusal recovery and reload persistence", { tag: "@case-manager-presentation" }, async ({ page, request }) => {
    const fixture = await managerFixture(request, "presentation");
    try {
      const manager = await visitManager(page, fixture.first.name);
      const hidden = manager.getByRole("region", { name: "Hidden", exact: true });
      const removeRefusal = await refuseNext(page, "UpdateWorkTrackerModulePresentation");
      await manager.getByRole("button", { name: `Close ${fixture.second.name} tab`, exact: true }).click();
      await expect(manager.getByRole("alert").first()).toBeVisible();
      await expect(page.getByRole("tab", { name: fixture.second.name, exact: true })).toBeVisible();
      await removeRefusal();
      await manager.getByRole("button", { name: `Close ${fixture.second.name} tab`, exact: true }).click();
      await expect(hidden.getByRole("button", { name: `Restore ${fixture.second.name}`, exact: true })).toBeVisible();
      await expect(page.getByRole("tab", { name: fixture.second.name, exact: true })).toHaveCount(0);
      await expect(hidden.getByRole("button", { name: `Open ${fixture.second.name}`, exact: true })).toHaveCount(0);
      expect((await getModules(request, fixture.project.id)).some((row) => row.id === fixture.second.id)).toBe(true);
      await page.reload();
      await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
      await expect(hidden.getByRole("button", { name: `Restore ${fixture.second.name}`, exact: true })).toBeVisible();
      const restoreRefusal = await refuseNext(page, "UpdateWorkTrackerModulePresentation");
      await hidden.getByRole("button", { name: `Restore ${fixture.second.name}`, exact: true }).click();
      await expect(manager.getByRole("alert").first()).toBeVisible();
      await restoreRefusal();
      await hidden.getByRole("button", { name: `Restore ${fixture.second.name}`, exact: true }).click();
      await expect(page.getByRole("tab", { name: fixture.second.name, exact: true })).toBeVisible();
      await expect(manager).toBeVisible();
      await expect(page.getByRole("tab", { name: fixture.first.name, exact: true })).toHaveAttribute("aria-selected", "true");
      await manager.getByRole("button", { name: `Open ${fixture.second.name}`, exact: true }).click();
      await expect(manager).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("tab", { name: fixture.second.name, exact: true })).toHaveAttribute("aria-selected", "true");
    } finally { await fixture.cleanup(); }
  });

  test("cancels, validates, retries and persists row and detail renames", { tag: "@case-manager-rename" }, async ({ page, request }) => {
    const fixture = await managerFixture(request, "rename");
    try {
      const manager = await visitManager(page, fixture.first.name);
      await manager.getByRole("button", { name: `Rename ${fixture.first.name}`, exact: true }).click();
      await manager.getByRole("textbox", { name: "Module name", exact: true }).fill("cancelled");
      await manager.getByRole("button", { name: "Cancel module rename" }).click();
      expect((await readManagerModule(request, fixture.project.id, fixture.first.id)).name).toBe(fixture.first.name);
      await manager.getByRole("button", { name: `Rename ${fixture.first.name}`, exact: true }).click();
      await manager.getByRole("textbox", { name: "Module name", exact: true }).fill("   ");
      await manager.getByRole("button", { name: "Save module name" }).click();
      await expect(manager.getByText("Enter a module name.")).toBeVisible();
      const renamed = `${fixture.prefix} Renamed`;
      await manager.getByRole("textbox", { name: "Module name", exact: true }).fill(renamed);
      const removeRefusal = await refuseNext(page, "UpdateWorkTrackerWorkItemDetails");
      await manager.getByRole("button", { name: "Save module name" }).click();
      await expect(manager.getByRole("alert").first()).toBeVisible();
      await expect(manager.getByRole("textbox", { name: "Module name", exact: true })).toHaveValue(renamed);
      await removeRefusal();
      await manager.getByRole("button", { name: "Save module name" }).click();
      await expect(page.getByRole("tab", { name: renamed, exact: true })).toBeVisible();
      expect((await readManagerModule(request, fixture.project.id, fixture.first.id)).name).toBe(renamed);
      await manager.getByRole("button", { name: `Inspect ${renamed}`, exact: true }).click();
      const details = manager.getByRole("region", { name: `Module details: ${renamed}`, exact: true });
      await details.getByRole("button", { name: `Rename ${renamed}`, exact: true }).click();
      await details.getByRole("textbox", { name: "Module name", exact: true }).fill(fixture.first.name);
      await details.getByRole("button", { name: "Save module name" }).click();
      await expect(page.getByRole("tab", { name: fixture.first.name, exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("tab", { name: fixture.first.name, exact: true })).toBeVisible();
    } finally { await fixture.cleanup(); }
  });

  test("cancels and retries named archive, cascades descendants and retains inspection", { tag: "@case-manager-archive" }, async ({ page, request }) => {
    const fixture = await managerFixture(request, "archive");
    try {
      const manager = await visitManager(page, fixture.first.name);
      await manager.getByRole("button", { name: `Archive ${fixture.first.name}`, exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText(`Archive ${fixture.first.name}?`);
      await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
      expect((await readManagerModule(request, fixture.project.id, fixture.first.id)).is_archived).toBe(false);
      const removeRefusal = await refuseNext(page, "ArchiveWorkTrackerWorkItem");
      await manager.getByRole("button", { name: `Archive ${fixture.first.name}`, exact: true }).click();
      await page.getByRole("button", { name: "Archive module", exact: true }).click();
      await expect(manager.getByRole("alert").first()).toBeVisible();
      await removeRefusal();
      await manager.getByRole("button", { name: `Archive ${fixture.first.name}`, exact: true }).click();
      await page.getByRole("button", { name: "Archive module", exact: true }).click();
      await expect(page.getByRole("tab", { name: fixture.first.name, exact: true })).toHaveCount(0);
      expect((await readManagerModule(request, fixture.project.id, fixture.first.id)).is_archived).toBe(true);
      expect((await getWorkItem(request, fixture.story.id)).is_archived).toBe(true);
      const archive = manager.getByRole("region", { name: "Archived", exact: true });
      await archive.locator('[data-module-manager-group="archived"]').click();
      await archive.getByRole("button", { name: `Inspect ${fixture.first.name}`, exact: true }).click();
      await expect(manager.getByRole("region", { name: `Module details: ${fixture.first.name}`, exact: true })).toContainText("Archived · inspection only");
      await expect(archive.getByRole("button", { name: `Restore ${fixture.first.name}`, exact: true })).toHaveCount(0);
      await page.reload();
      await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
      await manager.getByRole("searchbox", { name: "Search modules" }).fill(fixture.first.name);
      await expect(archive.getByRole("button", { name: `Inspect ${fixture.first.name}`, exact: true })).toBeVisible();
    } finally { await fixture.cleanup(); }
  });

  // CODING-2643 replaces the stale Modules pane; retain the legacy title and behavioral assertions.
  test("reorders modules by dragging inside the Modules pane", { tag: "@case-manager-reorder" }, async ({ page, request }) => {
    const fixture = await managerFixture(request, "reorder");
    try {
      const manager = await visitManager(page, fixture.first.name);
      const seeded = [fixture.first.name, fixture.second.name];
      const order = () => manager.getByRole("region", { name: "Open", exact: true }).locator("[data-module-manager-inspect]").allTextContents().then((labels) => labels.map((text) => seeded.find((name) => text.includes(name))).filter(Boolean));
      const tabs = () => page.getByRole("tablist", { name: "Project module tabs" }).getByRole("tab").allTextContents().then((labels) => labels.filter((label) => seeded.includes(label)));
      await expect.poll(order).toEqual(seeded);
      await expect.poll(tabs).toEqual(seeded);
      const first = manager.locator(`[data-module-manager-row="${fixture.first.id}"]`);
      const second = manager.locator(`[data-module-manager-row="${fixture.second.id}"]`);
      await expect(first).toHaveAttribute("draggable", "true");
      const sourceBox = await second.boundingBox();
      await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y - 15, { steps: 5 });
      await page.mouse.move(20, 20, { steps: 5 });
      await page.mouse.up();
      await expect.poll(order).toEqual(seeded);
      await expect.poll(tabs).toEqual(seeded);
      const box = await first.boundingBox();
      await second.dragTo(first, { targetPosition: { x: box!.width / 2, y: 2 } });
      await expect.poll(order).toEqual([fixture.second.name, fixture.first.name]);
      await expect.poll(tabs).toEqual([fixture.second.name, fixture.first.name]);
      await expect(page.getByRole("tab", { name: fixture.first.name, exact: true })).toHaveAttribute("aria-selected", "true");
      await page.reload();
      await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
      await expect.poll(order).toEqual([fixture.second.name, fixture.first.name]);
      await expect.poll(tabs).toEqual([fixture.second.name, fixture.first.name]);
      const rollback = await refuseNext(page, "ReorderWorkTrackerModulePresentation");
      const restoreBox = await second.boundingBox();
      await first.dragTo(second, { targetPosition: { x: restoreBox!.width / 2, y: 2 } });
      await expect(page.getByRole("alert").first()).toBeVisible();
      await expect.poll(order).toEqual([fixture.second.name, fixture.first.name]);
      await rollback();
      await first.dragTo(second, { targetPosition: { x: restoreBox!.width / 2, y: 2 } });
      await expect.poll(order).toEqual(seeded);
      await expect.poll(tabs).toEqual(seeded);
    } finally { await fixture.cleanup(); }
  });

  test("creates through both inline entries with cancel and invalid-folder recovery", { tag: "@case-manager-creation" }, async ({ page, request }) => {
    const fixture = await managerFixture(request, "creation");
    try {
      const manager = await visitManager(page, fixture.first.name);
      await manager.getByRole("searchbox", { name: "Search modules" }).fill("no-match");
      await manager.locator("[data-module-manager-new]").click();
      const form = manager.getByRole("form", { name: "Create module", exact: true });
      await expect(manager.getByRole("searchbox", { name: "Search modules" })).toHaveValue("");
      await expect(form.getByRole("button", { name: "Create module", exact: true })).toBeDisabled();
      const cancelledName = `${fixture.prefix} Cancelled`;
      await form.getByRole("textbox", { name: "Module name", exact: true }).fill(cancelledName);
      await form.getByRole("textbox", { name: "Module folder", exact: true }).fill(fixture.folder);
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      expect((await getModules(request, fixture.project.id)).some((row) => row.name === cancelledName)).toBe(false);
      await manager.getByRole("region", { name: "Open", exact: true }).getByRole("button", { name: "New module", exact: true }).click();
      const name = `${fixture.prefix} Created`;
      await form.getByRole("textbox", { name: "Module name", exact: true }).fill(name);
      await form.getByRole("textbox", { name: "Module folder", exact: true }).fill("relative/path");
      await expect(form.getByRole("button", { name: "Create module", exact: true })).toBeDisabled();
      await expect(form.getByRole("alert")).toBeVisible();
      expect((await getModules(request, fixture.project.id)).filter((row) => row.name === name)).toHaveLength(0);
      await form.getByRole("textbox", { name: "Module folder", exact: true }).fill(fixture.folder);
      await form.getByRole("button", { name: "Create module", exact: true }).click();
      await expect(manager).toHaveCount(0);
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
      expect((await getModules(request, fixture.project.id)).filter((row) => row.name === name)).toHaveLength(1);
      await page.reload();
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    } finally { await fixture.cleanup(); }
  });

  test("retries unavailable archived and inspection reads without inventing empty state", { tag: "@case-manager-read-recovery" }, async ({ page, request }) => {
    const fixture = await managerFixture(request, "reads");
    try {
      const archiveRefusal = await refuseNext(page, "ModuleManagerArchivedModules", true);
      const metadataRefusal = await refuseNext(page, "ModuleManagerInspectionStories", true);
      const manager = await visitManager(page, fixture.first.name);
      await expect(manager.getByRole("button", { name: "Retry archived modules" })).toBeVisible();
      await archiveRefusal();
      await manager.getByRole("button", { name: "Retry archived modules" }).click();
      await expect(manager.getByRole("button", { name: "Retry archived modules" })).toHaveCount(0);
      const retry = manager.getByRole("button", { name: `Retry ${fixture.first.name} metadata`, exact: true });
      await expect(retry).toBeVisible();
      await metadataRefusal();
      await retry.click();
      await expect(retry).toHaveCount(0);
      await manager.getByRole("button", { name: `Expand ${fixture.first.name} stories`, exact: true }).click();
      await expect(manager.getByRole("tree", { name: `Stories in ${fixture.first.name}` })).toContainText(fixture.story.name);
      await manager.getByRole("button", { name: `Expand ${fixture.second.name} stories`, exact: true }).click();
      await expect(manager.locator(`[data-module-manager-stories="${fixture.second.id}"]`)).toContainText("No top-level stories");
      await expect(manager.getByRole("region", { name: "Hidden", exact: true })).toContainText("No modules");
    } finally { await fixture.cleanup(); }
  });

  test("retains search and cursor when narrow inspection returns to modules", { tag: "@case-manager-narrow" }, async ({ page, request }) => {
    const fixture = await managerFixture(request, "narrow");
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      const manager = await visitManager(page, fixture.first.name);
      await manager.getByRole("searchbox", { name: "Search modules" }).fill(fixture.prefix);
      await manager.getByRole("button", { name: `Inspect ${fixture.second.name}`, exact: true }).click();
      const back = manager.getByRole("button", { name: "Back to modules", exact: true });
      await expect(back).toBeFocused();
      await expect(manager.getByRole("region", { name: `Module details: ${fixture.second.name}`, exact: true })).toContainText(fixture.folder);
      await back.click();
      await expect(manager.getByRole("searchbox", { name: "Search modules" })).toHaveValue(fixture.prefix);
      await expect(manager.getByRole("button", { name: `Inspect ${fixture.second.name}`, exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(manager).toHaveCount(0);
      await expect(page.getByRole("tab", { name: fixture.first.name, exact: true })).toHaveAttribute("aria-selected", "true");
    } finally { await fixture.cleanup(); }
  });
  test("opens empty-workspace recovery and restores an explicitly hidden module", { tag: "@case-manager-empty-entry" }, async ({ page, request }) => {
    const fixture = await managerFixture(request, "empty-entry");
    try {
      const manager = await visitManager(page, fixture.first.name);
      const closeButtons = manager.getByRole("region", { name: "Open", exact: true }).getByRole("button", { name: /^Close .* tab$/ });
      while (await closeButtons.count()) {
        await closeButtons.first().click();
        if (await closeButtons.count()) await expect(closeButtons.first()).toBeEnabled();
      }
      await manager.getByRole("button", { name: "Close Module Manager", exact: true }).click();
      await page.getByRole("button", { name: "Manage modules", exact: true }).click();
      await expect(manager).toBeVisible();
      await manager.getByRole("region", { name: "Hidden", exact: true }).getByRole("button", { name: `Restore ${fixture.first.name}`, exact: true }).click();
      await expect(manager).toBeVisible();
      await manager.getByRole("region", { name: "Open", exact: true }).getByRole("button", { name: `Open ${fixture.first.name}`, exact: true }).click();
      await expect(manager).toHaveCount(0);
      await expect(page.getByRole("tab", { name: fixture.first.name, exact: true })).toHaveAttribute("aria-selected", "true");
    } finally { await fixture.cleanup(); }
  });

  test("classifies excluded and hidden modules and clears sprint restriction only for explicit navigation", { tag: "@case-manager-sprint-groups" }, async ({ page, request }) => {
    const fixture = await managerFixture(request, "sprint-groups");
    try {
      const manager = await visitManager(page, fixture.first.name);
      await manager.getByRole("button", { name: "Close Module Manager", exact: true }).click();
      const chooseNoSprint = async () => {
        await page.getByRole("button", { name: /^Sprint: / }).click();
        await page.getByRole("dialog", { name: "Choose sprint", exact: true }).getByRole("option", { name: /^No sprint/ }).click();
        await expect(page.getByRole("tab", { name: fixture.second.name, exact: true })).toHaveCount(0);
      };
      await chooseNoSprint();
      await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
      const excluded = manager.getByRole("region", { name: "Not in sprint", exact: true });
      const excludedRow = excluded.locator(`[data-module-manager-row="${fixture.second.id}"]`);
      await expect(excludedRow).toContainText("Clears sprint filter to show all modules");
      await excludedRow.getByRole("button", { name: `Inspect ${fixture.second.name}`, exact: true }).click();
      await expect(manager.getByRole("region", { name: `Module details: ${fixture.second.name}`, exact: true })).toContainText("Outside the current sprint filter");
      await expect(page.getByRole("tab", { name: fixture.second.name, exact: true })).toHaveCount(0);
      // Manager's explicit Open advertises filter clearing; ordinary tab selection cannot reach the excluded module.
      await excludedRow.getByRole("button", { name: `Open ${fixture.second.name}`, exact: true }).click();
      await expect(manager).toHaveCount(0);
      await expect(page.getByRole("tab", { name: fixture.second.name, exact: true })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("tab", { name: fixture.first.name, exact: true }).click();
      await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
      await manager.getByRole("region", { name: "Open", exact: true }).getByRole("button", { name: `Close ${fixture.second.name} tab`, exact: true }).click();
      await manager.getByRole("button", { name: "Close Module Manager", exact: true }).click();
      await chooseNoSprint();
      await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
      const hidden = manager.getByRole("region", { name: "Hidden", exact: true });
      await expect(hidden.getByRole("button", { name: `Restore ${fixture.second.name}`, exact: true })).toBeVisible();
      await expect(excluded.getByRole("button", { name: `Inspect ${fixture.second.name}`, exact: true })).toHaveCount(0);
      await hidden.getByRole("button", { name: `Restore ${fixture.second.name}`, exact: true }).click();
      await expect(manager).toBeVisible();
      await expect(page.getByRole("tab", { name: fixture.second.name, exact: true })).toBeVisible();
      await expect(page.getByRole("tab", { name: fixture.first.name, exact: true })).toHaveAttribute("aria-selected", "true");
      await page.reload();
      await expect(page.getByRole("tab", { name: fixture.second.name, exact: true })).toBeVisible();
    } finally { await fixture.cleanup(); }
  });

});

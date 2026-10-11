import { expect, test } from "@playwright/test";
import { CreateWorkTrackerWorkItemDocument } from "../../src/features/work-items/generated/workItems.documents";
import { getWorkspace, getWorkflowCatalog, graphqlRefusal } from "../support";
import { managerFixture, refuseNext } from "../module-manager-support";
import { createWorkItem, getWorkItems } from "../support";
import { CreateSprintDocument } from "../../src/features/sprints/generated/sprints.documents";
import { ReorderWorkTrackerWorkItemDocument, TransitionWorkTrackerWorkItemDocument } from "../../src/features/work-items/generated/workItems.documents";
import { WorkItemSprintDocument } from "../../src/features/work-items/generated/workItems.documents";
import { featureSuite } from "./featureSuite";
import { ids, openItem, installOverhaulFixture } from "../work-items-overhaul-support";
import { names, fixture, seedProject, editDescription, cleanupWorkItemsFixture, openFeatureModule as openModule, dragStoryTo } from "../work-items-migration-support";
import { getWorkItem, graphql, openWorkItem } from "../support";
import { UpdateWorkTrackerWorkItemDetailsDocument } from "../../src/features/work-items/generated/workItems.documents";

featureSuite("stories-list", () => {
 test.describe("overhaul regression", () => {
 installOverhaulFixture();
test("[overhaul-web-02] moving state relocates the row immediately", { tag: "@case-overhaul-web-02" }, async ({ page }) => {
  await openItem(page, "E2E moving");
  await page.getByTestId("state-picker").getByRole("button").click();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByTestId("state-picker")).toContainText("Review");
  await expect(page.getByRole("button", { name: /Collapse Review/ })).toContainText("1");
});

test("[overhaul-web-03] drag reorder survives the server reply and reload", { tag: "@case-overhaul-web-03" }, async ({ page }) => {
  const first = page.getByRole("treeitem", { name: /E2E first/ });
  const second = page.getByRole("treeitem", { name: /E2E second/ });
  await second.dragTo(first);
  await expect.poll(async () =>
    await page.getByRole("treeitem").evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-task-id")),
    )
  ).toEqual(expect.arrayContaining([ids.second, ids.first]));
  await page.reload();
  await expect(page.getByRole("treeitem", { name: /E2E second/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /E2E first/ })).toBeVisible();
  const order = await page.getByRole("treeitem").allTextContents();
  expect(order.findIndex((text) => text.includes("E2E second")))
    .toBeLessThan(order.findIndex((text) => text.includes("E2E first")));
});

test("[overhaul-web-06] cycling loaded selection has no loading flash", { tag: "@case-overhaul-web-06" }, async ({ page }) => {
  for (const name of ["E2E first", "E2E second"]) {
    await page.getByRole("treeitem", { name: new RegExp(name) }).click();
    await expect(page.getByTestId("issue-name")).toContainText(name);
    await expect(page.getByText("Loading issue…")).toHaveCount(0);
  }
  const parent = page.getByRole("treeitem", {
    name: /E2E parent(?: renamed)?/,
  });
  await parent.click();
  await expect(page.getByTestId("issue-name")).toContainText(/E2E parent/);
  await expect(page.getByText("Loading issue…")).toHaveCount(0);
});

test("[overhaul-web-12] expansion and collapsed sections survive reload", { tag: "@case-overhaul-web-12" }, async ({ page }) => {
  const parent = page.getByRole("treeitem", {
    name: /E2E parent(?: renamed)?/,
  });
  await parent.getByRole("button", { name: "Expand subtasks" }).click();
  await expect(page.getByRole("treeitem", { name: /E2E child/ })).toBeVisible();
  await page.getByRole("button", { name: "Collapse Review" }).click();
  await page.reload();
  await expect(page.getByRole("treeitem", { name: /E2E child/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand Review" })).toBeVisible();
});
 });
 test.describe("legacy browser regression", () => {
 test.beforeAll(async ({ request }) => { await seedProject(request); });
 test.afterAll(cleanupWorkItemsFixture);
test("reorders rows and preserves collapsed groups", { tag: "@case-stories-legacy-reorder" }, async ({
    page,
  }) => {
    await openModule(page, names.module);

    const first = page.getByRole("treeitem", { name: names.reorderFirst });
    const second = page.getByRole("treeitem", { name: names.reorderSecond });
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    const target = await first.boundingBox();
    expect(target).toBeTruthy();
    await second.dragTo(first, {
      targetPosition: { x: target!.width / 2, y: 2 },
    });
    await expect.poll(async () => {
      const labels = await page.getByRole("treeitem").allTextContents();
      return labels.findIndex((label) => label.includes(names.reorderSecond))
        < labels.findIndex((label) => label.includes(names.reorderFirst));
    }).toBe(true);

    await page.getByRole("button", { name: "Collapse Ideas" }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand Ideas" })).toBeVisible();
    await page.getByRole("button", { name: "Expand Ideas" }).click();
    await expect(page.getByRole("treeitem", { name: names.reorderFirst })).toBeVisible();

    const labelsAfterReload = await page.getByRole("treeitem").allTextContents();
    expect(labelsAfterReload.findIndex((label) =>
      label.includes(names.reorderSecond)
    )).toBeLessThan(labelsAfterReload.findIndex((label) =>
      label.includes(names.reorderFirst)
    ));
  });
 });
test.describe("Story name contract", () => {
let project: Awaited<ReturnType<typeof getWorkspace>>;
test.beforeAll(async ({ request }) => { project = await getWorkspace(request); });
  test("refuses a blank or oversized work item name", { tag: "@case-stories-name-guard" }, async ({ request }) => {
    const catalog = await getWorkflowCatalog(request, project.id);
    const storyType = catalog.issue_types.nodes
      .find((issueType) => issueType.name === "Story");
    expect(storyType, "the seeded Story issue type").toBeTruthy();

    const blank = await graphqlRefusal(request, CreateWorkTrackerWorkItemDocument, {
      projectId: project.id,
      name: "  ",
      issueTypeId: storyType!.id,
    });
    expect(blank.message).toContain("may not be blank");
    expect(blank.extensions?.field).toBe("name");

    // A work item name allows 512 characters, where a State name allows 255.
    const oversized = await graphqlRefusal(
      request,
      CreateWorkTrackerWorkItemDocument,
      {
        projectId: project.id,
        name: "E".repeat(513),
        issueTypeId: storyType!.id,
      },
    );
    expect(oversized.message).toContain("no more than 512");
    expect(oversized.extensions?.field).toBe("name");
  });


});
test.describe("Stories production paths", () => {
  test("captures an unassigned Story, keeps a refused draft and recovers on retry", { tag: "@case-stories-capture-recovery" }, async ({ page, request }) => {
    const f = await managerFixture(request, "capture");
    try {
      await page.goto("/");
      await page.getByRole("tab", { name: f.first.name, exact: true }).click();
      const entry = page.getByRole("textbox", { name: "Capture an idea" });
      const name = `${f.prefix} captured`;
      await entry.fill("   ");
      await entry.press("Enter");
      expect((await getWorkItems(request, f.project.id)).filter((row) => row.name === "   ")).toHaveLength(0);
      await entry.fill(name);
      await entry.press("Escape");
      await expect(entry).toHaveValue(name);
      await entry.focus();
      const restore = await refuseNext(page, "CreateWorkTrackerWorkItem");
      await entry.press("Enter");
      await expect(page.getByText(/Story could not be created:/)).toBeVisible();
      await expect(entry).toHaveValue(name);
      expect((await getWorkItems(request, f.project.id)).find((row) => row.name === name)).toBeUndefined();
      await restore();
      await entry.press("Enter");
      await expect(page.getByRole("treeitem", { name: new RegExp(name) })).toBeVisible();
      await expect(entry).toHaveValue("");
      const created = (await getWorkItems(request, f.project.id)).find((row) => row.name === name)!;
      expect(created.parent_id).toBe(f.first.id);
      expect((await graphql(request, WorkItemSprintDocument, { id: created.id })).worktrackerIssue.nodes[0]?.sprintId).toBeNull();
      await page.reload();
      await expect(page.getByRole("treeitem", { name: new RegExp(name) })).toBeVisible();
    } finally { await f.cleanup(); }
  });
  test("searches names, keys and descendants through mouse and keyboard and recovers from empty results", { tag: "@case-stories-search-tree" }, async ({ page, request }) => {
    const f = await managerFixture(request, "search");
    try {
      const catalog = await getWorkflowCatalog(request, f.project.id);
      const child = await createWorkItem(request, f.project.id, { name: `${f.prefix} nested needle`, parent_id: f.story.id, issue_type_id: catalog.issue_types.nodes.find((type) => type.name === "Implementation")!.id });
      await page.goto("/");
      await page.getByRole("tab", { name: f.first.name, exact: true }).click();
      const search = page.getByRole("textbox", { name: "Search stories" });
      const root = page.getByRole("treeitem", { name: new RegExp(f.story.name) });
      await root.click();
      await root.getByRole("button", { name: "Expand subtasks" }).click();
      await expect(page.getByRole("treeitem", { name: new RegExp(child.name) })).toBeVisible();
      await root.getByRole("button", { name: "Collapse subtasks" }).click();
      await page.getByRole("button", { name: "Open Settings" }).focus();
      await page.keyboard.press("/");
      await expect(search).toBeFocused();
      await search.fill("nested needle");
      await expect(root).toBeVisible();
      await expect(page.getByRole("treeitem", { name: new RegExp(child.name) })).toBeVisible();
      await search.press("Escape");
      await expect(search).toHaveValue("");
      await expect(page.getByRole("treeitem", { name: new RegExp(child.name) })).toHaveCount(0);
      for (const query of [`${f.project.slug}-${f.story.sequence_id}`, String(f.story.sequence_id)]) {
        await search.fill(query);
        await expect(root).toBeVisible();
      }
      await page.getByRole("button", { name: "Clear search", exact: true }).click();
      await search.fill(`${f.prefix} absent-result`);
      await expect(page.getByText(/No stories match/)).toBeVisible();
      await page.getByRole("button", { name: "Clear story search" }).click();
      await expect(root).toBeVisible();
      await search.focus();
      await search.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("issue-name")).toContainText(f.story.name);
      await page.reload();
      await expect(root).toBeVisible();
    } finally { await f.cleanup(); }
  });
  test("chooses sprint scopes with mouse and keyboard, cancels, retries reads and restores empty filters", { tag: "@case-stories-sprint-recovery" }, async ({ page, request }) => {
    const f = await managerFixture(request, "sprint");
    try {
      const name = `${f.prefix} planned`;
      const sprint = (await graphql(request, CreateSprintDocument, { data: { projectId: f.project.id, name } })).worktrackerSprintCreateOne;
      await page.goto("/");
      await page.getByRole("tab", { name: f.first.name, exact: true }).click();
      const trigger = page.getByRole("button", { name: /^Sprint:/ });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Choose sprint" });
      await dialog.getByRole("option", { name: /All sprints/ }).click();
      await trigger.focus();
      await trigger.press("ArrowDown");
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAccessibleName("Sprint: All sprints");
      await trigger.press("Enter");
      await dialog.getByRole("option", { name: /No sprint/ }).focus();
      await page.keyboard.press("Space");
      await expect(page.getByRole("treeitem", { name: new RegExp(f.story.name) })).toBeVisible();
      await page.reload();
      await expect(trigger).toHaveAccessibleName("Sprint: All sprints");
      await trigger.click();
      await dialog.getByRole("textbox", { name: "Search sprints" }).fill(name);
      await dialog.getByRole("option", { name: new RegExp(name) }).click();
      await expect(page.getByRole("region", { name: "Sprint module recovery" })).toContainText("No modules have stories in this sprint.");
      await page.getByRole("button", { name: "Show all sprints" }).first().click();
      await page.getByRole("tab", { name: f.first.name, exact: true }).click();
      await expect(page.getByRole("treeitem", { name: new RegExp(f.story.name) })).toBeVisible();
      const restore = await refuseNext(page, "ProjectStorySprintIndex", true);
      await page.reload();
      await expect(page.getByText(/Sprint filter unavailable/)).toBeVisible();
      await restore();
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(page.getByText(/Sprint filter unavailable/)).toHaveCount(0);
      expect((await getWorkItem(request, f.story.id)).parent_id).toBe(f.first.id);
      expect(sprint.status).toBe("planned");
    } finally { await f.cleanup(); }
  });
});
 test("cancels a root drag and restores order after a refused reorder before retry", { tag: "@case-stories-reorder-recovery" }, async ({ page, request }) => {
   const f = await managerFixture(request, "drag-recovery");
   try {
     const second = await createWorkItem(request, f.project.id, { name: `${f.prefix} second root`, issue_type_id: f.story.issue_type_id, parent_id: f.first.id });
     await graphql(request, ReorderWorkTrackerWorkItemDocument, { id: second.id, beforeId: f.story.id, afterId: null });
     const child = await createWorkItem(request, f.project.id, { name: `${f.prefix} child`, issue_type_id: f.story.issue_type_id, parent_id: f.story.id });
     await openModule(page, f.first.name);
     await page.getByRole("button", { name: /^Sprint:/ }).click();
     await page.getByRole("dialog", { name: "Choose sprint" }).getByRole("option", { name: /All sprints/ }).click();
     const root = page.getByRole("treeitem", { name: new RegExp(f.story.name) });
     const moving = page.getByRole("treeitem", { name: new RegExp(second.name) });
     await root.getByRole("button", { name: "Expand subtasks" }).click();
     const childRow = page.getByRole("treeitem", { name: new RegExp(child.name) });
     await expect(childRow).toBeVisible();
     const beforeCancel = await page.getByRole("treeitem").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-task-id")));
     await dragStoryTo(page, root, moving, true);
     await expect.poll(async () => page.getByRole("treeitem").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-task-id")))).toEqual(beforeCancel);
     await expect(childRow).toBeVisible();
     const initial = await page.getByRole("treeitem").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-task-id")));
     const original = await getWorkItem(request, second.id);
     const restore = await refuseNext(page, "ReorderWorkTrackerWorkItem");
     const refused = page.waitForResponse((response) => response.request().postDataJSON()?.operationName === "ReorderWorkTrackerWorkItem");
     await dragStoryTo(page, moving, root);
     expect((await (await refused).json()).errors[0].message).toBe("Injected ReorderWorkTrackerWorkItem refusal");
     await expect.poll(async () => page.getByRole("treeitem").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-task-id")))).toEqual(initial);
     expect((await getWorkItem(request, second.id)).rank).toBe(original.rank);
     await restore();
     await dragStoryTo(page, moving, root);
     await expect.poll(async () => {
       const labels = await page.getByRole("treeitem").allTextContents();
       return labels.findIndex((row) => row.includes(second.name)) < labels.findIndex((row) => row.includes(f.story.name));
     }).toBe(true);
     await page.reload();
     await expect(moving).toBeVisible();
     await expect(root).toBeVisible();
     const labels = await page.getByRole("treeitem").allTextContents();
     expect(labels.findIndex((row) => row.includes(second.name))).toBeLessThan(labels.findIndex((row) => row.includes(f.story.name)));
   } finally { await f.cleanup(); }
 });
 test("rolls back a refused cross-state root drag and recovers to the configured destination", { tag: "@case-stories-cross-state-recovery" }, async ({ page, request }) => {
   const f = await managerFixture(request, "state-drag");
   try {
     const catalog = await getWorkflowCatalog(request, f.project.id);
     const grill = catalog.states.nodes.find((row) => row.name === "Grill")!;
     const destination = await createWorkItem(request, f.project.id, { name: `${f.prefix} destination`, issue_type_id: f.story.issue_type_id, parent_id: f.first.id });
     await graphql(request, TransitionWorkTrackerWorkItemDocument, { id: destination.id, targetStateId: grill.id });
     await openModule(page, f.first.name);
     await page.getByRole("button", { name: /^Sprint:/ }).click();
     await page.getByRole("dialog", { name: "Choose sprint" }).getByRole("option", { name: /All sprints/ }).click();
     const moving = page.getByRole("treeitem", { name: new RegExp(f.story.name) });
     const header = page.getByRole("button", { name: "Collapse Grill" });
     const original = (await getWorkItem(request, f.story.id)).state_id;
     const restore = await refuseNext(page, "TransitionWorkTrackerWorkItem");
     const refused = page.waitForResponse((response) => response.request().postDataJSON()?.operationName === "TransitionWorkTrackerWorkItem");
     await dragStoryTo(page, moving, header);
     expect((await (await refused).json()).errors[0].message).toBe("Injected TransitionWorkTrackerWorkItem refusal");
     await moving.click();
     await expect(page.getByTestId("state-picker")).toContainText("Ideas");
     expect((await getWorkItem(request, f.story.id)).state_id).toBe(original);
     await restore();
     await dragStoryTo(page, moving, header);
     await expect.poll(async () => (await getWorkItem(request, f.story.id)).state_id).toBe(grill.id);
     await moving.click();
     await expect(page.getByTestId("state-picker")).toContainText("Grill");
     await page.reload();
     await expect(page.getByTestId("state-picker")).toContainText("Grill");
   } finally { await f.cleanup(); }
 });
 test("recovers a refused module-tree read through reload and opens state configuration without changing collapse", { tag: "@case-stories-tree-read-recovery" }, async ({ page, request }) => {
   const f = await managerFixture(request, "tree-read");
   try {
     const restore = await refuseNext(page, "WorkTrackerModuleOpen", true);
     const failed = page.waitForResponse((response) => response.request().postDataJSON()?.operationName === "WorkTrackerModuleOpen");
     await openModule(page, f.first.name);
     await page.getByRole("button", { name: /^Sprint:/ }).click();
     await page.getByRole("dialog", { name: "Choose sprint" }).getByRole("option", { name: /All sprints/ }).click();
     await failed;
     const root = page.getByRole("treeitem", { name: new RegExp(f.story.name) });
     await expect(root).toHaveCount(0);
     expect((await getWorkItem(request, f.story.id)).name).toBe(f.story.name);
     await restore();
     await page.reload();
     await expect(root).toBeVisible();
     await page.getByRole("button", { name: "Configure Ideas state" }).click();
     const panel = page.getByRole("region", { name: "Ideas state configuration" });
     await expect(panel).toBeVisible();
     await panel.getByRole("button", { name: "Close Ideas state configuration" }).click();
     await expect(panel).toHaveCount(0);
     await expect(page.getByRole("button", { name: "Collapse Ideas" })).toHaveAttribute("aria-expanded", "true");
     await page.getByRole("button", { name: "Collapse Ideas" }).click();
     await page.getByRole("button", { name: "Configure Ideas state" }).click();
     await expect(panel).toBeVisible();
     await panel.getByRole("button", { name: "Close Ideas state configuration" }).click();
     await expect(page.getByRole("button", { name: "Expand Ideas" })).toHaveAttribute("aria-expanded", "false");
     await page.reload();
     await expect(page.getByRole("button", { name: "Expand Ideas" })).toBeVisible();
   } finally { await f.cleanup(); }
 });
});

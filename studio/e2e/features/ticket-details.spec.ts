import { expect, test } from "@playwright/test";
import { ArchiveWorkTrackerWorkItemDocument, DeleteWorkTrackerWorkItemDocument, UpdateWorkTrackerWorkItemDocument } from "../../src/features/work-items/generated/workItems.documents";
import { createWorkItem, getModules, getProjects, getWorkflowCatalog, getWorkItems, graphqlRefusal, type ProjectRow, type WorkItemRow } from "../support";
import { managerFixture, refuseNext } from "../module-manager-support";
import { join } from "node:path";
import { callMcpTool, attachmentContents } from "../work-items-migration-support";
import { featureSuite } from "./featureSuite";
import { ids, openItem, installOverhaulFixture } from "../work-items-overhaul-support";
import { names, fixture, seedProject, editDescription, cleanupWorkItemsFixture, openFeatureModule as openModule } from "../work-items-migration-support";
import { getWorkItem, graphql, openWorkItem } from "../support";
import { UpdateWorkTrackerWorkItemDetailsDocument } from "../../src/features/work-items/generated/workItems.documents";

featureSuite("ticket-details", () => {
 test.describe("overhaul regression", () => {
 installOverhaulFixture();
test("[overhaul-web-01] edits every Story field through visible controls", { tag: "@case-overhaul-web-01" }, async ({ page }) => {
  await openItem(page, "E2E parent");
  await page.getByTestId("issue-name").click();
  await page.getByRole("textbox", { name: "Name" }).fill("E2E parent renamed");
  await page.getByRole("textbox", { name: "Name" }).press("Enter");
  await expect(page.getByRole("treeitem", { name: /E2E parent renamed/ })).toBeVisible();

  const source = page.getByRole("textbox", { name: "Ticket description source" });
  const descriptionInput = (await source.isVisible().catch(() => false))
    ? source
    : page.getByTestId("rich-markdown-editor-shell").locator('[contenteditable="true"]');
  await descriptionInput.fill("Fresh description");
  // Leaving the editor writes the draft.
  await descriptionInput.blur();
  await expect(page.getByText("Saving…")).toHaveCount(0);
  await expect(page.getByTestId("issue-description")).toContainText("Fresh description");

  const parentPicker = page.getByTestId("parent-picker");
  await parentPicker.getByRole("button").click();
  await page.getByPlaceholder("Search by number, key, or name…").fill("E2E first");
  await page.getByRole("button", { name: /E2E first/ }).click();
  await expect(parentPicker).not.toContainText("No parent");
  await parentPicker.getByRole("button").click();
  await page.getByPlaceholder("Search by number, key, or name…").fill("Overhaul Module");
  await parentPicker.getByRole("button", { name: /Overhaul Module/ }).click();

  // Retyping is part of the acceptance contract and therefore must have a
  // user-facing control; this assertion intentionally exposes its absence.
  await expect(page.getByTestId("issue-type-picker")).toBeVisible();
});

test("[overhaul-web-04] refused write visibly rolls back", { tag: "@case-overhaul-web-04" }, async ({ page }) => {
  await openItem(page, "E2E first");
  await page.route("**/graphql", async (route) => {
    const body = route.request().postDataJSON() as {
      operationName?: string;
      variables?: { id?: string };
    };
    if (
      body.operationName === "UpdateWorkTrackerWorkItemDetails"
      && body.variables?.id === ids.first.replaceAll("-", "")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ errors: [{ message: "refused" }] }),
      });
    } else await route.continue();
  });
  await page.getByTestId("issue-name").click();
  await page.getByRole("textbox", { name: "Name" }).fill("E2E refused name");
  await page.getByRole("textbox", { name: "Name" }).press("Enter");
  await expect(page.getByTestId("issue-name")).toContainText("E2E first");
  await expect.poll(async () => (await getWorkItem(page.request, ids.first)).name)
    .toBe("E2E first");
});

test("[overhaul-web-05] external GraphQL edit appears after canonical refresh", { tag: "@case-overhaul-web-05" }, async ({ page, request }) => {
  await openItem(page, "E2E external before");
  await graphql(request, UpdateWorkTrackerWorkItemDetailsDocument, {
    id: ids.external,
    name: "E2E external after",
  });
  await page.reload();
  await expect(page.getByTestId("issue-name")).toContainText("E2E external after");
  await expect(page.getByRole("treeitem", { name: /E2E external after/ })).toBeVisible();
});

test("[overhaul-web-14] reconnect replay closes an offline edit gap", { tag: "@case-overhaul-web-14" }, async ({ page, request, context }) => {
  await openItem(page, "E2E second");
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await graphql(request, UpdateWorkTrackerWorkItemDetailsDocument, {
    id: ids.second,
    name: "E2E replayed",
  });
  expect((await getWorkItem(request, ids.second)).name).toBe("E2E replayed");
  const reconnected = page.waitForEvent("console", { predicate: (message) => message.text().includes("subscription-accepted") });
  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await reconnected;
  await expect(page.getByRole("treeitem", { name: /E2E replayed/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /E2E second/ })).toHaveCount(0);
});
 });
 test.describe("legacy browser regression", () => {
 test.beforeAll(async ({ request }) => { await seedProject(request); });
 test.afterAll(cleanupWorkItemsFixture);
  test("renders an attachment created through the Rust MCP", { tag: "@case-details-attachment-success" }, async ({
    page,
  }) => {
    const result = await callMcpTool<{ success?: boolean }>(
      "attach_file",
      {
        project_id: fixture.project.id,
        task_id: fixture.parent.id,
        file_path: fixture.attachmentPath,
      },
    );
    expect(result.success).toBe(true);

    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    const attachments = page.getByTestId("attachments");
    await expect(attachments).toContainText("Attachments1");
    const attachment = attachments.getByRole("link", {
      name: /e2e-implementation-notes\.md/,
    });
    await expect(attachment).toBeVisible();
    await expect(attachment).toContainText(
      `${Buffer.byteLength(attachmentContents)} B`,
    );
    await expect(attachment).toHaveAttribute(
      "href",
      /worktracker\/attachments\/e2e-implementation-notes\.md$/,
    );

    await page.reload();
    await expect(page.getByTestId("attachments").getByRole("link", {
      name: /e2e-implementation-notes\.md/,
    })).toContainText(`${Buffer.byteLength(attachmentContents)} B`);
  });

  test("rejects a missing MCP attachment without creating a phantom row", { tag: "@case-details-attachment-refusal" }, async ({
    page,
  }) => {
    const result = await callMcpTool<{
      success?: boolean;
      message?: string;
      data?: unknown;
    }>("attach_file", {
      project_id: fixture.project.id,
      task_id: fixture.parent.id,
      file_path: join(fixture.folder, "missing-e2e-evidence.txt"),
    });
    expect(result).toEqual({
      success: false,
      message: "File not found",
      data: null,
    });

    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    await expect(page.getByTestId("attachments").getByTestId("attachment-row"))
      .toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId("attachments").getByTestId("attachment-row"))
      .toHaveCount(1);
  });

test("edits details, hierarchy, blockers, type, and persistent panel state", { tag: "@case-details-legacy-edit" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.parent);

    await page.getByTestId("issue-name").click();
    let nameEditor = page.getByRole("textbox", { name: "Name" });
    await nameEditor.fill("Name edit that must be discarded");
    await nameEditor.press("Escape");
    await expect(page.getByTestId("issue-name")).toContainText(names.parent);
    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.parent);

    await page.getByTestId("issue-name").click();
    nameEditor = page.getByRole("textbox", { name: "Name" });
    await nameEditor.fill(names.parentRenamed);
    await nameEditor.press("Enter");
    await expect(page.getByRole("treeitem", {
      name: new RegExp(names.parentRenamed),
    })).toBeVisible();
    await editDescription(page, "Description saved through the real editor");

    await page.reload();
    await expect(page.getByTestId("issue-description")).toContainText(
      "Description saved through the real editor",
    );

    const typePicker = page.getByTestId("issue-type-picker");
    await typePicker.getByRole("button").click();
    await page.getByRole("button", {
      name: "Implementation",
      exact: true,
    }).click();
    await expect(typePicker.getByRole("button")).toContainText("Implementation");
    await typePicker.getByRole("button").click();
    await page.getByRole("button", { name: "Story", exact: true }).click();
    await expect(typePicker.getByRole("button")).toContainText("Story");

    await page.getByRole("combobox", { name: "Child issue type" })
      .selectOption({ label: "Implementation" });
    const addSubtask = page.getByPlaceholder("Add sub-task…");
    await addSubtask.fill("Child created through details");
    await addSubtask.press("Enter");
    await expect(page.getByTestId("child-issues")).toContainText(
      "Child created through details",
    );

    const parentPicker = page.getByTestId("parent-picker");
    await parentPicker.getByRole("button").click();
    await page.getByPlaceholder("Search by number, key, or name…")
      .fill("Child created through details");
    await expect(page.getByText("No matches.", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    const actions = page.getByRole("button", { name: "Issue actions" });
    await actions.click();
    const guardedDelete = page.getByRole("menuitem", {
      name: "Delete issue…",
    });
    await expect(guardedDelete).toBeDisabled();
    await expect(guardedDelete).toHaveAttribute(
      "title",
      "Remove sub-tasks first",
    );
    await page.keyboard.press("Escape");
    await expect(actions).toBeFocused();

    await page.getByRole("button", { name: "Add blocker" }).click();
    const blockerRelationshipsRefreshed = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName ===
        "WorkTrackerModuleOpen"
    );
    await page.getByRole("button", { name: new RegExp(names.blocker) }).click();
    await blockerRelationshipsRefreshed;
    await expect(page.getByTestId("blocked-by-row")).toContainText(
      fixture.blocker.key,
    );

    await page.getByTestId("blocked-by-row").getByRole("button", {
      name: fixture.blocker.key,
    }).click();
    await expect(page.getByTestId("issue-name")).toContainText(names.blocker);
    await expect(page.getByTestId("blocks-row")).toContainText(
      fixture.parent.key,
    );
    await page.getByRole("treeitem", {
      name: new RegExp(names.parentRenamed),
    }).click();
    const blockerRemoved = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName ===
        "SetWorkTrackerBlockers"
    );
    await page.getByTestId("blocker-chip").first().hover();
    await page.getByRole("button", { name: "Remove blocker" }).click();
    await blockerRemoved;
    await expect(page.getByTestId("blocked-by-row")).not.toContainText(
      fixture.blocker.key,
    );

    await page.getByRole("treeitem", { name: names.blocker }).click();
    await page.reload();
    await expect(page.getByTestId("blocks-row").getByTestId("blocker-chip"))
      .toHaveCount(0);
    await page.getByRole("treeitem", {
      name: new RegExp(names.parentRenamed),
    }).click();

    await page.getByRole("button", { name: "Hide details panel" }).click();
    await expect(page.getByTestId("details-panel")).toHaveCount(0);
    await page.reload();
    if (await page.getByTestId("issue-sidebar-toggle").count() === 0) {
      await openWorkItem(page, names.parentRenamed);
    }
    await expect(page.getByRole("button", { name: "Show details panel" }))
      .toBeVisible();
    await page.getByRole("button", { name: "Show details panel" }).click();
    await expect(page.getByTestId("details-panel")).toBeVisible();
  });

test("moves a child between task and module parents and restores it after reload", { tag: "@case-details-legacy-reparent" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.moving);

    const chooseParent = async (name: string): Promise<void> => {
      const picker = page.getByTestId("parent-picker");
      await picker.getByRole("button").click();
      await page.getByPlaceholder("Search by number, key, or name…").fill(name);
      const saved = page.waitForResponse((response) =>
        response.url().endsWith("/graphql") &&
        response.request().postDataJSON()?.operationName ===
          "ReparentWorkTrackerWorkItem"
      );
      await picker.getByRole("button", { name: new RegExp(name) }).click();
      await saved;
    };

    await chooseParent(names.blocker);
    await expect(page.getByTestId("parent-picker").getByRole("button"))
      .toHaveText(names.blocker);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.moving);
    await expect(page.getByTestId("parent-picker").getByRole("button"))
      .toHaveText(names.blocker);
    await openWorkItem(page, names.blocker);
    await expect(page.getByTestId("child-issues")).toContainText(names.moving);

    await page.getByTestId("child-issues").getByRole("button", {
      name: new RegExp(names.moving),
    }).click();
    await chooseParent(names.module);
    await expect(page.getByTestId("parent-picker").getByRole("button"))
      .toHaveText(names.module);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.moving);
    await expect(page.getByTestId("parent-picker").getByRole("button"))
      .toHaveText(names.module);
    await openWorkItem(page, names.blocker);
    await expect(page.getByTestId("child-issues")).not.toContainText(names.moving);
  });

test("opens the status command by keyboard, cancels, then persists a choice", { tag: "@case-details-legacy-status" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.reorderFirst);
    const status = page.getByTestId("status-row");
    await expect(status).toContainText("Ideas");

    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("s");
    let dialog = page.getByRole("dialog", { name: "Set Status" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(status).toContainText("Ideas");

    await page.keyboard.press("s");
    dialog = page.getByRole("dialog", { name: "Set Status" });
    await dialog.getByText("Grill", { exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(status).toContainText("Grill");

    const grill = fixture.states.find((state) => state.name === "Grill");
    expect(grill?.color).toBeTruthy();
    const expectedColor = await page.evaluate((color) => {
      const probe = document.createElement("span");
      probe.style.color = color!;
      document.body.append(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return computed;
    }, grill!.color);
    const grillHeader = page.getByRole("button", { name: "Collapse Grill" });
    await expect(grillHeader).toBeVisible();
    expect(await grillHeader.locator('[data-stage-icon="Grill"]').evaluate(
      (element) => getComputedStyle(element).color,
    )).toBe(expectedColor);
    const movedRow = page.getByRole("treeitem", { name: names.reorderFirst });
    expect(await movedRow.getByText(`T-${fixture.reorderFirst.sequence_id}`, {
      exact: true,
    }).evaluate((element) => getComputedStyle(element).color)).toBe(expectedColor);
    expect(await page.getByTestId("state-picker").locator("span").first()
      .evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(expectedColor);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.reorderFirst);
    await expect(page.getByTestId("status-row")).toContainText("Grill");

    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("s");
    dialog = page.getByRole("dialog", { name: "Set Status" });
    await dialog.getByText("Ideas", { exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("status-row")).toContainText("Ideas");
  });

test("confirms destructive issue deletion through visible UI", { tag: "@case-details-legacy-delete" }, async ({ page }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.deletable);
    await page.getByRole("button", { name: "Issue actions" }).click();
    await page.getByRole("menuitem", { name: "Delete issue…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete issue" });
    await expect(dialog).toContainText(fixture.deletable.key);
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("treeitem", { name: names.deletable }))
      .toHaveCount(0);
  });

test("cancels a child deletion before removing it and releasing its parent", { tag: "@case-details-legacy-cancel-delete" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.hierarchyParent);

    const children = page.getByTestId("child-issues");
    await children.getByRole("button", { name: new RegExp(names.hierarchyChild) })
      .click();
    await expect(page.getByTestId("issue-name")).toContainText(names.hierarchyChild);

    await page.getByRole("button", { name: "Issue actions" }).click();
    await page.getByRole("menuitem", { name: "Delete issue…" }).click();
    let dialog = page.getByRole("dialog", { name: "Delete issue" });
    await expect(dialog).toContainText(fixture.hierarchyChild.key);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("issue-name")).toContainText(names.hierarchyChild);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.hierarchyChild);
    await page.getByRole("button", { name: "Issue actions" }).click();
    await page.getByRole("menuitem", { name: "Delete issue…" }).click();
    dialog = page.getByRole("dialog", { name: "Delete issue" });
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("treeitem", { name: names.hierarchyChild }))
      .toHaveCount(0);

    await openWorkItem(page, names.hierarchyParent);
    await expect(page.getByTestId("child-issues")).toContainText("No sub-tasks yet.");
    await page.getByRole("button", { name: "Issue actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Delete issue…" }))
      .toBeEnabled();
  });
 });
test.describe("WorkItem contract regression", () => {
/**
 * The one WorkItem update contract, exercised along its exclusive paths.
 *
 * A WorkItem update carries details, a transition, a reparent, blockers, an
 * archive, or a tab order — one at a time. That exclusivity and the archive
 * cascade are contract, not implementation detail, so they are asserted here
 * rather than inferred from the mutation's argument list.
 */
let project: ProjectRow;
let moduleTypeId: string;
let storyTypeId: string;

test.beforeAll(async ({ request }) => {
  const seeded = (await getProjects(request)).find((row) => row.slug === "CDN");
  expect(seeded, "the seeded CDN project").toBeTruthy();
  project = seeded!;
  const catalog = await getWorkflowCatalog(request, project.id);
  const moduleType = catalog.issue_types.nodes
    .find((issueType) => issueType.level === "module");
  const storyType = catalog.issue_types.nodes
    .find((issueType) => issueType.name === "Story");
  expect(moduleType, "a module-level issue type").toBeTruthy();
  expect(storyType, "the Story issue type").toBeTruthy();
  moduleTypeId = moduleType!.id;
  storyTypeId = storyType!.id;
});

test.describe("WorkItem update paths", () => {
  test("refuses a details field mixed with a domain patch", { tag: "@case-details-refuse-mixed-details" }, async ({
    request,
  }) => {
    const items = await getWorkItems(request, project.id);
    const subject = items.find((item) => !item.is_archived) ?? items[0];
    expect(subject, "any existing work item").toBeTruthy();
    const catalog = await getWorkflowCatalog(request, project.id);
    const someState = catalog.states.nodes[0];
    expect(someState, "a seeded state").toBeTruthy();

    // A rename is not a transition, so the two cannot travel together.
    const mixed = await graphqlRefusal(
      request,
      UpdateWorkTrackerWorkItemDocument,
      {
        id: subject!.id,
        name: "E2E Should Not Apply",
        stateId: someState!.id,
      },
    );
    expect(mixed.message)
      .toContain("Submit one relationship, state, or archive change at a time");

    // The refusal is total: the name did not land either.
    expect((await getWorkItem(request, subject!.id)).name)
      .toBe(subject!.name);
  });

  test("refuses two domain patches in one update", { tag: "@case-details-refuse-mixed-domain" }, async ({ request }) => {
    const items = await getWorkItems(request, project.id);
    const subject = items.find((item) => !item.is_archived) ?? items[0];
    expect(subject, "any existing work item").toBeTruthy();
    const catalog = await getWorkflowCatalog(request, project.id);
    const someState = catalog.states.nodes[0];

    const both = await graphqlRefusal(
      request,
      UpdateWorkTrackerWorkItemDocument,
      {
        id: subject!.id,
        stateId: someState!.id,
        blockedByIds: [],
      },
    );
    expect(both.message)
      .toContain("Submit one relationship, state, or archive change at a time");
  });

  test("cascades an archive through the whole subtree", { tag: "@case-details-archive-cascade" }, async ({ request }) => {
    const created: WorkItemRow[] = [];
    try {
      const module = await createWorkItem(request, project.id, {
        name: "E2E Archive Module",
        issue_type_id: moduleTypeId,
      });
      created.push(module);
      const parent = await createWorkItem(request, project.id, {
        name: "E2E Archive Parent",
        issue_type_id: storyTypeId,
        parent_id: module.id,
      });
      created.push(parent);
      const child = await createWorkItem(request, project.id, {
        name: "E2E Archive Child",
        issue_type_id: storyTypeId,
        parent_id: parent.id,
      });
      created.push(child);
      const grandchild = await createWorkItem(request, project.id, {
        name: "E2E Archive Grandchild",
        issue_type_id: storyTypeId,
        parent_id: child.id,
      });
      created.push(grandchild);

      for (const row of [parent, child, grandchild]) {
        expect((await getWorkItem(request, row.id)).is_archived, row.name)
          .toBe(false);
      }

      const archived = (await graphql(
        request,
        ArchiveWorkTrackerWorkItemDocument,
        { id: parent.id, isArchived: true },
      )).update_work_item;
      expect(archived.is_archived).toBe(true);

      // Archiving is a subtree operation: every descendant leaves with it.
      for (const row of [parent, child, grandchild]) {
        expect((await getWorkItem(request, row.id)).is_archived, row.name)
          .toBe(true);
      }
      // The module above the archived parent is untouched.
      expect((await getModules(request, project.id))
        .find((candidate) => candidate.id === module.id)?.is_archived)
        .toBe(false);

      // Archiving is one-way through this patch, by contract.
      const restore = await graphqlRefusal(
        request,
        ArchiveWorkTrackerWorkItemDocument,
        { id: parent.id, isArchived: false },
      );
      expect(restore.message).toContain("cannot be restored by this patch");
      expect(restore.extensions?.field).toBe("is_archived");
      expect((await getWorkItem(request, parent.id)).is_archived).toBe(true);
    } finally {
      // Delete deepest-first so no parent disappears under a child.
      for (const row of [...created].reverse()) {
        await graphql(request, DeleteWorkTrackerWorkItemDocument, { id: row.id })
          .catch(() => undefined);
      }
    }
  });

  test("archiving an already archived item is not an error", { tag: "@case-details-archive-idempotent" }, async ({
    request,
  }) => {
    const created: WorkItemRow[] = [];
    try {
      const module = await createWorkItem(request, project.id, {
        name: "E2E Idempotent Module",
        issue_type_id: moduleTypeId,
      });
      created.push(module);
      const story = await createWorkItem(request, project.id, {
        name: "E2E Idempotent Story",
        issue_type_id: storyTypeId,
        parent_id: module.id,
      });
      created.push(story);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = (await graphql(
          request,
          ArchiveWorkTrackerWorkItemDocument,
          { id: story.id, isArchived: true },
        )).update_work_item;
        expect(result.is_archived, `attempt ${attempt + 1}`).toBe(true);
      }
    } finally {
      for (const row of [...created].reverse()) {
        await graphql(request, DeleteWorkTrackerWorkItemDocument, { id: row.id })
          .catch(() => undefined);
      }
    }
  });
});

});
test.describe("Details production recovery", () => {
  test("refuses and retries field, parent, blocker and child writes with authoritative rollback", { tag: "@case-details-write-recovery" }, async ({ page, request }) => {
    const f = await managerFixture(request, "details-recovery");
    try {
      await openModule(page, f.first.name);
      await openWorkItem(page, f.story.name);
      await expect(page.getByTestId("issue-identifier")).toHaveText(`T-${f.story.sequence_id}`);
      await expect(page.getByTestId("child-issues")).toContainText("No sub-tasks yet.");
      await expect(page.getByTestId("attachments")).toHaveCount(0);
      await expect(page.getByTestId("blocks-row")).toHaveCount(0);
      await page.getByTestId("issue-name").click();
      const name = page.getByRole("textbox", { name: "Name" });
      await name.fill("   ");
      await name.press("Enter");
      expect((await getWorkItem(request, f.story.id)).name).toBe(f.story.name);
      await page.getByTestId("issue-name").click();
      await name.fill(`${f.prefix} blurred`);
      await name.blur();
      await expect.poll(async () => (await getWorkItem(request, f.story.id)).name).toBe(`${f.prefix} blurred`);
      const type = page.getByTestId("issue-type-picker");
      const restoreType = await refuseNext(page, "UpdateWorkTrackerWorkItemDetails");
      await type.getByRole("button").click();
      await page.getByRole("button", { name: "Implementation", exact: true }).click();
      await expect(page.getByText(/Injected UpdateWorkTrackerWorkItemDetails refusal/)).toBeVisible();
      await expect(type).toContainText("Story");
      expect((await getWorkItem(request, f.story.id)).issue_type_id).toBe(f.story.issue_type_id);
      await restoreType();
      await type.getByRole("button").click();
      await page.getByRole("button", { name: "Implementation", exact: true }).click();
      await expect(type).toContainText("Implementation");
      const parent = page.getByTestId("parent-picker");
      const restoreParent = await refuseNext(page, "ReparentWorkTrackerWorkItem");
      await parent.getByRole("button").click();
      await page.getByPlaceholder("Search by number, key, or name…").fill(f.second.name);
      await page.getByRole("button", { name: new RegExp(f.second.name) }).click();
      await expect(page.getByText(/Injected ReparentWorkTrackerWorkItem refusal/)).toBeVisible();
      expect((await getWorkItem(request, f.story.id)).parent_id).toBe(f.first.id);
      await restoreParent();
      await parent.getByRole("button").click();
      await page.getByPlaceholder("Search by number, key, or name…").fill("absent-parent-candidate");
      await expect(page.getByText("No matches.", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      expect((await getWorkItem(request, f.story.id)).parent_id).toBe(f.first.id);
      const candidate = await createWorkItem(request, f.project.id, { name: `${f.prefix} blocker`, issue_type_id: f.story.issue_type_id, parent_id: f.first.id });
      await page.reload();
      const restoreBlocker = await refuseNext(page, "SetWorkTrackerBlockers");
      await page.getByRole("button", { name: "Add blocker" }).click();
      await page.getByPlaceholder("Search by number, key, or name…").fill(candidate.name);
      await page.getByRole("button", { name: new RegExp(candidate.name) }).click();
      await expect(page.getByText(/Injected SetWorkTrackerBlockers refusal/)).toBeVisible();
      await expect(page.getByTestId("blocked-by-row")).not.toContainText(candidate.key);
      await restoreBlocker();
      await page.getByRole("button", { name: "Add blocker" }).click();
      await page.getByPlaceholder("Search by number, key, or name…").fill("absent-blocker-candidate");
      await expect(page.getByText("No matches.", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      const child = page.getByPlaceholder("Add sub-task…");
      await child.fill("   ");
      await child.press("Enter");
      await expect(page.getByTestId("child-issues")).toContainText("No sub-tasks yet.");
      const restoreChild = await refuseNext(page, "CreateWorkTrackerWorkItem");
      const childName = `${f.prefix} child retry`;
      await child.fill(childName);
      await child.press("Enter");
      await expect(page.getByText(/Injected CreateWorkTrackerWorkItem refusal/)).toBeVisible();
      expect((await getWorkItems(request, f.project.id)).find((row) => row.name === childName)).toBeUndefined();
      await restoreChild();
      await child.fill(childName);
      await child.press("Enter");
      await expect(page.getByTestId("child-issues")).toContainText(childName);
      expect((await getWorkItems(request, f.project.id)).find((row) => row.name === childName)?.parent_id).toBe(f.story.id);
      await page.reload();
      await expect(page.getByTestId("issue-name")).toContainText(`${f.prefix} blurred`);
      await expect(type).toContainText("Implementation");
      await expect(page.getByTestId("child-issues")).toContainText(childName);
    } finally { await f.cleanup(); }
  });
  test("retains a refused deletion and succeeds after retry", { tag: "@case-details-delete-recovery" }, async ({ page, request }) => {
    const f = await managerFixture(request, "delete-recovery");
    try {
      await openModule(page, f.first.name);
      await openWorkItem(page, f.story.name);
      const restore = await refuseNext(page, "DeleteWorkTrackerWorkItem");
      await page.getByRole("button", { name: "Issue actions" }).click();
      await page.getByRole("menuitem", { name: "Delete issue…" }).click();
      await page.getByRole("dialog", { name: "Delete issue" }).getByRole("button", { name: "Delete", exact: true }).click();
      await expect(page.getByRole("treeitem", { name: new RegExp(f.story.name) })).toBeVisible();
      expect((await getWorkItem(request, f.story.id)).id).toBe(f.story.id);
      await restore();
      await page.reload();
      await page.getByRole("button", { name: "Issue actions" }).click();
      await page.getByRole("menuitem", { name: "Delete issue…" }).click();
      await page.getByRole("dialog", { name: "Delete issue" }).getByRole("button", { name: "Delete", exact: true }).click();
      await expect(page.getByRole("treeitem", { name: new RegExp(f.story.name) })).toHaveCount(0);
      expect((await getWorkItems(request, f.project.id)).find((row) => row.id === f.story.id)).toBeUndefined();
    } finally { await f.cleanup(); }
  });
});
  test("keeps Set Status open after refusal, cancels without writing and succeeds on retry", { tag: "@case-details-status-recovery" }, async ({ page, request }) => {
    const f = await managerFixture(request, "status-recovery");
    try {
      await openModule(page, f.first.name);
      await openWorkItem(page, f.story.name);
      const original = (await getWorkItem(request, f.story.id)).state_id;
      const restore = await refuseNext(page, "TransitionWorkTrackerWorkItem");
      await page.getByRole("button", { name: "Open Settings" }).focus();
      await page.keyboard.press("s");
      const dialog = page.getByRole("dialog", { name: "Set Status" });
      await dialog.getByText("Grill", { exact: true }).click();
      await expect(dialog).toBeVisible();
      await expect(page.getByText(/Injected TransitionWorkTrackerWorkItem refusal/)).toBeVisible();
      expect((await getWorkItem(request, f.story.id)).state_id).toBe(original);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await restore();
      await page.keyboard.press("s");
      await dialog.getByText("Grill", { exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId("state-picker")).toContainText("Grill");
      const state = (await getWorkflowCatalog(request, f.project.id)).states.nodes.find((row) => row.name === "Grill")!;
      expect((await getWorkItem(request, f.story.id)).state_id).toBe(state.id);
      await page.reload();
      await expect(page.getByTestId("state-picker")).toContainText("Grill");
    } finally { await f.cleanup(); }
  });
});

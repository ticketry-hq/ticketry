import { expect, test, type Locator } from "@playwright/test";
import { featureSuite } from "./featureSuite";
import {
  CreateWorkTrackerWorkItemDocument,
  DeleteWorkTrackerWorkItemDocument,
} from "../../src/features/work-items/generated/workItems.documents";
import {
  CreateWorkTrackerIssueTypeDocument,
  CreateWorkTrackerStateDocument,
  CreateWorkTrackerTransitionDocument,
  DeleteWorkTrackerIssueTypeDocument,
  DeleteWorkTrackerStateDocument,
  DeleteWorkTrackerTransitionDocument,
  RemoveWorkTrackerWorkflowStateDocument,
  ReorderWorkTrackerIssueTypesDocument,
  ReorderWorkTrackerStatesDocument,
  SetWorkTrackerAutoStartDocument,
  SetWorkTrackerStartStateDocument,
  UpdateWorkTrackerStateDocument,
  UpdateWorkTrackerTransitionDocument,
  UpsertWorkTrackerLaunchBindingDocument,
} from "../../src/features/workflows/generated/workflows.documents";
import { UpdateProviderCatalogDocument } from "../../src/features/settings/generated/providerCatalog.documents";
import {
  captureLegacyProductApiRequests,
  CODEX_TEST_MODEL,
  CODEX_TEST_REASONING,
  createWorkItem,
  getProjects,
  getProviderCatalog,
  getWorkItem,
  getWorkItems,
  getWorkflowCatalog,
  graphql,
  graphqlRefusal,
  openWorkItem,
  type ProjectRow,
  type WorkItemRow,
} from "../support";
import { failGraphqlOperation, holdGraphqlOperation } from "../graphql-failure-injection";
import {
  closeStatePolicy,
  disposableTaskType,
  installSkill,
  issueTypeNode,
  launchBinding,
  openStatePolicy,
  seededState,
  transition,
  workflowWrite,
} from "../workflow-policy-support";
import {
  callMcpTool,
  cleanupWorkItemsFixture,
  fixture,
  names,
  openFeatureModule as openModule,
  seedProject,
  selectState,
} from "../work-items-migration-support";

featureSuite("workflows-and-issue-types", { isolation: "case" }, () => {
  let legacyProductApiRequests: string[] = [];

  test.beforeAll(async ({ request }) => {
    await seedProject(request);
  });
  test.afterAll(cleanupWorkItemsFixture);

  test.beforeEach(async ({ page }) => {
    legacyProductApiRequests = captureLegacyProductApiRequests(page);
  });

  test.afterEach(async () => {
    expect(legacyProductApiRequests).toEqual([]);
  });

  test("reorders the state catalog through Rust and regroups the open tree", { tag: "@case-workflow-state-catalog-reorder" }, async ({
    page,
    request,
  }) => {
    const seeded = [...fixture.states]
      .sort((left, right) => left.sort_order - right.sort_order);
    const seededNames = new Set(seeded.map((state) => state.name));
    const headerOrder = () => page
      .locator('button[aria-label^="Collapse "], button[aria-label^="Expand "]')
      .evaluateAll((buttons) => buttons.map((button) =>
        (button.getAttribute("aria-label") ?? "")
          .replace(/^(?:Collapse|Expand) /, "")
      ))
      .then((labels) => labels.filter((label) => seededNames.has(label)));
    const reorder = (order: typeof seeded) =>
      graphql(request, ReorderWorkTrackerStatesDocument, {
        projectId: fixture.project.id,
        orderedIds: order.map((state) => state.id),
      });

    await openModule(page, names.module);
    await expect.poll(headerOrder).toEqual(seeded.map((state) => state.name));

    // Rotate the tail state to the front: an arrangement no other test leaves.
    const rotated = [seeded[seeded.length - 1]!, ...seeded.slice(0, -1)];
    try {
      const reordered = (await reorder(rotated)).reorder_states;
      // Reorder replaces the whole project-owned ordering, so every row is
      // renumbered contiguously rather than only the state that moved.
      expect([...reordered]
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((state) => [state.name, state.sort_order]))
        .toEqual(rotated.map((state, index) => [state.name, index]));

      // Each reordered row is published as a durable fact carrying the whole
      // state, so the open tree regroups without a refetch or a reload.
      await expect.poll(headerOrder).toEqual(rotated.map((state) => state.name));
      await page.reload();
      await expect.poll(headerOrder).toEqual(rotated.map((state) => state.name));
    } finally {
      await reorder(seeded);
    }

    await page.reload();
    await expect.poll(headerOrder).toEqual(seeded.map((state) => state.name));
  });

  test("refuses a Story move outside the published workflow until an edge exists", { tag: "@case-workflow-move-outside-published-edges" }, async ({
    page,
    request,
  }) => {
    const startStateId = fixture.storyType.start_state as string | null;
    const origin = fixture.states.find((state) => state.id === startStateId);
    expect(origin, "the Story start state").toBeTruthy();
    const parkingName = "E2E Parking";
    const probeName = "Complete workflow probe";

    const parking = (await graphql(request, CreateWorkTrackerStateDocument, {
      projectId: fixture.project.id,
      name: parkingName,
      group: "unstarted",
      color: "#7C3AED",
    })).create_state;
    const probe = await createWorkItem(request, fixture.project.id, {
      name: probeName,
      issue_type_id: fixture.storyType.id,
      parent_id: fixture.module.id,
    });

    /** The Story workflow revision every guarded write has to present. */
    const workflowRevision = async (): Promise<number> => {
      const catalog = await getWorkflowCatalog(request, fixture.project.id);
      const story = catalog.issue_types.nodes.find((issueType) =>
        issueType.id === fixture.storyType.id
      );
      expect(story, "the seeded Story issue type").toBeTruthy();
      return story!.workflow_revision;
    };
    const attemptMoveToParking = async (): Promise<void> => {
      await page.getByRole("button", { name: "Open Settings" }).focus();
      await page.keyboard.press("s");
      const dialog = page.getByRole("dialog", { name: "Set Status" });
      await expect(dialog).toBeVisible();
      await dialog.getByText(parkingName, { exact: true }).click();
    };

    try {
      await openModule(page, names.module);
      // The create fact carries the whole row, so the new section appears in
      // the open tree without a reload.
      await expect(page.getByRole("button", { name: `Collapse ${parkingName}` }))
        .toBeVisible();
      await openWorkItem(page, probeName);
      await expect(page.getByTestId("status-row")).toContainText(origin!.name);

      // No published edge reaches the new state, so Rust refuses the move and
      // the visible status stays where it was.
      await attemptMoveToParking();
      await expect(page.getByTestId("toast-error")).toBeVisible();
      await expect(page.getByTestId("status-row")).toContainText(origin!.name);
      expect((await getWorkItem(request, probe.id)).state_id).toBe(origin!.id);

      for (const edge of [
        { fromStateId: origin!.id, toStateId: parking.id },
        { fromStateId: parking.id, toStateId: origin!.id },
      ]) {
        await graphql(request, CreateWorkTrackerTransitionDocument, {
          issueTypeId: fixture.storyType.id,
          agentAllowed: false,
          handoff: false,
          workflowRevision: await workflowRevision(),
          ...edge,
        });
      }

      await page.reload();
      await openWorkItem(page, probeName);
      await attemptMoveToParking();
      await expect(page.getByTestId("status-row")).toContainText(parkingName);
      await expect
        .poll(async () => (await getWorkItem(request, probe.id)).state_id)
        .toBe(parking.id);

      // Withdrawing the state from the workflow closes both edges again.
      await selectState(page, origin!.name);
      await graphql(request, RemoveWorkTrackerWorkflowStateDocument, {
        issueTypeId: fixture.storyType.id,
        stateId: parking.id,
        workflowRevision: await workflowRevision(),
      });

      await page.reload();
      await openWorkItem(page, probeName);
      await attemptMoveToParking();
      await expect(page.getByTestId("toast-error")).toBeVisible();
      await expect(page.getByTestId("status-row")).toContainText(origin!.name);
      expect((await getWorkItem(request, probe.id)).state_id).toBe(origin!.id);
    } finally {
      await graphql(request, DeleteWorkTrackerWorkItemDocument, { id: probe.id });
      await graphql(request, DeleteWorkTrackerStateDocument, { id: parking.id });
    }

    await page.reload();
    await expect(page.getByRole("button", { name: `Collapse ${parkingName}` }))
      .toHaveCount(0);
  });

  test("reorders issue types through Rust and reorders the visible type picker", { tag: "@case-workflow-issue-type-reorder" }, async ({
    page,
    request,
  }) => {
    const catalog = await getWorkflowCatalog(request, fixture.project.id);
    const seeded = [...catalog.issue_types.nodes]
      .sort((left, right) => left.sort_order - right.sort_order);
    expect(seeded.length).toBeGreaterThan(1);
    const taskTypeNames = seeded
      .filter((issueType) => issueType.level === "task")
      .map((issueType) => issueType.name);
    expect(taskTypeNames.length).toBeGreaterThan(1);
    const reorder = (order: typeof seeded) =>
      graphql(request, ReorderWorkTrackerIssueTypesDocument, {
        projectId: fixture.project.id,
        orderedIds: order.map((issueType) => issueType.id),
      });
    const pickerOrder = async (): Promise<string[]> => {
      const picker = page.getByTestId("issue-type-picker");
      await picker.getByRole("button").first().click();
      const labels = await picker.getByRole("button").allTextContents();
      await page.keyboard.press("Escape");
      return labels
        .map((label) => label.trim())
        .filter((label) => taskTypeNames.includes(label));
    };

    await openModule(page, names.module);
    await openWorkItem(page, names.blocker);
    // The trigger repeats the selected type, so compare the tail of the list.
    expect((await pickerOrder()).slice(-taskTypeNames.length))
      .toEqual(taskTypeNames);

    // Rotate the whole project-owned set; the picker reads only task levels.
    const rotated = [seeded[seeded.length - 1]!, ...seeded.slice(0, -1)];
    const rotatedTaskNames = rotated
      .filter((issueType) => issueType.level === "task")
      .map((issueType) => issueType.name);
    try {
      const reordered = (await reorder(rotated)).reorder_issue_types;
      expect([...reordered]
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((issueType) => [issueType.name, issueType.sort_order]))
        .toEqual(rotated.map((issueType, index) => [issueType.name, index]));

      // The catalog read is cache-first, so a fresh client proves persistence.
      await page.reload();
      await openWorkItem(page, names.blocker);
      expect((await pickerOrder()).slice(-rotatedTaskNames.length))
        .toEqual(rotatedTaskNames);
    } finally {
      await reorder(seeded);
    }

    await page.reload();
    await openWorkItem(page, names.blocker);
    expect((await pickerOrder()).slice(-taskTypeNames.length))
      .toEqual(taskTypeNames);
  });

  test("renames and recolours a state through Rust and converges the open tree", { tag: "@case-workflow-state-rename-recolour" }, async ({
    page,
    request,
  }) => {
    const original = [...fixture.states]
      .sort((left, right) => left.sort_order - right.sort_order)
      .at(-1);
    expect(original, "the last seeded state").toBeTruthy();
    const renamed = "E2E Shelved";
    const recolour = "#7C3AED";
    const header = (stateName: string) =>
      page.getByRole("button", { name: `Collapse ${stateName}` });
    const iconColour = async (stateName: string): Promise<string> => {
      const icon = header(stateName).locator(`[data-stage-icon="${stateName}"]`);
      return await icon.evaluate((element) => getComputedStyle(element).color);
    };
    const asComputed = (colour: string) => page.evaluate((value) => {
      const probe = document.createElement("span");
      probe.style.color = value;
      document.body.append(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return computed;
    }, colour);

    await openModule(page, names.module);
    await expect(header(original!.name)).toBeVisible();

    try {
      const updated = (await graphql(request, UpdateWorkTrackerStateDocument, {
        id: original!.id,
        name: renamed,
        color: recolour,
      })).update_state;
      expect(updated).toMatchObject({ name: renamed, color: recolour });

      // One updated fact carries the whole row, so the section is renamed and
      // recoloured in place — it must not appear twice or leave a stale header.
      await expect(header(renamed)).toBeVisible();
      await expect(header(renamed)).toHaveCount(1);
      await expect(header(original!.name)).toHaveCount(0);
      expect(await iconColour(renamed)).toBe(await asComputed(recolour));

      await page.reload();
      await expect(header(renamed)).toHaveCount(1);
      await expect(header(original!.name)).toHaveCount(0);
    } finally {
      await graphql(request, UpdateWorkTrackerStateDocument, {
        id: original!.id,
        name: original!.name,
        color: original!.color,
      });
    }

    await page.reload();
    await expect(header(original!.name)).toHaveCount(1);
    await expect(header(renamed)).toHaveCount(0);
  });

  test("creates an issue type, moves its start state, and deletes it by reassigning", { tag: "@case-workflow-issue-type-lifecycle" }, async ({
    page,
    request,
  }) => {
    const byName = (stateName: string) => {
      const state = fixture.states.find((row) => row.name === stateName);
      expect(state, `the seeded ${stateName} state`).toBeTruthy();
      return state!;
    };
    const ideas = byName("Ideas");
    const grill = byName("Grill");
    const typeName = "E2E Chore";
    const firstItem = "Complete chore before the move";
    const secondItem = "Complete chore after the move";

    const chore = (await graphql(request, CreateWorkTrackerIssueTypeDocument, {
      projectId: fixture.project.id,
      name: typeName,
      level: "task",
      color: "#0EA5E9",
    })).create_issue_type;
    expect(chore).toMatchObject({ name: typeName, level: "task" });
    // A fresh type publishes no workflow, so it starts with no start state.
    expect(chore.start_state).toBeNull();

    const revision = async (): Promise<number> => {
      const catalog = await getWorkflowCatalog(request, fixture.project.id);
      const row = catalog.issue_types.nodes.find((issueType) =>
        issueType.id === chore.id
      );
      expect(row, `the ${typeName} issue type`).toBeTruthy();
      return row!.workflow_revision;
    };
    const createChore = (name: string) => createWorkItem(
      request,
      fixture.project.id,
      { name, issue_type_id: chore.id, parent_id: fixture.module.id },
    );
    const sectionFor = (name: string) => page.evaluate((itemName) => {
      const rows = Array.from(document.querySelectorAll(
        '[role="tree"] li, [role="tree"] [role="treeitem"]',
      ));
      const index = rows.findIndex((row) =>
        row.getAttribute("role") === "treeitem" &&
        (row.textContent ?? "").includes(itemName)
      );
      if (index < 0) return null;
      for (let cursor = index; cursor >= 0; cursor -= 1) {
        const label = rows[cursor]?.querySelector("button")
          ?.getAttribute("aria-label") ?? "";
        const match = /^(?:Collapse|Expand) (.+)$/.exec(label);
        if (match && !label.endsWith("subtasks")) return match[1];
      }
      return null;
    }, name);

    let firstRow: WorkItemRow | null = null;
    let secondRow: WorkItemRow | null = null;
    try {
      await graphql(request, SetWorkTrackerStartStateDocument, {
        id: chore.id,
        startStateId: ideas.id,
        workflowRevision: await revision(),
      });
      firstRow = await createChore(firstItem);
      await openModule(page, names.module);
      await expect(page.getByRole("treeitem", { name: new RegExp(firstItem) }))
        .toBeVisible();
      expect(await sectionFor(firstItem)).toBe(ideas.name);

      // The revision guard rejects a stale claim rather than racing it.
      const stale = await graphqlRefusal(
        request,
        SetWorkTrackerStartStateDocument,
        {
          id: chore.id,
          startStateId: grill.id,
          workflowRevision: (await revision()) - 1,
        },
      );
      expect(stale.message).toBeTruthy();

      await graphql(request, SetWorkTrackerStartStateDocument, {
        id: chore.id,
        startStateId: grill.id,
        workflowRevision: await revision(),
      });
      secondRow = await createChore(secondItem);
      await page.reload();
      await expect(page.getByRole("treeitem", { name: new RegExp(secondItem) }))
        .toBeVisible();
      expect(await sectionFor(secondItem)).toBe(grill.name);
      // Moving the start state must not relocate the item already filed.
      expect(await sectionFor(firstItem)).toBe(ideas.name);

      // Two issues still use the type, so an unqualified delete is refused.
      const refused = await graphqlRefusal(
        request,
        DeleteWorkTrackerIssueTypeDocument,
        { id: chore.id },
      );
      expect(refused.message).toContain("reassign_to");

      await graphql(request, DeleteWorkTrackerIssueTypeDocument, {
        id: chore.id,
        reassignTo: fixture.storyType.id,
      });
      // Reassignment repoints both issues before the type disappears.
      for (const row of [firstRow, secondRow]) {
        expect((await getWorkItem(request, row!.id)).issue_type_id)
          .toBe(fixture.storyType.id);
      }
      const remaining = await getWorkflowCatalog(request, fixture.project.id);
      expect(remaining.issue_types.nodes.map((issueType) => issueType.name))
        .not.toContain(typeName);
    } finally {
      for (const row of [firstRow, secondRow]) {
        if (row) {
          await graphql(request, DeleteWorkTrackerWorkItemDocument, { id: row.id });
        }
      }
    }
  });

  test("guards State deletion and converges the removal into the open tree", { tag: "@case-workflow-state-delete-guard" }, async ({
    page,
    request,
  }) => {
    const protectedState = fixture.states.find((state) => state.is_protected);
    expect(protectedState, "a protected seeded state").toBeTruthy();
    const origin = fixture.states.find((state) =>
      state.id === (fixture.storyType.start_state as string | null)
    );
    expect(origin, "the Story start state").toBeTruthy();
    const disposable = "E2E Disposable";
    const header = page.getByRole("button", { name: `Collapse ${disposable}` });
    const workflowRevision = async (): Promise<number> => {
      const catalog = await getWorkflowCatalog(request, fixture.project.id);
      const story = catalog.issue_types.nodes.find((issueType) =>
        issueType.id === fixture.storyType.id
      );
      expect(story, "the seeded Story issue type").toBeTruthy();
      return story!.workflow_revision;
    };

    // A reviewed default state is protected, so deletion is refused outright.
    const refusedProtected = await graphqlRefusal(
      request,
      DeleteWorkTrackerStateDocument,
      { id: protectedState!.id },
    );
    expect(refusedProtected.message).toContain("protected");

    // The last-state-in-group guard is unreachable from here: every group the
    // schema allows is already seeded, and the single-occupant groups hold
    // protected states, so the protected guard always answers first.
    const created = (await graphql(request, CreateWorkTrackerStateDocument, {
      projectId: fixture.project.id,
      name: disposable,
      group: origin!.group,
      color: "#0EA5E9",
    })).create_state;

    let removed = false;
    try {
      await openModule(page, names.module);
      await expect(header).toBeVisible();

      await graphql(request, CreateWorkTrackerTransitionDocument, {
        issueTypeId: fixture.storyType.id,
        fromStateId: origin!.id,
        toStateId: created.id,
        agentAllowed: false,
        handoff: false,
        workflowRevision: await workflowRevision(),
      });
      const refusedReferenced = await graphqlRefusal(
        request,
        DeleteWorkTrackerStateDocument,
        { id: created.id },
      );
      expect(refusedReferenced.message)
        .toContain("referenced by workflow configuration");
      await expect(header).toBeVisible();

      await graphql(request, RemoveWorkTrackerWorkflowStateDocument, {
        issueTypeId: fixture.storyType.id,
        stateId: created.id,
        workflowRevision: await workflowRevision(),
      });
      await graphql(request, DeleteWorkTrackerStateDocument, { id: created.id });
      removed = true;

      // The deletion fact evicts the row, so the section leaves the open tree
      // without a reload and does not come back on one.
      await expect(header).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("treeitem", { name: names.parent }))
        .toBeVisible();
      await expect(header).toHaveCount(0);
    } finally {
      if (!removed) {
        await graphql(request, DeleteWorkTrackerStateDocument, { id: created.id })
          .catch(() => undefined);
      }
    }
  });

  test("refuses creating a Story outside its published birth state", { tag: "@case-workflow-story-birth-state" }, async ({
    request,
  }) => {
    const startStateId = fixture.storyType.start_state as string | null;
    const elsewhere = fixture.states.find((state) => state.id !== startStateId);
    expect(elsewhere, "a state other than the Story start state").toBeTruthy();
    const phantom = "Complete illegal birth";

    const refused = await graphqlRefusal(
      request,
      CreateWorkTrackerWorkItemDocument,
      {
        projectId: fixture.project.id,
        name: phantom,
        issueTypeId: fixture.storyType.id,
        parentId: fixture.module.id,
        stateId: elsewhere!.id,
      },
    );
    expect(refused.message).toMatch(/born in/i);

    // A refused birth must not leave a row behind.
    const items = await getWorkItems(request, fixture.project.id);
    expect(items.map((item) => item.name)).not.toContain(phantom);
  });

  test("prunes a disposable workflow when its only reachable edge is deleted", { tag: "@case-workflow-prune-unreachable-edge" }, async ({
    page,
    request,
  }) => {
    const byName = (stateName: string) => {
      const state = fixture.states.find((row) => row.name === stateName);
      expect(state, `the seeded ${stateName} state`).toBeTruthy();
      return state!;
    };
    const ideas = byName("Ideas");
    const grill = byName("Grill");
    const spec = byName("Spec");
    const typeName = "E2E Pipeline";

    const pipeline = (await graphql(request, CreateWorkTrackerIssueTypeDocument, {
      projectId: fixture.project.id,
      name: typeName,
      level: "task",
      color: "#22C55E",
    })).create_issue_type;

    const workflow = async () => {
      const catalog = await getWorkflowCatalog(request, fixture.project.id);
      const row = catalog.issue_types.nodes.find((issueType) =>
        issueType.id === pipeline.id
      );
      expect(row, `the ${typeName} issue type`).toBeTruthy();
      return row!;
    };
    const edges = async (): Promise<string[]> => {
      const nameById = new Map(fixture.states.map((state) => [state.id, state.name]));
      return (await workflow()).transitions.nodes
        .map((edge) =>
          `${nameById.get(edge.from_state) ?? edge.from_state}->${
            nameById.get(edge.to_state) ?? edge.to_state
          }`
        )
        .sort();
    };
    const addEdge = async (from: string, to: string): Promise<void> => {
      await graphql(request, CreateWorkTrackerTransitionDocument, {
        issueTypeId: pipeline.id,
        fromStateId: from,
        toStateId: to,
        agentAllowed: false,
        handoff: false,
        workflowRevision: (await workflow()).workflow_revision,
      });
    };
    const born = (name: string) => createWorkItem(
      request,
      fixture.project.id,
      { name, issue_type_id: pipeline.id, parent_id: fixture.module.id },
    );
    const attemptMoveToGrill = async (): Promise<void> => {
      await page.getByRole("button", { name: "Open Settings" }).focus();
      await page.keyboard.press("s");
      const dialog = page.getByRole("dialog", { name: "Set Status" });
      await expect(dialog).toBeVisible();
      await dialog.getByText(grill.name, { exact: true }).click();
    };

    const items: WorkItemRow[] = [];
    try {
      await graphql(request, SetWorkTrackerStartStateDocument, {
        id: pipeline.id,
        startStateId: ideas.id,
        workflowRevision: (await workflow()).workflow_revision,
      });
      await addEdge(ideas.id, grill.id);
      await addEdge(grill.id, spec.id);
      expect(await edges()).toEqual(["Grill->Spec", "Ideas->Grill"]);

      const allowed = await born("Complete pipeline allowed move");
      items.push(allowed);
      await openModule(page, names.module);
      await openWorkItem(page, allowed.name);
      await expect(page.getByTestId("status-row")).toContainText(ideas.name);
      await attemptMoveToGrill();
      await expect(page.getByTestId("status-row")).toContainText(grill.name);

      // Deleting the only edge out of the start state leaves Grill->Spec
      // unreachable, so the publish prunes it rather than keeping an orphan.
      await graphql(request, DeleteWorkTrackerTransitionDocument, {
        issueTypeId: pipeline.id,
        fromStateId: ideas.id,
        toStateId: grill.id,
        workflowRevision: (await workflow()).workflow_revision,
      });
      expect(await edges()).toEqual([]);

      const refusedItem = await born("Complete pipeline refused move");
      items.push(refusedItem);
      await page.reload();
      await openWorkItem(page, refusedItem.name);
      await attemptMoveToGrill();
      await expect(page.getByTestId("toast-error")).toBeVisible();
      await expect(page.getByTestId("status-row")).toContainText(ideas.name);
      expect((await getWorkItem(request, refusedItem.id)).state_id).toBe(ideas.id);
    } finally {
      for (const item of items) {
        await graphql(request, DeleteWorkTrackerWorkItemDocument, { id: item.id })
          .catch(() => undefined);
      }
      await graphql(request, DeleteWorkTrackerIssueTypeDocument, { id: pipeline.id })
        .catch(() => undefined);
    }
  });

  test("persists the Story Grill policy through Rust", { tag: "@case-workflow-grill-policy" }, async ({
    page,
    request,
  }) => {
    let launchBindingWrites = 0;
    page.on("request", (request) => {
      if (
        request.url().endsWith("/graphql") &&
        request.postDataJSON()?.operationName ===
          "UpsertWorkTrackerLaunchBinding"
      ) {
        launchBindingWrites += 1;
      }
    });
    await openModule(page, names.module);
    await page.getByRole("treeitem", { name: new RegExp(fixture.parent.key) })
      .click();
    await expect(page.getByTestId("issue-name"))
      .toContainText(/Complete parent(?: renamed)?/);

    const openGrillPolicy = async (): Promise<Locator> => {
      await page.getByRole("button", { name: "Configure Grill state" }).click();
      const panel = page.getByRole("region", {
        name: "Grill state configuration",
      });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("heading", { name: "Grill" })).toBeVisible();
      await expect(panel.getByRole("tab", { name: "Story" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      return panel;
    };
    const closeGrillPolicy = async (panel: Locator): Promise<void> => {
      await panel.getByRole("button", {
        name: "Close Grill state configuration",
      }).click();
      await expect(panel).toHaveCount(0);
    };
    const waitForWorkflowWrite = () => page.waitForResponse((response) => {
      if (!response.url().endsWith("/graphql")) return false;
      const operation = response.request().postDataJSON()?.operationName;
      return [
        "UpsertWorkTrackerLaunchBinding",
        "UpdateWorkTrackerTransition",
        "SetWorkTrackerAutoStart",
        "SetWorkTrackerSubtreeRun",
      ].includes(operation);
    });
    const selectPersistedOption = async (
      field: Locator,
      value: string,
    ): Promise<void> => {
      if (await field.inputValue() === value) return;
      const saved = waitForWorkflowWrite();
      await field.selectOption(value);
      await saved;
      await expect(field).toHaveValue(value);
      await expect(page.getByText("Applying…")).toHaveCount(0);
    };
    const setPolicyCheckbox = async (
      checkbox: Locator,
      checked: boolean,
    ): Promise<void> => {
      if (await checkbox.isChecked() === checked) return;
      const saved = waitForWorkflowWrite();
      await checkbox.click();
      await saved;
      await expect(checkbox).toBeEnabled();
      await expect(checkbox).toBeChecked({ checked });
    };

    let panel = await openGrillPolicy();
    let prompt = panel.getByRole("textbox", { name: "Prompt" });
    let agentPermission = panel.getByRole("checkbox", {
      name: "Agents may move Grill to Spec",
    });
    let handoff = panel.getByRole("checkbox", {
      name: "Handoff Grill to Spec",
    });
    let autoStart = panel.getByRole("checkbox", { name: "Auto-start Grill" });
    let runSubtree = panel.getByRole("checkbox", { name: "Run subtree Grill" });
    let provider = panel.getByRole("combobox", { name: "Agent/provider" });
    let model = panel.getByRole("combobox", { name: "Model" });
    let reasoning = panel.getByRole("combobox", { name: "Reasoning" });
    const originalPrompt = await prompt.inputValue();
    const originalAgentPermission = await agentPermission.isChecked();
    const originalHandoff = await handoff.isChecked();
    const originalAutoStart = await autoStart.isChecked();
    const originalRunSubtree = await runSubtree.isChecked();
    const originalProvider = await provider.inputValue();
    const originalModel = await model.inputValue();
    const originalReasoning = await reasoning.inputValue();
    const changedPrompt = "Rust E2E Grill policy prompt.";

    let saved = waitForWorkflowWrite();
    await prompt.fill(changedPrompt);
    await prompt.blur();
    await saved;
    await expect(panel.getByText("Applying…")).toHaveCount(0);
    await setPolicyCheckbox(agentPermission, !originalAgentPermission);
    await setPolicyCheckbox(handoff, !originalHandoff);
    await setPolicyCheckbox(autoStart, !originalAutoStart);
    await setPolicyCheckbox(runSubtree, !originalRunSubtree);
    if (originalProvider === "codex") {
      await selectPersistedOption(provider, "");
    }
    await selectPersistedOption(provider, "codex");
    await selectPersistedOption(model, CODEX_TEST_MODEL);
    await selectPersistedOption(reasoning, CODEX_TEST_REASONING);
    await closeGrillPolicy(panel);

    await page.reload();
    panel = await openGrillPolicy();
    prompt = panel.getByRole("textbox", { name: "Prompt" });
    agentPermission = panel.getByRole("checkbox", {
      name: "Agents may move Grill to Spec",
    });
    handoff = panel.getByRole("checkbox", {
      name: "Handoff Grill to Spec",
    });
    autoStart = panel.getByRole("checkbox", { name: "Auto-start Grill" });
    runSubtree = panel.getByRole("checkbox", { name: "Run subtree Grill" });
    provider = panel.getByRole("combobox", { name: "Agent/provider" });
    model = panel.getByRole("combobox", { name: "Model" });
    reasoning = panel.getByRole("combobox", { name: "Reasoning" });
    await expect(prompt).toHaveValue(changedPrompt);
    await expect(agentPermission).toBeChecked({
      checked: !originalAgentPermission,
    });
    await expect(handoff).toBeChecked({ checked: !originalHandoff });
    await expect(autoStart).toBeChecked({ checked: !originalAutoStart });
    await expect(runSubtree).toBeChecked({ checked: !originalRunSubtree });
    await expect(provider).toHaveValue("codex");
    await expect(model).toHaveValue(CODEX_TEST_MODEL);
    await expect(reasoning).toHaveValue(CODEX_TEST_REASONING);

    // Model is now a catalog select, so the panel cannot hold an incompatible
    // model; the public launch-binding write refuses one instead.
    const writesBeforeRefusal = launchBindingWrites;
    await expect(model.locator('option[value="unsupported-e2e-model"]'))
      .toHaveCount(0);
    const grillState = fixture.states.find((state) => state.name === "Grill")!;
    const storyRevision = (await getWorkflowCatalog(request, fixture.project.id))
      .issue_types.nodes.find((type) => type.id === fixture.storyType.id)!
      .workflow_revision;
    const refusedModel = await graphqlRefusal(
      request,
      UpsertWorkTrackerLaunchBindingDocument,
      {
        issueTypeId: fixture.storyType.id,
        stateId: grillState.id,
        workflowRevision: storyRevision,
        prompt: changedPrompt,
        modelId: "unsupported-e2e-model",
        reasoningId: CODEX_TEST_REASONING,
      },
    );
    expect(refusedModel.message).toMatch(/model/i);
    expect(launchBindingWrites).toBe(writesBeforeRefusal);

    await page.reload();
    panel = await openGrillPolicy();
    prompt = panel.getByRole("textbox", { name: "Prompt" });
    agentPermission = panel.getByRole("checkbox", {
      name: "Agents may move Grill to Spec",
    });
    handoff = panel.getByRole("checkbox", {
      name: "Handoff Grill to Spec",
    });
    autoStart = panel.getByRole("checkbox", { name: "Auto-start Grill" });
    runSubtree = panel.getByRole("checkbox", { name: "Run subtree Grill" });
    provider = panel.getByRole("combobox", { name: "Agent/provider" });
    model = panel.getByRole("combobox", { name: "Model" });
    reasoning = panel.getByRole("combobox", { name: "Reasoning" });
    await expect(provider).toHaveValue("codex");
    await expect(model).toHaveValue(CODEX_TEST_MODEL);
    await expect(reasoning).toHaveValue(CODEX_TEST_REASONING);

    saved = waitForWorkflowWrite();
    await prompt.fill(originalPrompt);
    await prompt.blur();
    await saved;
    await expect(panel.getByText("Applying…")).toHaveCount(0);
    await setPolicyCheckbox(agentPermission, originalAgentPermission);
    await setPolicyCheckbox(handoff, originalHandoff);
    await setPolicyCheckbox(autoStart, originalAutoStart);
    await setPolicyCheckbox(runSubtree, originalRunSubtree);
    await selectPersistedOption(provider, originalProvider);
    if (originalProvider) {
      await selectPersistedOption(model, originalModel);
      await selectPersistedOption(reasoning, originalReasoning);
    }
    await closeGrillPolicy(panel);

    await page.reload();
    panel = await openGrillPolicy();
    await expect(panel.getByRole("textbox", { name: "Prompt" }))
      .toHaveValue(originalPrompt);
    await expect(panel.getByRole("checkbox", {
      name: "Agents may move Grill to Spec",
    })).toBeChecked({ checked: originalAgentPermission });
    await expect(panel.getByRole("checkbox", {
      name: "Handoff Grill to Spec",
    })).toBeChecked({ checked: originalHandoff });
    await expect(panel.getByRole("checkbox", { name: "Auto-start Grill" }))
      .toBeChecked({ checked: originalAutoStart });
    await expect(panel.getByRole("checkbox", { name: "Run subtree Grill" }))
      .toBeChecked({ checked: originalRunSubtree });
    await expect(panel.getByRole("combobox", { name: "Agent/provider" }))
      .toHaveValue(originalProvider);
    await expect(panel.getByRole("combobox", { name: "Model" }))
      .toHaveValue(originalModel);
    await expect(panel.getByRole("combobox", { name: "Reasoning" }))
      .toHaveValue(originalReasoning);

    await closeGrillPolicy(panel);
    await expect(page.getByTestId("issue-name"))
      .toContainText(/Complete parent(?: renamed)?/);
  });

  test("offers only task-level types in the type picker and keeps the type when dismissed", { tag: "@case-workflow-type-picker-choices" }, async ({
    page,
    request,
  }) => {
    const added = await disposableTaskType(request, "E2E Picker Type", seededState("Ideas").id);
    try {
      const catalog = await getWorkflowCatalog(request, fixture.project.id);
      const taskNames = catalog.issue_types.nodes
        .filter((issueType) => issueType.level === "task")
        .map((issueType) => issueType.name);
      const moduleNames = catalog.issue_types.nodes
        .filter((issueType) => issueType.level !== "task")
        .map((issueType) => issueType.name);
      expect(taskNames).toContain(added.name);
      expect(moduleNames.length).toBeGreaterThan(0);
      const typeWrites: string[] = [];
      page.on("request", (sent) => {
        const operation = sent.url().endsWith("/graphql")
          ? sent.postDataJSON()?.operationName as string | undefined
          : undefined;
        if (operation?.startsWith("UpdateWorkTrackerWorkItem")) typeWrites.push(operation);
      });

      await openModule(page, names.module);
      await openWorkItem(page, names.blocker);
      const picker = page.getByTestId("issue-type-picker");
      await picker.getByRole("button").first().click();
      const offered = (await picker.getByRole("button").allTextContents())
        .map((label) => label.trim());
      for (const name of taskNames) expect(offered).toContain(name);
      for (const name of moduleNames) expect(offered).not.toContain(name);

      await page.keyboard.press("Escape");
      await expect(picker.getByRole("button", { name: added.name })).toHaveCount(0);
      // Choosing the current type closes the picker without a write.
      await picker.getByRole("button").first().click();
      await picker.getByRole("button", { name: "Story", exact: true }).last().click();
      await expect(picker.getByRole("button", { name: added.name })).toHaveCount(0);
      expect(typeWrites).toEqual([]);
      await page.reload();
      await openWorkItem(page, names.blocker);
      expect((await getWorkItem(request, fixture.blocker.id)).issue_type_id)
        .toBe(fixture.storyType.id);
    } finally {
      await added.remove();
    }
  });

  test("shows a new unused state as an empty section with no workflow policy", { tag: "@case-workflow-unused-state" }, async ({
    page,
    request,
  }) => {
    const unusedName = "E2E Unused";
    const created = (await graphql(request, CreateWorkTrackerStateDocument, {
      projectId: fixture.project.id,
      name: unusedName,
      group: seededState("Ideas").group,
      color: "#64748B",
    })).create_state;
    const header = page.getByRole("button", { name: `Collapse ${unusedName}` });
    const expectEmptyPolicy = async () => {
      await page.getByRole("button", { name: `Configure ${unusedName} state`, exact: true }).click();
      const panel = page.getByRole("region", { name: `${unusedName} state configuration` });
      await expect(panel).toContainText("No workflow is available for this state.");
      await expect(panel.getByRole("tablist", { name: "Issue types" })).toHaveCount(0);
      await expect(panel.getByRole("textbox", { name: "Prompt" })).toHaveCount(0);
      await closeStatePolicy(page, unusedName);
    };
    try {
      await openModule(page, names.module);
      await openWorkItem(page, names.parent);
      await expect(header).toBeVisible();
      await expect(header).toHaveText(new RegExp(`${unusedName}\\s*0$`));
      await expectEmptyPolicy();
      await page.reload();
      await expect(header).toHaveText(new RegExp(`${unusedName}\\s*0$`));
      await expectEmptyPolicy();
      const catalog = await getWorkflowCatalog(request, fixture.project.id);
      for (const issueType of catalog.issue_types.nodes) {
        expect(issueType.start_state).not.toBe(created.id);
        expect(issueType.transitions.nodes.some((edge) =>
          edge.from_state === created.id || edge.to_state === created.id)).toBe(false);
      }
    } finally {
      await graphql(request, DeleteWorkTrackerStateDocument, { id: created.id })
        .catch(() => undefined);
    }
  });

  test("lists a state's incoming and outgoing edges per issue type and refuses a stale revision", { tag: "@case-workflow-transition-listing" }, async ({
    page,
    request,
  }) => {
    const ideas = seededState("Ideas");
    const grill = seededState("Grill");
    const listing = await disposableTaskType(request, "E2E Listing", ideas.id);
    try {
      await openModule(page, names.module);
      await openWorkItem(page, names.parent);
      let panel = await openStatePolicy(page, ideas.name, listing.name);
      await expect(panel.getByRole("region", { name: `${ideas.name} transitions` }))
        .toContainText("No transitions touch this state.");
      await closeStatePolicy(page, ideas.name);

      const revision = (await issueTypeNode(request, listing.id)).workflow_revision;
      const edge = {
        issueTypeId: listing.id,
        fromStateId: ideas.id,
        toStateId: grill.id,
        agentAllowed: false,
        handoff: false,
      };
      const stale = await graphqlRefusal(request, CreateWorkTrackerTransitionDocument, {
        ...edge,
        workflowRevision: revision - 1,
      });
      expect(stale.message).toBeTruthy();
      expect(await transition(request, listing.id, ideas.id, grill.id)).toBeUndefined();
      await graphql(request, CreateWorkTrackerTransitionDocument, {
        ...edge,
        workflowRevision: revision,
      });

      await page.reload();
      panel = await openStatePolicy(page, ideas.name, listing.name);
      const outgoing = panel.getByRole("listitem", { name: `Outgoing ${ideas.name} to ${grill.name}` });
      await expect(outgoing).toContainText("People only");
      await expect(outgoing.getByRole("checkbox", { name: `Handoff ${ideas.name} to ${grill.name}` }))
        .not.toBeChecked();
      await expect(panel.getByRole("region", { name: `${ideas.name} transitions` })
        .getByRole("listitem")).toHaveCount(1);
      await closeStatePolicy(page, ideas.name);

      panel = await openStatePolicy(page, grill.name, listing.name);
      await expect(panel.getByRole("listitem", { name: `Incoming ${ideas.name} to ${grill.name}` }))
        .toBeVisible();
      await expect(panel.getByRole("region", { name: `${grill.name} transitions` })
        .getByRole("listitem")).toHaveCount(1);
    } finally {
      await listing.remove();
    }
  });

  test("opens and closes a workflow edge to the Rust MCP agent from the state panel", { tag: "@case-workflow-agent-permission" }, async ({
    page,
    request,
  }) => {
    const ideas = seededState("Ideas");
    const grill = seededState("Grill");
    const permissionType = await disposableTaskType(request, "E2E Permission", ideas.id, [
      [ideas.id, grill.id],
      [grill.id, ideas.id],
    ]);
    const probe = await createWorkItem(request, fixture.project.id, {
      name: "Complete permission probe",
      issue_type_id: permissionType.id,
      parent_id: fixture.module.id,
    });
    const moveByAgent = (status: string) => callMcpTool<{ ok?: boolean; code?: string }>(
      "update_task_status",
      { project_id: fixture.project.id, task_id: probe.id, status_name: status },
    );
    const agentAllowed = async () =>
      (await transition(request, permissionType.id, ideas.id, grill.id))?.agent_allowed;
    const permissionLabel = `Agents may move ${ideas.name} to ${grill.name}`;
    try {
      expect(await moveByAgent(grill.name))
        .toMatchObject({ ok: false, code: "human_only_transition" });
      expect((await getWorkItem(request, probe.id)).state_id).toBe(ideas.id);

      await openModule(page, names.module);
      await openWorkItem(page, names.parent);
      let panel = await openStatePolicy(page, ideas.name, permissionType.name);
      const outgoing = panel.getByRole("listitem", { name: `Outgoing ${ideas.name} to ${grill.name}` });
      await expect(outgoing).toContainText("People only");
      let saved = workflowWrite(page, "UpdateWorkTrackerTransition");
      // The checkbox mirrors the authoritative edge, so it flips after the write.
      await outgoing.getByRole("checkbox", { name: permissionLabel }).click();
      await saved;
      await expect(outgoing.getByRole("checkbox", { name: permissionLabel })).toBeChecked();
      await expect(outgoing).toContainText("Agents + people");
      await expect.poll(agentAllowed).toBe(true);
      // Permission and handoff are separate edge flags.
      expect((await transition(request, permissionType.id, ideas.id, grill.id))?.handoff)
        .toBe(false);

      expect((await moveByAgent(grill.name)).ok).toBe(true);
      await expect.poll(async () => (await getWorkItem(request, probe.id)).state_id)
        .toBe(grill.id);
      // The reverse edge is still human-only.
      expect(await moveByAgent(ideas.name))
        .toMatchObject({ ok: false, code: "human_only_transition" });
      await closeStatePolicy(page, ideas.name);

      // The destination's panel shows the same edge as incoming and can close it.
      panel = await openStatePolicy(page, grill.name, permissionType.name);
      const incoming = panel.getByRole("listitem", { name: `Incoming ${ideas.name} to ${grill.name}` });
      await expect(incoming.getByRole("checkbox", { name: permissionLabel })).toBeChecked();
      saved = workflowWrite(page, "UpdateWorkTrackerTransition");
      await incoming.getByRole("checkbox", { name: permissionLabel }).click();
      await saved;
      await expect(incoming.getByRole("checkbox", { name: permissionLabel })).not.toBeChecked();
      await expect(incoming).toContainText("People only");
      await expect.poll(agentAllowed).toBe(false);

      await page.reload();
      panel = await openStatePolicy(page, grill.name, permissionType.name);
      await expect(panel.getByRole("checkbox", { name: permissionLabel })).not.toBeChecked();
    } finally {
      await graphql(request, DeleteWorkTrackerWorkItemDocument, { id: probe.id })
        .catch(() => undefined);
      await permissionType.remove();
    }
  });

  test("reloads the authoritative policy when a stale workflow revision is refused", { tag: "@case-workflow-revision-conflict" }, async ({
    page,
    request,
  }) => {
    const ideas = seededState("Ideas");
    const grill = seededState("Grill");
    const conflict = await disposableTaskType(request, "E2E Conflict", ideas.id, [[ideas.id, grill.id]]);
    try {
      await openModule(page, names.module);
      await openWorkItem(page, names.parent);
      const panel = await openStatePolicy(page, ideas.name, conflict.name);
      const permission = panel.getByRole("checkbox", { name: `Agents may move ${ideas.name} to ${grill.name}` });
      const handoff = panel.getByRole("checkbox", { name: `Handoff ${ideas.name} to ${grill.name}` });

      const hold = await holdGraphqlOperation(page, "UpdateWorkTrackerTransition");
      await permission.click();
      await hold.held;
      // Another writer publishes first, so the held write carries a stale revision.
      await graphql(request, UpdateWorkTrackerTransitionDocument, {
        issueTypeId: conflict.id,
        fromStateId: ideas.id,
        toStateId: grill.id,
        agentAllowed: false,
        handoff: true,
        workflowRevision: (await issueTypeNode(request, conflict.id)).workflow_revision,
      });
      await hold.release();

      await expect(panel).toContainText("Workflow changed elsewhere. Latest settings loaded.");
      await expect(handoff).toBeChecked();
      await expect(permission).not.toBeChecked();
      expect(await transition(request, conflict.id, ideas.id, grill.id))
        .toMatchObject({ agent_allowed: false, handoff: true });

      // A retry carries the refreshed revision and applies.
      const saved = workflowWrite(page, "UpdateWorkTrackerTransition");
      await permission.click();
      await saved;
      await expect(permission).toBeChecked();
      await expect(panel).not.toContainText("Workflow changed elsewhere.");
      expect(await transition(request, conflict.id, ideas.id, grill.id))
        .toMatchObject({ agent_allowed: true, handoff: true });
    } finally {
      await conflict.remove();
    }
  });

  test("applies and clears a Codex profile override on a stage", { tag: "@case-workflow-launch-profile" }, async ({
    page,
    request,
  }) => {
    const profile = "e2e-stage-profile";
    const grill = seededState("Grill");
    const catalog = await getProviderCatalog(request);
    await graphql(request, UpdateProviderCatalogDocument, {
      activatedProviders: catalog.configurable_providers
        .filter((provider) => provider.activated)
        .map((provider) => provider.slug),
      codexProfiles: [...catalog.codex_profiles, profile],
      defaultProvider: catalog.global_default?.provider ?? "codex",
      defaultModel: catalog.global_default?.model ?? null,
      defaultReasoning: catalog.global_default?.reasoning ?? null,
    });
    const storedProfile = async () =>
      (await launchBinding(request, fixture.storyType.id, grill.id))?.profile ?? null;

    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    let panel = await openStatePolicy(page, grill.name);
    const provider = panel.getByRole("combobox", { name: "Agent/provider" });
    if (await provider.inputValue() !== "codex") {
      const saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
      await provider.selectOption("codex");
      await saved;
    }
    let saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
    await panel.getByRole("combobox", { name: "Codex profile" }).selectOption(profile);
    await saved;
    await expect(panel.getByRole("combobox", { name: "Model" })).toBeDisabled();
    await expect(panel.getByRole("combobox", { name: "Reasoning" })).toBeDisabled();
    await expect.poll(storedProfile).toBe(profile);

    await page.reload();
    panel = await openStatePolicy(page, grill.name);
    await expect(panel.getByRole("combobox", { name: "Codex profile" })).toHaveValue(profile);
    saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
    await panel.getByRole("combobox", { name: "Codex profile" }).selectOption("");
    await saved;
    await expect(panel.getByRole("combobox", { name: "Model" })).toBeEnabled();
    await expect.poll(storedProfile).toBeNull();
  });

  test("requires a stage prompt before a launch binding or Auto-start can be saved", { tag: "@case-workflow-binding-prompt-guard" }, async ({
    page,
    request,
  }) => {
    const ideas = seededState("Ideas");
    const automation = await disposableTaskType(request, "E2E Automation", ideas.id);
    const prompt = "Automate the E2E stage.";
    try {
      const refused = await graphqlRefusal(request, SetWorkTrackerAutoStartDocument, {
        issueTypeId: automation.id,
        stateId: ideas.id,
        workflowRevision: (await issueTypeNode(request, automation.id)).workflow_revision,
        autoStart: true,
      });
      expect(refused.message).toContain("non-empty prompt");

      await openModule(page, names.module);
      await openWorkItem(page, names.parent);
      let panel = await openStatePolicy(page, ideas.name, automation.name);
      const autoStart = panel.getByRole("checkbox", { name: `Auto-start ${ideas.name}` });
      await expect(panel.getByRole("textbox", { name: "Prompt" })).toHaveValue("");
      await expect(autoStart).not.toBeChecked();
      await expect(autoStart).toBeDisabled();

      // A provider choice alone cannot create a prompt-less binding.
      let saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
      await panel.getByRole("combobox", { name: "Agent/provider" }).selectOption("codex");
      await saved;
      await expect(panel).toContainText("A launch binding must have a non-empty prompt.");
      expect(await launchBinding(request, automation.id, ideas.id)).toBeUndefined();

      saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
      await panel.getByRole("textbox", { name: "Prompt" }).fill(prompt);
      await panel.getByRole("textbox", { name: "Prompt" }).blur();
      await saved;
      await expect(panel).not.toContainText("A launch binding must have a non-empty prompt.");
      await expect(autoStart).toBeEnabled();
      saved = workflowWrite(page, "SetWorkTrackerAutoStart");
      await autoStart.click();
      await saved;
      await expect(autoStart).toBeChecked();
      await expect.poll(async () => (await launchBinding(request, automation.id, ideas.id))?.auto_start)
        .toBe(true);
      expect((await launchBinding(request, automation.id, ideas.id))?.prompt).toBe(prompt);

      await page.reload();
      panel = await openStatePolicy(page, ideas.name, automation.name);
      await expect(panel.getByRole("checkbox", { name: `Auto-start ${ideas.name}` })).toBeChecked();
      await expect(panel.getByRole("textbox", { name: "Prompt" })).toHaveValue(prompt);
    } finally {
      await automation.remove();
    }
  });

  test("refuses automation on a stage whose provider is not activated", { tag: "@case-workflow-automation-provider-guard" }, async ({
    page,
    request,
  }) => {
    const grill = seededState("Grill");
    const catalog = await getProviderCatalog(request);
    const gemini = catalog.configurable_providers.find((provider) => provider.slug === "gemini");
    expect(gemini, "the configurable gemini provider").toBeTruthy();
    expect(gemini!.activated, "gemini starts deactivated in the onboarded profile").toBe(false);
    const geminiModel = catalog.agent_models.find((model) => model.provider === gemini!.id);
    expect(geminiModel, "a gemini catalog model").toBeTruthy();
    const before = await launchBinding(request, fixture.storyType.id, grill.id);
    expect(before?.prompt, "the seeded Grill prompt").toBeTruthy();

    const refused = await graphqlRefusal(request, UpsertWorkTrackerLaunchBindingDocument, {
      issueTypeId: fixture.storyType.id,
      stateId: grill.id,
      workflowRevision: (await issueTypeNode(request, fixture.storyType.id)).workflow_revision,
      prompt: before!.prompt,
      modelId: geminiModel!.name,
      autoStart: true,
    });
    expect(refused.message).toContain("must be activated");
    expect(await launchBinding(request, fixture.storyType.id, grill.id)).toEqual(before);

    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    const panel = await openStatePolicy(page, grill.name);
    await expect(panel.getByRole("checkbox", { name: `Auto-start ${grill.name}` }))
      .toBeChecked({ checked: before!.auto_start });
    await expect(panel.getByRole("combobox", { name: "Agent/provider" }).locator('option[value="gemini"]'))
      .toHaveCount(0);
  });

  test("adds, deduplicates, removes and empties stage skills and retries a failed save", { tag: "@case-workflow-stage-skills" }, async ({
    page,
    request,
  }) => {
    const grill = seededState("Grill");
    const binding = () => launchBinding(request, fixture.storyType.id, grill.id);
    const original = await binding();
    expect(original, "the seeded Grill launch binding").toBeTruthy();
    const requiredSkills = original!.required_skills;
    const stageSkills = async () => (await binding())?.stage_skills;

    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    let panel = await openStatePolicy(page, grill.name);
    const input = panel.getByRole("textbox", { name: "Skills", exact: true });
    const chips = panel.getByRole("list", { name: "Selected skills" }).getByRole("listitem");
    const addOnEnter = async (name: string) => {
      const saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
      await input.fill(name);
      await input.press("Enter");
      await saved;
    };
    for (const skill of original!.stage_skills) {
      const saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
      await panel.getByRole("button", { name: `Remove skill "${skill}"` }).click();
      await saved;
    }
    await expect(chips).toHaveCount(0);
    await expect.poll(stageSkills).toEqual([]);

    await addOnEnter("e2e-stage-alpha");
    // A blurred draft commits too, and a comma stays part of one name.
    let saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
    await input.fill("  e2e, comma skill  ");
    await input.blur();
    await saved;
    await expect.poll(stageSkills).toEqual(["e2e-stage-alpha", "e2e, comma skill"]);
    // Blank and exact-duplicate drafts are ignored without a write.
    let writes = 0;
    const countWrites = (sent: { url(): string; postDataJSON(): { operationName?: string } | null }) => {
      if (sent.url().endsWith("/graphql")
        && sent.postDataJSON()?.operationName === "UpsertWorkTrackerLaunchBinding") writes += 1;
    };
    page.on("request", countWrites);
    await input.fill("   ");
    await input.press("Enter");
    await input.fill("e2e-stage-alpha");
    await input.press("Enter");
    await input.fill("");
    await expect(chips).toHaveCount(2);
    expect(writes).toBe(0);
    page.off("request", countWrites);

    saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
    await panel.getByRole("button", { name: 'Remove skill "e2e-stage-alpha"' }).click();
    await saved;
    await expect.poll(stageSkills).toEqual(["e2e, comma skill"]);
    expect((await binding())?.required_skills).toEqual(requiredSkills);

    const release = await failGraphqlOperation(page, "UpsertWorkTrackerLaunchBinding");
    await input.fill("e2e-stage-failed");
    await input.press("Enter");
    await expect(panel.getByText(/failed to fetch|network|could not/i)).toBeVisible();
    expect(await stageSkills()).toEqual(["e2e, comma skill"]);
    await release();
    await addOnEnter("e2e-stage-retry");
    await expect.poll(stageSkills)
      .toEqual(["e2e, comma skill", "e2e-stage-failed", "e2e-stage-retry"]);

    await page.reload();
    panel = await openStatePolicy(page, grill.name);
    await expect(panel.getByRole("list", { name: "Selected skills" }).getByRole("listitem"))
      .toHaveText([/^e2e, comma skill/, /^e2e-stage-failed/, /^e2e-stage-retry/]);
    for (const skill of ["e2e, comma skill", "e2e-stage-failed", "e2e-stage-retry"]) {
      saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
      await panel.getByRole("button", { name: `Remove skill "${skill}"` }).click();
      await saved;
    }
    await expect.poll(stageSkills).toEqual([]);
    expect((await binding())?.required_skills).toEqual(requiredSkills);
    await page.reload();
    panel = await openStatePolicy(page, grill.name);
    await expect(panel.getByRole("list", { name: "Selected skills" }).getByRole("listitem"))
      .toHaveCount(0);
    await expect(panel.getByRole("status", { name: "Skill availability" })).toHaveCount(0);
  });

  test("shows each stage skill's availability for the stage provider and rechecks without writing", { tag: "@case-workflow-skill-availability" }, async ({
    page,
    request,
  }) => {
    const grill = seededState("Grill");
    const codexRoot = `${fixture.folder}/.agents/skills`;
    await installSkill(codexRoot, "e2e-visible-skill");
    await installSkill(codexRoot, "e2e-case-skill");
    const stageSkills = async () =>
      (await launchBinding(request, fixture.storyType.id, grill.id))?.stage_skills;

    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    let panel = await openStatePolicy(page, grill.name);
    const provider = panel.getByRole("combobox", { name: "Agent/provider" });
    if (await provider.inputValue() !== "codex") {
      const saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
      await provider.selectOption("codex");
      await saved;
    }
    const input = panel.getByRole("textbox", { name: "Skills", exact: true });
    const chip = (name: string) => panel.getByRole("listitem", { name: `Skill ${name}`, exact: true });
    const status = panel.getByRole("status", { name: "Skill availability" });
    const add = async (name: string) => {
      const saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
      await input.fill(name);
      await input.press("Enter");
      await saved;
    };
    for (const skill of (await stageSkills()) ?? []) {
      const saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
      await panel.getByRole("button", { name: `Remove skill "${skill}"` }).click();
      await saved;
    }

    await add("e2e-visible-skill");
    await expect(chip("e2e-visible-skill")).toContainText("Available to codex");
    await expect(status).toHaveText("All skills are available to codex in the searched locations.");
    await add("E2E-Case-Skill");
    await expect(chip("E2E-Case-Skill")).toContainText("Available to codex as e2e-case-skill");
    await add("e2e-missing-skill");
    await expect(chip("e2e-missing-skill")).toContainText("Missing for codex");
    await expect(status).toContainText("codex cannot see e2e-missing-skill.");
    await expect(status).toContainText(codexRoot);
    await expect(status).toContainText("Saving is still allowed");
    // The missing name was saved, and this edit stored the installed spelling.
    await expect.poll(stageSkills)
      .toEqual(["e2e-visible-skill", "e2e-case-skill", "e2e-missing-skill"]);

    let writes = 0;
    page.on("request", (sent) => {
      if (sent.url().endsWith("/graphql")
        && sent.postDataJSON()?.operationName === "UpsertWorkTrackerLaunchBinding") writes += 1;
    });
    await installSkill(codexRoot, "e2e-missing-skill");
    await panel.getByRole("button", { name: "Recheck skills" }).click();
    await expect(chip("e2e-missing-skill")).toContainText("Available to codex");
    await expect(status).toHaveText("All skills are available to codex in the searched locations.");

    const release = await failGraphqlOperation(page, "LaunchSkillAvailability");
    await panel.getByRole("button", { name: "Recheck skills" }).click();
    await expect(chip("e2e-visible-skill")).toContainText("Not verified");
    await expect(status).toContainText("Skill availability not verified.");
    await release();
    await panel.getByRole("button", { name: "Recheck skills" }).click();
    await expect(chip("e2e-visible-skill")).toContainText("Available to codex");
    expect(writes).toBe(0);

    // Switching the stage provider checks that provider's roots instead.
    if ((await provider.locator('option[value="claude"]').count()) > 0) {
      const saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
      await provider.selectOption("claude");
      await saved;
      await expect(chip("e2e-visible-skill")).toContainText("Missing for claude");
      await page.reload();
      panel = await openStatePolicy(page, grill.name);
      await expect(panel.getByRole("listitem", { name: "Skill e2e-visible-skill", exact: true }))
        .toContainText("Missing for claude");
    } else {
      await page.reload();
      panel = await openStatePolicy(page, grill.name);
      await expect(panel.getByRole("listitem", { name: "Skill e2e-visible-skill", exact: true }))
        .toContainText("Available to codex");
    }
  });

  test("warns about a missing required skill but refuses one outside the pinned catalog", { tag: "@case-workflow-required-skills" }, async ({
    page,
    request,
  }) => {
    const grill = seededState("Grill");
    const binding = () => launchBinding(request, fixture.storyType.id, grill.id);
    const original = await binding();
    expect(original, "the seeded Grill launch binding").toBeTruthy();
    const stageSkills = original!.stage_skills;
    const requiredSkills = async () => (await binding())?.required_skills;
    const outside = "e2e-unlisted-required";
    await installSkill(`${fixture.folder}/.agents/skills`, outside);

    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    let panel = await openStatePolicy(page, grill.name);
    const input = panel.getByRole("textbox", { name: "Required skills", exact: true });
    const chips = panel.getByRole("list", { name: "Selected required skills" }).getByRole("listitem");
    for (const skill of original!.required_skills as string[]) {
      const saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
      await panel.getByRole("button", { name: `Remove required skill "${skill}"` }).click();
      await saved;
    }
    await expect(chips).toHaveCount(0);
    await expect.poll(requiredSkills).toEqual([]);

    // An allowed name saves even when the provider cannot see it.
    let saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
    await input.fill("grill-with-docs");
    await input.press("Enter");
    await saved;
    await expect.poll(requiredSkills).toEqual(["grill-with-docs"]);
    const requiredChip = panel.getByRole("listitem", { name: "Required skill grill-with-docs" });
    await expect(requiredChip).toContainText(/Available to \w+|Missing for \w+/);
    await expect(panel.getByRole("status", { name: "Required skill availability" }))
      .toBeVisible();

    // A disk-visible name outside the pinned catalog is refused.
    saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
    await input.fill(outside);
    await input.press("Enter");
    await saved;
    await expect(panel).toContainText(`Required skill '${outside}' is not in the pinned upstream snapshot.`);
    await expect(panel.getByRole("listitem", { name: `Required skill ${outside}` }))
      .toContainText("Available to");
    expect(await requiredSkills()).toEqual(["grill-with-docs"]);
    expect((await binding())?.stage_skills).toEqual(stageSkills);

    await page.reload();
    panel = await openStatePolicy(page, grill.name);
    await expect(panel.getByRole("list", { name: "Selected required skills" }).getByRole("listitem"))
      .toHaveText([/^grill-with-docs/]);
    saved = workflowWrite(page, "UpsertWorkTrackerLaunchBinding");
    await panel.getByRole("button", { name: 'Remove required skill "grill-with-docs"' }).click();
    await saved;
    await expect.poll(requiredSkills).toEqual([]);
    expect((await binding())?.stage_skills).toEqual(stageSkills);
  });

  test("explains the selected Story's configured stages without starting work", { tag: "@case-workflow-story-guide" }, async ({
    page,
    request,
  }) => {
    const story = await issueTypeNode(request, fixture.storyType.id);
    const start = fixture.states.find((state) => state.id === story.start_state)!;
    const destinations = story.transitions.nodes
      .filter((edge) => edge.from_state === start.id)
      .map((edge) => fixture.states.find((state) => state.id === edge.to_state)!.name);
    expect(destinations.length).toBeGreaterThan(0);
    const mutations: string[] = [];
    page.on("request", (sent) => {
      if (!sent.url().endsWith("/graphql")) return;
      const body = sent.postDataJSON() as { operationName?: string; query?: string } | null;
      if (body?.query?.trimStart().startsWith("mutation")) mutations.push(body.operationName ?? "");
    });

    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    expect((await getWorkItem(request, fixture.parent.id)).state_id).toBe(start.id);
    const trigger = page.getByRole("button", { name: "Story workflow guide", exact: true });
    const guide = page.getByRole("dialog", { name: "Story workflow guide", exact: true });
    const before = mutations.length;

    const release = await failGraphqlOperation(page, "WorkTrackerProjectOpen");
    await trigger.click();
    await expect(guide).toBeVisible();
    await expect(guide).toContainText(`For Story: ${names.parent}`);
    await expect(guide.getByRole("alert")).toContainText("Workflow configuration could not load.");
    await release();
    await guide.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(guide.getByRole("alert")).toHaveCount(0);
    const current = guide.locator(`li[data-state-id="${start.id}"]`);
    await expect(current).toContainText("Current state");
    await expect(current).toContainText(`Next: ${destinations.join(", ")}.`);
    await expect(guide.getByText("No outgoing transitions configured.").first()).toBeVisible();
    await expect(guide).toContainText("This guide does not start work.");
    await guide.getByRole("button", { name: "Close", exact: true }).click();
    await expect(guide).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(guide).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(guide).toHaveCount(0);
    await trigger.click();
    await guide.getByRole("button", { name: "Close dialog" }).click();
    await expect(guide).toHaveCount(0);
    expect(mutations.slice(before)).toEqual([]);
    expect((await getWorkItem(request, fixture.parent.id)).state_id).toBe(start.id);
  });

  /**
   * Field validation and guard refusals on the work-management writes.
   *
   * Every call here is refused, so the block has no side effects and needs no
   * cleanup: it asserts the shape of a rejection, which is the half of the write
   * contract the happy-path tests never reach.
   */
  test.describe("work-management write guards", () => {
    let project: ProjectRow;
    let stateIds: string[];
    let stateNames: Map<string, string>;
    let issueTypeIds: string[];

    test.beforeAll(async ({ request }) => {
      const seeded = (await getProjects(request)).find((row) => row.slug === "CDN");
      expect(seeded, "the seeded CDN project").toBeTruthy();
      project = seeded!;
      const catalog = await getWorkflowCatalog(request, project.id);
      stateIds = catalog.states.nodes.map((state) => state.id);
      stateNames = new Map(catalog.states.nodes.map((s) => [s.id, s.name]));
      issueTypeIds = catalog.issue_types.nodes.map((issueType) => issueType.id);
      expect(stateIds.length).toBeGreaterThan(1);
      expect(issueTypeIds.length).toBeGreaterThan(1);
    });

    test("refuses a blank or oversized State name", { tag: "@case-workflow-state-name-guard" }, async ({ request }) => {
      const blank = await graphqlRefusal(request, CreateWorkTrackerStateDocument, {
        projectId: project.id,
        name: "   ",
        group: "backlog",
        color: "#111111",
      });
      expect(blank.message).toContain("may not be blank");
      expect(blank.extensions?.field).toBe("name");

      const oversized = await graphqlRefusal(request, CreateWorkTrackerStateDocument, {
        projectId: project.id,
        name: "E".repeat(256),
        group: "backlog",
        color: "#111111",
      });
      expect(oversized.message).toContain("no more than 255");
      expect(oversized.extensions?.field).toBe("name");
    });

    test("refuses a State group outside the published set", { tag: "@case-workflow-state-group-guard" }, async ({
      request,
    }) => {
      const created = await graphqlRefusal(request, CreateWorkTrackerStateDocument, {
        projectId: project.id,
        name: "E2E Rejected Group",
        group: "in_progress",
        color: "#111111",
      });
      expect(created.message).toContain("Unknown group 'in_progress'");

      const updated = await graphqlRefusal(request, UpdateWorkTrackerStateDocument, {
        id: stateIds[0]!,
        group: "someday",
      });
      expect(updated.message).toContain("Unknown group 'someday'");
    });

    test("refuses a State reorder that is not the project's exact set", { tag: "@case-workflow-state-reorder-guard" }, async ({
      request,
    }) => {
      // A short set would silently drop rows, so completeness is required.
      const short = await graphqlRefusal(request, ReorderWorkTrackerStatesDocument, {
        projectId: project.id,
        orderedIds: stateIds.slice(0, stateIds.length - 1),
      });
      expect(short.message).toContain("exactly this project's rows");

      // A repeated identity would leave one row unranked.
      const duplicated = await graphqlRefusal(request, ReorderWorkTrackerStatesDocument, {
        projectId: project.id,
        orderedIds: [stateIds[0]!, ...stateIds.slice(0, stateIds.length - 1)],
      });
      expect(duplicated.message).toContain("exactly this project's rows");

      // A foreign identity must not be rankable into this project.
      const foreign = await graphqlRefusal(request, ReorderWorkTrackerStatesDocument, {
        projectId: project.id,
        orderedIds: [...stateIds.slice(1), issueTypeIds[0]!],
      });
      expect(foreign.message).toContain("exactly this project's rows");

      // The ordering the refusals were measured against is untouched.
      const catalog = await getWorkflowCatalog(request, project.id);
      expect(
        [...catalog.states.nodes]
          .sort((left, right) => left.sort_order - right.sort_order)
          .map((state) => state.name),
      ).toEqual(stateIds.map((id) => stateNames.get(id)));
    });

    test("refuses an IssueType reorder that is not the project's exact set", { tag: "@case-workflow-issue-type-reorder-guard" }, async ({
      request,
    }) => {
      const short = await graphqlRefusal(request, ReorderWorkTrackerIssueTypesDocument, {
        projectId: project.id,
        orderedIds: issueTypeIds.slice(0, issueTypeIds.length - 1),
      });
      expect(short.message).toContain("exactly this project's rows");

      const foreign = await graphqlRefusal(request, ReorderWorkTrackerIssueTypesDocument, {
        projectId: project.id,
        orderedIds: [...issueTypeIds.slice(1), stateIds[0]!],
      });
      expect(foreign.message).toContain("exactly this project's rows");
    });

    test("reports a missing identity rather than succeeding silently", { tag: "@case-workflow-missing-identity-guard" }, async ({
      request,
    }) => {
      const absent = "00000000-0000-4000-8000-000000000000";
      const state = await graphqlRefusal(request, DeleteWorkTrackerStateDocument, {
        id: absent,
      });
      expect(state.message).toContain("not found");

      const update = await graphqlRefusal(request, UpdateWorkTrackerStateDocument, {
        id: absent,
        name: "E2E Absent",
      });
      expect(update.message).toContain("not found");
    });
  });
});

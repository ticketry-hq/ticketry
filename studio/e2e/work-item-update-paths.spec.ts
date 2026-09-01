import { expect, test } from "@playwright/test";
import {
  DeleteWorkTrackerWorkItemDocument,
  UpdateWorkTrackerWorkItemDocument,
} from "../src/features/work-items/generated/workItems.documents";
import {
  createWorkItem,
  getProjects,
  getWorkflowCatalog,
  getWorkItem,
  getWorkItems,
  graphql,
  graphqlRefusal,
  type ProjectRow,
  type WorkItemRow,
} from "./support";

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
  test("refuses a details field mixed with a domain patch", async ({
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

  test("refuses two domain patches in one update", async ({ request }) => {
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

  test("cascades an archive through the whole subtree", async ({ request }) => {
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
        UpdateWorkTrackerWorkItemDocument,
        { id: parent.id, isArchived: true },
      )).update_work_item;
      expect(archived.is_archived).toBe(true);

      // Archiving is a subtree operation: every descendant leaves with it.
      for (const row of [parent, child, grandchild]) {
        expect((await getWorkItem(request, row.id)).is_archived, row.name)
          .toBe(true);
      }
      // The module above the archived parent is untouched.
      expect((await getWorkItem(request, module.id)).is_archived).toBe(false);

      // Archiving is one-way through this patch, by contract.
      const restore = await graphqlRefusal(
        request,
        UpdateWorkTrackerWorkItemDocument,
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

  test("archiving an already archived item is not an error", async ({
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
          UpdateWorkTrackerWorkItemDocument,
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

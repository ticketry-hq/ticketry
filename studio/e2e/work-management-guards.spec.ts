import { expect, test } from "@playwright/test";
import {
  CreateWorkTrackerStateDocument,
  DeleteWorkTrackerStateDocument,
  ReorderWorkTrackerIssueTypesDocument,
  ReorderWorkTrackerStatesDocument,
  UpdateWorkTrackerStateDocument,
} from "../src/features/workflows/generated/workflows.documents";
import { CreateWorkTrackerWorkItemDocument } from "../src/features/work-items/generated/workItems.documents";
import {
  getProjects,
  getWorkflowCatalog,
  graphqlRefusal,
  type ProjectRow,
} from "./support";

/**
 * Field validation and guard refusals on the work-management writes.
 *
 * Every call here is refused, so the spec has no side effects and needs no
 * cleanup: it asserts the shape of a rejection, which is the half of the write
 * contract the happy-path tests never reach.
 */
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

test.describe("work-management write guards", () => {
  test("refuses a blank or oversized State name", async ({ request }) => {
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

  test("refuses a State group outside the published set", async ({
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

  test("refuses a State reorder that is not the project's exact set", async ({
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

  test("refuses an IssueType reorder that is not the project's exact set", async ({
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

  test("refuses a blank or oversized work item name", async ({ request }) => {
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

  test("reports a missing identity rather than succeeding silently", async ({
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

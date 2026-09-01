import { expect, test } from "@playwright/test";
import {
  CreateWorkTrackerProjectDocument,
  DeleteWorkTrackerProjectDocument,
} from "../src/features/projects/generated/projects.documents";
import {
  createProject,
  createWorkItem,
  getProjects,
  getWorkflowCatalog,
  graphql,
  graphqlRefusal,
} from "./support";

/**
 * Project create and delete, asserted through the public mutations.
 *
 * Creation provisions a reviewed catalogue the caller never asks for, and
 * deletion is supposed to take the whole aggregate with it. Neither effect is
 * visible from the mutation shape, so both are asserted here rather than left
 * to the schema contract spec.
 *
 * These tests leave their projects behind: `delete_project` does not currently
 * work (see the expected-failure test below), so no public operation can clean
 * them up. That is safe — Studio resolves its project by the `CDN` key rather
 * than by position, and the suite runs against a throwaway SQLite profile.
 */
const REVIEWED_STATES = [
  ["Ideas", "backlog"],
  ["Grill", "backlog"],
  ["Spec", "unstarted"],
  ["Tickets", "unstarted"],
  ["Implement", "started"],
  ["Review", "started"],
  ["Done", "completed"],
  ["Cancelled", "cancelled"],
];

test.describe("project lifecycle", () => {
  test("provisions the reviewed catalogue when a project is created", async ({
    request,
  }) => {
    // A project key is exactly three letters, and a lowercase one is
    // uppercased on the way in rather than refused.
    const project = await createProject(request, {
      name: "E2E Provisioned",
      slug: "elc",
      description: "Created by the project lifecycle spec.",
    });
    expect(project.slug).toBe("ELC");

    const catalog = await getWorkflowCatalog(request, project.id);
    expect(
      [...catalog.states.nodes]
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((state) => [state.name, state.group]),
    ).toEqual(REVIEWED_STATES);

    const typeNames = catalog.issue_types.nodes.map((type) => type.name);
    expect(typeNames).toContain("Story");
    expect(typeNames).toContain("Implementation");
    const moduleType = catalog.issue_types.nodes
      .find((type) => type.level === "module");
    expect(moduleType, "a module-level issue type").toBeTruthy();

    // Every published type carries a start state, so its items can be born.
    for (const issueType of catalog.issue_types.nodes) {
      expect(issueType.start_state, `${issueType.name} start state`)
        .toBeTruthy();
    }

    // The new project's catalogue is its own, not shared with the seeded one.
    const seeded = (await getProjects(request)).find((row) => row.slug === "CDN");
    expect(seeded, "the seeded CDN project").toBeTruthy();
    const seededCatalog = await getWorkflowCatalog(request, seeded!.id);
    const seededStateIds = new Set(
      seededCatalog.states.nodes.map((state) => state.id),
    );
    for (const state of catalog.states.nodes) {
      expect(seededStateIds.has(state.id), "states must not be shared")
        .toBe(false);
    }
  });

  /**
   * `delete_project` is currently broken for every project, including an empty
   * one: it clears the project's issues and then deletes the project row, but
   * the provisioned catalogue still references it, so the write is refused with
   * `worktracker_storage_failed`. The assertions below are what deletion should
   * do. When the cascade is fixed this test starts passing, Playwright reports
   * the stale `fail` annotation, and the annotation should then be removed.
   */
  test("deletes a project and cascades its whole aggregate", async ({
    request,
  }) => {
    test.fail();
    const project = await createProject(request, {
      name: "E2E Cascade",
      slug: "eld",
      description: "Created by the project lifecycle spec.",
    });
    const catalog = await getWorkflowCatalog(request, project.id);
    const moduleType = catalog.issue_types.nodes
      .find((type) => type.level === "module");
    const module = await createWorkItem(request, project.id, {
      name: "Cascade Module",
      issue_type_id: moduleType!.id,
    });
    expect(module.id).toBeTruthy();

    await graphql(request, DeleteWorkTrackerProjectDocument, { id: project.id });

    expect((await getProjects(request)).map((row) => row.slug))
      .not.toContain("ELD");
    const remains = await getWorkflowCatalog(request, project.id);
    expect(remains.project.nodes).toEqual([]);
    expect(remains.states.nodes).toEqual([]);
    expect(remains.issue_types.nodes).toEqual([]);
    expect(remains.modules.nodes).toEqual([]);
  });

  test("refuses a project key that is not exactly three letters", async ({
    request,
  }) => {
    for (const slug of ["TOOLONG", "AB", "A1C", "A-C"]) {
      const refused = await graphqlRefusal(
        request,
        CreateWorkTrackerProjectDocument,
        { name: `E2E Reject ${slug}`, slug, description: "" },
      );
      expect(refused.message, `slug ${slug}`).toContain("three letters");
      expect(refused.extensions?.field, `slug ${slug}`).toBe("slug");
    }
    // A refused key must not leave a project behind.
    expect((await getProjects(request)).map((project) => project.name))
      .not.toContain("E2E Reject AB");
  });
});

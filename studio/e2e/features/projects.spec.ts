import { expect, test } from "@playwright/test";
import { resolveEdition } from "../../scripts/edition-build-policy.mjs";
import { featureSuite } from "./featureSuite";
import {
  CreateWorkTrackerProjectDocument,
  DeleteWorkTrackerProjectDocument,
  UpdateWorkTrackerProjectDocument,
} from "../../src/features/projects/generated/projects.documents";
import {
  createProject,
  createWorkItem,
  getProjects,
  getWorkflowCatalog,
  graphql,
  graphqlRefusal,
} from "../support";

/**
 * Project create and delete, asserted through the public mutations.
 *
 * Creation provisions a reviewed catalogue the caller never asks for, and
 * deletion is supposed to take the whole aggregate with it. Neither effect is
 * visible from the mutation shape, so both are asserted here rather than left
 * to the schema contract spec.
 *
 * These tests leave their projects behind: `delete_project` does not currently
 * work (the migrated cascade case reports a genuine failure), so no public operation can clean
 * them up. That is safe — Studio resolves its project by the `CDN` key rather
 * than by position, and the suite runs against a throwaway SQLite profile.
 */
/** The run's compiled edition; only Pocock seeds the reviewed catalogue. */
const reviewedWorkflowDefaults = resolveEdition().edition === "pocock";

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

featureSuite("projects", () => {
  test("provisions its edition's catalogue when a project is created", { tag: "@case-projects-provision-catalogue" }, async ({
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
    if (!reviewedWorkflowDefaults) {
      // CODING-2860: core seeds an empty workflow slate — only the
      // structural Module type, with no start state.
      expect(catalog.states.nodes).toEqual([]);
      expect(catalog.issue_types.nodes.map((type) => [type.name, type.level, type.start_state ?? null, type.transitions.nodes.length, type.launch_bindings.nodes.length]))
        .toEqual([["Module", "module", null, 0, 0]]);
      return;
    }
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

    const stateName = (id: string) => catalog.states.nodes.find((row) => row.id === id)!.name;
    const implementation = catalog.issue_types.nodes.find((row) => row.name === "Implementation")!;
    expect(stateName(implementation.start_state!)).toBe("Implement");
    expect(implementation.transitions.nodes.map((edge) => [stateName(edge.from_state), stateName(edge.to_state), edge.agent_allowed]).sort()).toEqual([
      ["Implement", "Cancelled", true], ["Implement", "Review", true],
      ["Review", "Cancelled", true], ["Review", "Done", true], ["Review", "Implement", true],
    ]);
    expect(implementation.launch_bindings.nodes.map((binding) => stateName(binding.state)).sort()).toEqual(["Cancelled", "Done", "Implement", "Review"]);
    const story = catalog.issue_types.nodes.find((row) => row.name === "Story")!;
    expect(stateName(story.start_state!)).toBe("Ideas");
    expect(story.launch_bindings.nodes.map((binding) => stateName(binding.state)).sort()).toEqual(["Cancelled", "Done", "Grill", "Ideas", "Implement", "Review", "Spec", "Tickets"]);
    const kickoff = story.transitions.nodes.find((edge) => stateName(edge.from_state) === "Tickets" && stateName(edge.to_state) === "Implement")!;
    expect(kickoff.agent_allowed, "Story kickoff stays human-gated").toBe(false);
    for (const issueType of catalog.issue_types.nodes) {
      for (const edge of issueType.transitions.nodes) {
        expect(edge.issue_type).toBe(issueType.id);
        expect(catalog.states.nodes.some((state) => state.id === edge.from_state)).toBe(true);
        expect(catalog.states.nodes.some((state) => state.id === edge.to_state)).toBe(true);
      }
      for (const binding of issueType.launch_bindings.nodes) {
        expect(binding.issue_type).toBe(issueType.id);
        expect(catalog.states.nodes.some((state) => state.id === binding.state)).toBe(true);
      }
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

  // Retain the legacy cascade assertions; a defect must remain a real failure.
  test("deletes a project and cascades its whole aggregate", { tag: "@case-projects-delete-aggregate" }, async ({
    request,
  }) => {
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

  test("refuses a project key that is not exactly three letters", { tag: "@case-projects-invalid-key" }, async ({
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


  test("renames the project through Rust and shows it in the visible breadcrumb", { tag: "@case-projects-rename-breadcrumb" }, async ({ page, request }) => {
    const project = (await getProjects(request)).find((row) => row.slug === "CDN")!;
    const renamed = "Projects suite renamed default";
    const crumb = page.getByTestId("crumb-project");
    const openStory = async () => {
      await page.getByRole("tab", { name: "Onboarding Tour Module", exact: true }).click();
      await page.getByRole("treeitem", { name: /Story created during the onboarding tour/ }).click();
    };
    await page.goto("/");
    await openStory();
    await expect(crumb).toHaveText(project.name);
    try {
      const updated = (await graphql(request, UpdateWorkTrackerProjectDocument, { id: project.id, name: renamed })).update_project;
      expect(updated).toMatchObject({ name: renamed, slug: project.slug });
      await page.reload();
      await openStory();
      await expect(crumb).toHaveText(renamed);
    } finally {
      await graphql(request, UpdateWorkTrackerProjectDocument, { id: project.id, name: project.name });
    }
    await page.reload();
    await openStory();
    await expect(crumb).toHaveText(project.name);
  });

  test("refuses duplicate and blank projects and recovers with a valid record", { tag: "@case-projects-create-recovery" }, async ({ request }) => {
    const before = await getProjects(request);
    const duplicate = await graphqlRefusal(request, CreateWorkTrackerProjectDocument, { name: "Projects duplicate", slug: "CDN" });
    expect(duplicate.message).toBeTruthy();
    const blank = await graphqlRefusal(request, CreateWorkTrackerProjectDocument, { name: " ", slug: "PBR" });
    expect(blank.message).toBeTruthy();
    expect(await getProjects(request)).toHaveLength(before.length);
    const recovered = await createProject(request, { name: "Projects recovered create", slug: "PBR" });
    expect((await getProjects(request)).find((row) => row.id === recovered.id)).toMatchObject({ name: recovered.name, slug: "PBR" });
  });

  test("updates only the addressed project and rejects an invalid update before recovery", { tag: "@case-projects-update-recovery" }, async ({ request }) => {
    const project = await createProject(request, { name: "Projects update identity", slug: "PUI" });
    const seeded = (await getProjects(request)).find((row) => row.slug === "CDN")!;
    const refusal = await graphqlRefusal(request, UpdateWorkTrackerProjectDocument, { id: project.id, name: " " });
    expect(refusal.message).toBeTruthy();
    expect((await getProjects(request)).find((row) => row.id === project.id)?.name).toBe(project.name);
    const updated = (await graphql(request, UpdateWorkTrackerProjectDocument, { id: project.id, name: "Projects updated identity", description: "Persisted project description" })).update_project;
    expect(updated).toMatchObject({ id: project.id, name: "Projects updated identity", slug: "PUI", description: "Persisted project description" });
    const rows = await getProjects(request);
    expect(rows.find((row) => row.id === project.id)).toMatchObject(updated!);
    expect(rows.find((row) => row.id === seeded.id)).toMatchObject(seeded);
  });

  test("resolves CDN ahead of unrelated projects and restores its workspace after reload", { tag: "@case-projects-default-selection" }, async ({ page, request }) => {
    await createProject(request, { name: "Projects unrelated selection", slug: "PUS" });
    const project = (await getProjects(request)).find((row) => row.slug === "CDN")!;
    await page.goto("/");
    const module = page.getByRole("tab", { name: "Onboarding Tour Module", exact: true });
    await module.click();
    await page.getByRole("treeitem", { name: /Story created during the onboarding tour/ }).click();
    await expect(page.getByTestId("crumb-project")).toHaveText(project.name);
    await page.reload();
    await expect(module).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("crumb-project")).toHaveText(project.name);
  });

  test("recovers a refused project deletion without changing another project", { tag: "@case-projects-delete-recovery" }, async ({ request }) => {
    const project = await createProject(request, { name: "Projects deletion recovery", slug: "PDR" });
    const catalog = await getWorkflowCatalog(request, project.id);
    // A nonexistent identity is a real service refusal, not a mocked success.
    const refusal = await graphqlRefusal(request, DeleteWorkTrackerProjectDocument, { id: "00000000-0000-4000-8000-000000000000" });
    expect(refusal.message).toBeTruthy();
    expect(await getWorkflowCatalog(request, project.id)).toEqual(catalog);
    const seeded = (await getProjects(request)).find((row) => row.slug === "CDN")!;
    await graphql(request, DeleteWorkTrackerProjectDocument, { id: project.id });
    const rows = await getProjects(request);
    expect(rows.find((row) => row.id === project.id)).toBeUndefined();
    expect(rows.find((row) => row.id === seeded.id)).toMatchObject(seeded);
    const remains = await getWorkflowCatalog(request, project.id);
    expect(remains.project.nodes).toEqual([]);
    expect(remains.states.nodes).toEqual([]);
    expect(remains.issue_types.nodes).toEqual([]);
  });

  test("recovers project resolution after a failed project-list request", { tag: "@case-projects-resolution-retry" }, async ({ page }) => {
    await page.route("**/graphql", (route) => {
      const body = route.request().postDataJSON();
      return body.operationName === "WorkTrackerProjects" ? route.abort() : route.continue();
    });
    await page.goto("/");
    await expect(page.getByText("The local server is not running.", { exact: true })).toBeVisible();
    await page.unroute("**/graphql");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Onboarding Tour Module", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("tab", { name: "Onboarding Tour Module", exact: true })).toBeVisible();
  });
});

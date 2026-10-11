import { test, expect } from "./planning-module-test";
import { emptyVisit, epicNamed, graph, moduleFixture, selectEpic, storyNamed, storyRow } from "./planning-module-support";
import { plannedStories } from "./sprint-planning-support";

test("inline Story recovery retries assignment and refresh without creating duplicates", { tag: ["@plan-create", "@case-story-recovery"] }, async ({ page, request }) => {
  const fixture = await moduleFixture(request, "Creation");
  const { id } = await emptyVisit(page, fixture, "Creation release");
  await selectEpic(page, fixture.epic.name);
  const sprint = page.getByTestId("plan-sprint-items");
  const backlog = page.getByTestId("plan-backlog");
  let rejectAssignment = true;
  let rejectGraph = false;
  await page.route("**/graphql", async (route) => {
    const operation = route.request().postDataJSON()?.operationName;
    if (rejectAssignment && operation === "PlanWorkItem") { rejectAssignment = false; return route.abort("failed"); }
    if (rejectGraph && operation === "PlanningGraph") return route.abort("failed");
    return route.continue();
  });
  await sprint.getByRole("button", { name: "Add story", exact: true }).click();
  await sprint.getByRole("textbox", { name: "Story title" }).fill("Creation assignment recovery");
  await sprint.getByRole("textbox", { name: "Story title" }).press("Enter");
  await expect(sprint.getByRole("alert")).toContainText("Story created; sprint assignment failed");
  const created = await storyNamed(request, fixture.projectId, "Creation assignment recovery");
  expect(created).toMatchObject({ sprintId: null });
  await sprint.getByRole("button", { name: "Retry assignment", exact: true }).click();
  await expect(storyRow(sprint, "Creation assignment recovery")).toBeVisible();
  expect(await storyNamed(request, fixture.projectId, "Creation assignment recovery")).toMatchObject({ id: created?.id, sprintId: id });
  rejectGraph = true;
  await backlog.getByRole("button", { name: "Add story", exact: true }).click();
  await backlog.getByRole("textbox", { name: "Story title" }).fill("Creation refresh recovery");
  await backlog.getByRole("textbox", { name: "Story title" }).press("Enter");
  await expect(backlog.getByRole("alert")).toContainText("Story saved, but the view could not refresh");
  const saved = await storyNamed(request, fixture.projectId, "Creation refresh recovery");
  expect(saved).toMatchObject({ sprintId: null });
  rejectGraph = false;
  await backlog.getByRole("button", { name: "Retry refresh", exact: true }).click();
  await expect(storyRow(backlog, "Creation refresh recovery")).toBeVisible();
  expect(await storyNamed(request, fixture.projectId, "Creation refresh recovery")).toMatchObject({ id: saved?.id });
  await page.unroute("**/graphql");
  let loseResponse = true;
  await page.route("**/graphql", async (route) => {
    if (loseResponse && route.request().postDataJSON()?.operationName === "CreateWorkTrackerWorkItem") {
      loseResponse = false;
      await route.fetch(); // Commit on Rust, then lose only transport delivery.
      return route.abort("failed");
    }
    return route.continue();
  });
  await backlog.getByRole("textbox", { name: "Story title" }).fill("Creation uncertain delivery");
  await backlog.getByRole("textbox", { name: "Story title" }).press("Enter");
  await expect(backlog.getByRole("alert")).toContainText("Could not confirm whether the story was created");
  await expect(backlog.getByRole("button", { name: /^Retry/ })).toHaveCount(0);
  await backlog.getByRole("button", { name: "Inspect backlog", exact: true }).click();
  await expect(storyRow(backlog, "Creation uncertain delivery")).toBeVisible();
  const rows = await plannedStories(request, fixture.projectId);
  for (const name of ["Creation assignment recovery", "Creation refresh recovery", "Creation uncertain delivery"]) {
    expect(rows.filter((row) => row.name === name)).toHaveLength(1);
  }
});

test("new epic and sprint recover a failed refresh using the committed identity", { tag: ["@plan-epics", "@plan-sprints", "@case-identity-recovery"] }, async ({ page, request }) => {
  const fixture = await moduleFixture(request, "Refresh");
  await emptyVisit(page, fixture, "Refresh release");
  let rejectGraph = false;
  const creates: string[] = [];
  page.on("request", (request) => {
    const operation = request.postDataJSON()?.operationName;
    if (operation === "CreateWorkTrackerWorkItem" || operation === "CreateSprint") creates.push(operation);
  });
  await page.route("**/graphql", async (route) => {
    if (rejectGraph && route.request().postDataJSON()?.operationName === "PlanningGraph") return route.abort("failed");
    return route.continue();
  });
  await page.getByRole("button", { name: "Add epic", exact: true }).click();
  await page.getByRole("button", { name: "+ New epic", exact: true }).click();
  rejectGraph = true;
  await page.getByRole("textbox", { name: "New epic name" }).fill("Refresh committed epic");
  await page.getByRole("textbox", { name: "New epic name" }).press("Enter");
  await expect(page.getByRole("button", { name: "Retry refresh", exact: true })).toBeVisible();
  rejectGraph = false;
  await page.getByRole("button", { name: "Retry refresh", exact: true }).click();
  await expect(page.getByRole("tab", { name: /^Refresh committed epic,/ })).toHaveAttribute("aria-selected", "true");
  expect(creates).toEqual(["CreateWorkTrackerWorkItem"]);
  await page.getByRole("button", { name: "Back to sprints", exact: true }).click();
  await page.getByRole("button", { name: "New sprint", exact: true }).click();
  rejectGraph = true;
  await page.getByRole("textbox", { name: "Sprint name" }).fill("Refresh committed sprint");
  await page.getByRole("textbox", { name: "Sprint name" }).press("Enter");
  await expect(page.getByRole("button", { name: "Retry refresh", exact: true })).toBeVisible();
  rejectGraph = false;
  await page.getByRole("button", { name: "Retry refresh", exact: true }).click();
  await expect(page.getByTestId("plan-sprint").getByRole("heading", { name: "Refresh committed sprint", level: 1, exact: true })).toBeVisible();
  expect(creates).toEqual(["CreateWorkTrackerWorkItem", "CreateSprint"]);
  expect(await epicNamed(request, fixture.projectId, "Refresh committed epic")).toBeTruthy();
  expect((await graph(request, fixture.projectId)).sprints.nodes.filter((row) => row.name === "Refresh committed sprint")).toHaveLength(1);
});

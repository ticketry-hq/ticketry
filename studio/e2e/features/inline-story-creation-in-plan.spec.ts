import { test, expect } from "../planning-module-test";
import { emptyVisit, moduleFixture, selectEpic, storyNamed, storyRow, inlineStory, reloadPlan } from "../planning-module-support";
import { plannedStories } from "../sprint-planning-support";
import { featureSuite } from "./featureSuite";

featureSuite("inline-story-creation-in-plan", { isolation: "case", test }, () => {
test("inline Story recovery retries assignment and refresh without creating duplicates", { tag: ["@case-story-recovery"] }, async ({ page, request }) => {
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



test("separate Plan Story drafts cancel, reject blanks and persist trimmed parent and sprint membership", { tag: "@case-create-drafts" }, async ({ page, request }) => {
  const fixture = await moduleFixture(request, "Drafts");
  const { id } = await emptyVisit(page, fixture, "Drafts release");
  await selectEpic(page, fixture.epic.name);
  const backlog = page.getByTestId("plan-backlog");
  const sprint = page.getByTestId("plan-sprint-items");
  const input = backlog.getByRole("textbox", { name: "Story title" });
  let creates = 0;
  page.on("request", (request) => { if (request.postDataJSON()?.operationName === "CreateWorkTrackerWorkItem") creates++; });
  await backlog.getByRole("button", { name: "Add story", exact: true }).press("Enter");
  await input.fill("   ");
  await input.press("Enter");
  await expect(input).toHaveValue("   ");
  await input.fill("Drafts cancelled");
  await input.press("Escape");
  await expect(backlog.getByRole("button", { name: "Add story", exact: true })).toBeFocused();
  expect(creates).toBe(0);
  expect(await storyNamed(request, fixture.projectId, "Drafts cancelled")).toBeUndefined();
  await inlineStory(backlog, "  Drafts backlog  ");
  await input.fill("Drafts unsubmitted");
  await inlineStory(sprint, "  Drafts sprint  ");
  await expect(input).toHaveValue("Drafts unsubmitted");
  await expect(sprint.getByRole("textbox", { name: "Story title" })).toBeFocused();
  expect(await storyNamed(request, fixture.projectId, "Drafts backlog")).toMatchObject({ parentId: fixture.epic.id, sprintId: null });
  expect(await storyNamed(request, fixture.projectId, "Drafts sprint")).toMatchObject({ parentId: fixture.epic.id, sprintId: id });
  expect(await storyNamed(request, fixture.projectId, "Drafts unsubmitted")).toBeUndefined();
  await reloadPlan(page, "Drafts release", fixture.epic.name);
  await expect(storyRow(backlog, "Drafts backlog")).toBeVisible();
  await expect(storyRow(sprint, "Drafts sprint")).toBeVisible();
});

test("No epic creates an unparented Story and dismissing uncertain creation preserves its identity", { tag: "@case-create-no-epic-dismiss" }, async ({ page, request }) => {
  const fixture = await moduleFixture(request, "Unparented");
  await emptyVisit(page, fixture, "Unparented release");
  await selectEpic(page, "No epic");
  const backlog = page.getByTestId("plan-backlog");
  await inlineStory(backlog, "Unparented saved");
  expect(await storyNamed(request, fixture.projectId, "Unparented saved")).toMatchObject({ parentId: null, sprintId: null });
  let loseResponse = true;
  await page.route("**/graphql", async (route) => {
    if (loseResponse && route.request().postDataJSON()?.operationName === "CreateWorkTrackerWorkItem") {
      loseResponse = false;
      await route.fetch();
      return route.abort("failed");
    }
    return route.continue();
  });
  await backlog.getByRole("textbox", { name: "Story title" }).fill("Unparented uncertain");
  await backlog.getByRole("textbox", { name: "Story title" }).press("Enter");
  await expect(backlog.getByRole("alert")).toContainText("Could not confirm whether the story was created");
  const saved = await storyNamed(request, fixture.projectId, "Unparented uncertain");
  expect(saved).toBeTruthy();
  await backlog.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(backlog.getByRole("alert")).toHaveCount(0);
  await expect(backlog.getByRole("button", { name: "Add story", exact: true })).toBeFocused();
  await page.unroute("**/graphql");
  await reloadPlan(page, "Unparented release", "No epic");
  await expect(storyRow(backlog, "Unparented uncertain")).toBeVisible();
  const rows = (await plannedStories(request, fixture.projectId)).filter((row) => row.name === "Unparented uncertain");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: saved?.id, parentId: null });
});

test("Story create rejection remains editable and a pending successful write cannot duplicate submission", { tag: "@case-create-rejection-busy" }, async ({ page, request }) => {
  const fixture = await moduleFixture(request, "Guarded");
  await emptyVisit(page, fixture, "Guarded release");
  await selectEpic(page, fixture.epic.name);
  const backlog = page.getByTestId("plan-backlog");
  await backlog.getByRole("button", { name: "Add story", exact: true }).click();
  const input = backlog.getByRole("textbox", { name: "Story title" });
  let reject = true;
  await page.route("**/graphql", async (route) => {
    if (reject && route.request().postDataJSON()?.operationName === "CreateWorkTrackerWorkItem") {
      reject = false;
      return route.fulfill({ json: { errors: [{ message: "Story creation rejected" }] } });
    }
    return route.continue();
  });
  await input.fill("Guarded Story");
  await input.press("Enter");
  await expect(backlog.getByRole("alert")).toContainText("Story creation rejected");
  await expect(input).toBeEditable();
  expect(await storyNamed(request, fixture.projectId, "Guarded Story")).toBeUndefined();
  await page.unroute("**/graphql");
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  await page.route("**/graphql", async (route) => {
    if (route.request().postDataJSON()?.operationName !== "CreateWorkTrackerWorkItem") return route.continue();
    writes++;
    const response = await route.fetch();
    await gate;
    return route.fulfill({ response });
  });
  await input.press("Enter");
  await expect(input).toBeDisabled();
  await expect(input.locator("..")).toHaveAttribute("aria-busy", "true");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(input).toBeDisabled();
  expect(writes).toBe(1);
  release();
  await expect(storyRow(backlog, "Guarded Story")).toBeVisible();
  await expect(input).toBeEditable();
  await expect(input.locator("..")).toHaveAttribute("aria-busy", "false");
  await expect(input).toHaveValue("");
  expect(writes).toBe(1);
  expect((await plannedStories(request, fixture.projectId)).filter((row) => row.name === "Guarded Story")).toHaveLength(1);
});

});

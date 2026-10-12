import { test, expect } from "../planning-module-test";
import { emptyVisit, epicNamed, graph, moduleFixture, selectEpic, storyNamed, storyRow } from "../planning-module-support";
import { addGoal, executionCleaned, launchFromCard, providerMode, releaseProvider, reopenSprints, sprintThroughUi, suggestions } from "../sprint-planning-support";
import { featureSuite } from "./featureSuite";

featureSuite("epic-planning", { isolation: "case", test }, () => {
test("new epic and sprint recover a failed refresh using the committed identity", { tag: ["@case-identity-recovery"] }, async ({ page, request }) => {
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


test("epic visits cycle, close and reopen while empty and cancelled creation writes nothing", { tag: "@case-epic-visits" }, async ({ page, request }) => {
  const fixture = await moduleFixture(request, "Visits");
  await emptyVisit(page, fixture, "Visits release");
  const first = await selectEpic(page, fixture.epic.name);
  const second = await selectEpic(page, fixture.secondEpic.name);
  await expect(first).toHaveAccessibleName("Visits epic, 2 backlog stories");
  await second.press("Alt+BracketLeft");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await first.press("Alt+BracketRight");
  await expect(second).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Next epic", exact: true }).click();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: /^Done with Visits epic/ }).click();
  await expect(second).toBeFocused();
  await page.getByRole("button", { name: "Close Visits other epic", exact: true }).click();
  await expect(page.getByTestId("plan-backlog").getByText("No epic open. Use + Add epic to plan another one.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add epic", exact: true })).toBeFocused();
  await selectEpic(page, fixture.secondEpic.name);
  await page.getByRole("button", { name: /^Done with Visits other epic/ }).click();
  await expect(page.getByRole("button", { name: "Add epic", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator('[data-testid^="sprint-card-"]').filter({ has: page.getByRole("heading", { name: "Visits release", exact: true }) }).getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByTestId("plan-backlog").getByText("No epic open. Use + Add epic to plan another one.")).toBeVisible();
  await selectEpic(page, fixture.epic.name);
  await page.getByRole("button", { name: "Add epic", exact: true }).click();
  await page.getByRole("button", { name: "+ New epic", exact: true }).click();
  const input = page.getByRole("textbox", { name: "New epic name" });
  let creates = 0;
  page.on("request", (request) => { if (request.postDataJSON()?.operationName === "CreateWorkTrackerWorkItem") creates++; });
  await input.fill("   ");
  await input.press("Enter");
  await expect(input).toHaveValue("   ");
  await input.fill("Visits discarded");
  await input.press("Escape");
  expect(creates).toBe(0);
  expect(await epicNamed(request, fixture.projectId, "Visits discarded")).toBeUndefined();
  await page.getByRole("button", { name: "+ New epic", exact: true }).click();
  await input.fill("  Visits saved  ");
  await input.press("Enter");
  await expect(page.getByRole("tab", { name: /^Visits saved,/ })).toHaveAttribute("aria-selected", "true");
  expect(await epicNamed(request, fixture.projectId, "Visits saved")).toBeTruthy();
});

test("epic membership follows moves, failed writes, Retry and Undo", { tag: "@case-epic-membership" }, async ({ page, request }) => {
  const fixture = await moduleFixture(request, "Grouping");
  const { id } = await emptyVisit(page, fixture, "Grouping release");
  await selectEpic(page, fixture.secondEpic.name);
  const backlog = page.getByTestId("plan-backlog");
  const sprint = page.getByTestId("plan-sprint-items");
  const membership = async () => (await storyNamed(request, fixture.projectId, fixture.other.name))?.sprintId;
  let fail = true;
  await page.route("**/graphql", async (route) => {
    if (fail && route.request().postDataJSON()?.operationName === "PlanWorkItem") { fail = false; return route.abort("failed"); }
    return route.continue();
  });
  await storyRow(backlog, fixture.other.name).getByRole("button", { name: /^Plan / }).click();
  await expect(page.getByTestId("plan-feedback")).toContainText("Couldn't move");
  await expect(storyRow(backlog, fixture.other.name)).toBeVisible();
  expect(await membership()).toBeNull();
  // The browser refresh follows the committed Retry assignment.
  const retried = page.waitForResponse((response) => response.ok()
    && response.request().postDataJSON()?.operationName === "PlanningGraph");
  await page.getByRole("button", { name: /^Retry moving / }).click();
  await expect.poll(membership).toBe(id);
  await (await retried).finished();
  await expect(storyRow(sprint, fixture.other.name)).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Grouping other epic,/ })).toHaveAccessibleName("Grouping other epic, 0 backlog stories");
  await selectEpic(page, fixture.epic.name);
  await expect(storyRow(sprint, fixture.other.name).locator("xpath=..")).toHaveClass(/opacity-50/);
  // The committed assignment precedes its fact-driven browser graph refresh.
  const refreshed = page.waitForResponse((response) => response.ok()
    && response.request().postDataJSON()?.operationName === "PlanningGraph");
  await page.getByTestId("plan-undo").click();
  await expect.poll(membership).toBeNull();
  await (await refreshed).finished();
  await expect(storyRow(sprint, fixture.other.name)).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /^Grouping other epic,/ })).toHaveAccessibleName("Grouping other epic, 1 backlog stories");
  await selectEpic(page, fixture.secondEpic.name);
  await expect(storyRow(backlog, fixture.other.name)).toBeVisible();
});


test("epic Add all isolates waiting suggestions and No epic retains counts through close, reopen and Undo", { tag: "@case-epic-bulk-no-epic" }, async ({ page, request }) => {
  const fixture = await moduleFixture(request, "EpicReview");
  const { id, card } = await sprintThroughUi(page, fixture, "EpicReview release");
  await addGoal(card, "Removed goal");
  await addGoal(card, "Keep attributed suggestions");
  await card.getByRole("button", { name: "Remove goal: Removed goal", exact: true }).click();
  await providerMode("success", false, { prefix: fixture.prefix });
  const execution = await launchFromCard(page, card, request, id, "Find stories for these goals");
  await releaseProvider(execution.id);
  await expect(card.getByText(/4 suggestions ready/)).toBeVisible();
  await executionCleaned(execution.id);
  await card.getByRole("button", { name: "Review in Plan →" }).click();
  const epic = await selectEpic(page, fixture.epic.name);
  await expect(epic).toHaveAccessibleName(/3 waiting suggestions/);
  let fail = true;
  await page.route("**/graphql", async (route) => {
    if (fail && route.request().postDataJSON()?.operationName === "UpdateSprintSuggestion") { fail = false; return route.abort("failed"); }
    return route.continue();
  });
  await page.getByRole("button", { name: "Add all", exact: true }).click();
  await expect(page.getByTestId("plan-feedback")).toContainText("Couldn't accept");
  await page.getByRole("button", { name: /^Retry accepting / }).click();
  await expect.poll(async () => (await suggestions(request, id)).filter((row) => row.status === "waiting" && (row.issue?.moduleId ?? row.proposedEpicId) === fixture.epic.id).length).toBeLessThan(3);
  await page.getByRole("button", { name: "Add all", exact: true }).click();
  await expect.poll(async () => (await suggestions(request, id)).filter((row) => row.status === "accepted").length).toBe(3);
  await expect(page.getByTestId("plan-sprint-items").getByText("G2", { exact: true })).toHaveCount(3);
  const noEpic = await selectEpic(page, "No epic");
  await expect(noEpic).toHaveAccessibleName(/1 waiting suggestions/);
  await page.getByRole("button", { name: "Close No epic", exact: true }).click();
  await selectEpic(page, "No epic");
  await expect(page.getByRole("button", { name: "✦ EpicReview ungrouped", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add all", exact: true }).click();
  await expect.poll(async () => (await suggestions(request, id)).every((row) => row.status === "accepted")).toBe(true);
  await expect(page.getByRole("button", { name: "Add all", exact: true })).toHaveCount(0);
  await page.getByTestId("plan-undo").click();
  await expect.poll(async () => (await suggestions(request, id)).filter((row) => row.status === "waiting").length).toBe(1);
  await reopenSprints(page);
  await expect(card.getByText(/1 suggestions ready/)).toBeVisible();
  await card.getByRole("button", { name: "Review in Plan →" }).click();
  await selectEpic(page, "No epic");
  await expect(page.getByRole("button", { name: "✦ EpicReview ungrouped", exact: true })).toBeVisible();
});

});

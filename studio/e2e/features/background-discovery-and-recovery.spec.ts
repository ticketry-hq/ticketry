import { test, expect } from "../planning-module-test";
import { featureSuite } from "./featureSuite";
import { moduleFixture, selectEpic, storyNamed } from "../planning-module-support";
import {
  addEpic, addGoal, executionCleaned, executionRecords, goals, launchFromCard,
  plannedStories, planningFixture, providerMode, releaseProvider, reopenSprints,
  sprintState, sprintThroughUi, suggestions,
} from "../sprint-planning-support";
import { captureLegacyProductApiRequests } from "../support";

featureSuite("background-discovery-and-recovery", { test, isolation: "case" }, () => {
test("cancellation, provider failure and Retry status recover without losing goals or launching duplicate runs", { tag: ["@case-agent-recovery"] }, async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const fixture = await planningFixture(request, { prefix: "Recovery" });
  const legacy = captureLegacyProductApiRequests(page);
  const { id, card } = await sprintThroughUi(page, fixture, "Planning recovery");
  await addGoal(card, "Keep my goals during failure");
  await providerMode("delayed", false, { prefix: fixture.prefix });
  const cancelled = await launchFromCard(page, card, request, id, "Find stories for these goals");
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card.getByText("Agent cancelled. Your goals are kept.")).toBeVisible();
  await executionCleaned(cancelled.id);
  await reopenSprints(page);
  await expect(card.getByText("Agent cancelled. Your goals are kept.")).toBeVisible();
  expect((await executionRecords(request, id)).agentExecutions.nodes.find((row) => row.id === cancelled.id))
    .toMatchObject({ state: "cancelled", cancelRequested: true });
  expect((await goals(request, id)).map((goal) => goal.text)).toEqual(["Keep my goals during failure"]);
  await providerMode("failure", false, { prefix: fixture.prefix });
  const failed = await launchFromCard(page, card, request, id, "Retry");
  await releaseProvider(failed.id);
  await expect(card.getByRole("alert")).toContainText("Check the provider configuration and retry.");
  await expect(card.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await executionCleaned(failed.id);
  await reopenSprints(page);
  await expect(card.getByRole("alert")).toContainText("Check the provider configuration and retry.");
  const persisted = await executionRecords(request, id);
  expect(persisted.agentExecutions.nodes.find((row) => row.id === failed.id)?.state).toBe("failed");
  expect(persisted.agentExecutions.nodes.find((row) => row.id === failed.id)?.error)
    .toContain("Check the provider configuration and retry.");

  let failRead = true;
  const launches: string[] = [];
  page.on("request", (request) => {
    if (request.postDataJSON()?.operationName === "CreateSprintSuggestionExecution") launches.push(request.url());
  });
  await page.route("**/graphql", async (route) => {
    if (failRead && route.request().postDataJSON()?.operationName === "SprintSuggestionExecution") return route.abort("failed");
    await route.continue();
  });
  await reopenSprints(page);
  await expect(card.getByRole("button", { name: "Retry status", exact: true })).toBeVisible();
  failRead = false;
  await card.getByRole("button", { name: "Retry status", exact: true }).click();
  await expect(card.getByRole("button", { name: "Retry status", exact: true })).toHaveCount(0);
  await expect(card.getByRole("alert")).toContainText("Check the provider configuration and retry.");
  expect(launches).toEqual([]);
  expect((await executionRecords(request, id)).agentExecutions.nodes).toHaveLength(2);
  await page.unroute("**/graphql");
  await providerMode("success", true, { prefix: fixture.prefix });
  const retried = await launchFromCard(page, card, request, id, "Retry");
  await releaseProvider(retried.id);
  await expect(card.getByText(/2 suggestions ready/)).toBeVisible();
  await executionCleaned(retried.id);
  await reopenSprints(page);
  await expect(card.getByText(/2 suggestions ready/)).toBeVisible();
  const completed = await executionRecords(request, id);
  expect(completed.agentExecutions.nodes.find((row) => row.id === retried.id)?.state).toBe("succeeded");
  expect(completed.agentExecutions.nodes.find((row) => row.id === retried.id))
    .toMatchObject({ error: null, cancelRequested: false, outputType: "sprint_suggestions_v1" });
  expect((await goals(request, id)).map((goal) => goal.text)).toEqual(["Keep my goals during failure"]);
  await page.screenshot({ path: testInfo.outputPath("sprint-recovery.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await card.scrollIntoViewIfNeeded();
  const review = card.getByRole("button", { name: "Review in Plan →" });
  await review.focus();
  await expect(review).toBeFocused();
  await expect(review).toBeInViewport();
  await expect(card.getByRole("button", { name: "Find stories again", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("sprints-narrow.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(legacy).toEqual([]);
});


test("typed discovery publishes existing, proposed and ungrouped suggestions without interactive sessions", { tag: "@case-discovery-publication" }, async ({ page, request }) => {
  const fixture = await planningFixture(request, { prefix: "Publication" });
  const { id, card } = await sprintThroughUi(page, fixture, "Publication release");
  await expect(card.getByRole("button", { name: "Find stories for these goals", exact: true })).toBeDisabled();
  await expect(card.getByText("Add goals, then an agent can look for stories that fit them.")).toBeVisible();
  expect(await executionRecords(request, id)).toMatchObject({ agentExecutions: { nodes: [] } });
  await addGoal(card, "Publish typed suggestions");
  const before = await executionRecords(request, id);
  await providerMode("success", false, { prefix: fixture.prefix });
  let deliver = () => {};
  const gate = new Promise<void>((resolve) => { deliver = resolve; });
  await page.route("**/graphql", async (route) => {
    if (route.request().postDataJSON()?.operationName !== "CreateSprintSuggestionExecution") return route.continue();
    const response = await route.fetch();
    await gate;
    return route.fulfill({ response });
  });
  await card.getByRole("button", { name: "Find stories for these goals", exact: true }).press("Enter");
  await expect(card.getByRole("button", { name: "Starting…", exact: true })).toBeDisabled();
  deliver();
  await expect(card.getByRole("progressbar", { name: "Finding stories" })).toBeVisible();
  await page.unroute("**/graphql");
  const execution = (await executionRecords(request, id)).agentExecutions.nodes[0];
  expect(execution).toMatchObject({ outputType: "sprint_suggestions_v1" });
  await reopenSprints(page);
  await expect(card.getByRole("progressbar", { name: "Finding stories" })).toBeVisible();
  expect((await executionRecords(request, id)).agentExecutions.nodes).toHaveLength(1);
  await releaseProvider(execution.id);
  await expect(card.getByText(/4 suggestions ready/)).toBeVisible();
  await executionCleaned(execution.id);
  const after = await executionRecords(request, id);
  expect(after.agentTerminalSessions.nodes).toEqual(before.agentTerminalSessions.nodes);
  expect(after.workItems.nodes.filter((item) => item.issueType?.name === "Conversation")).toEqual(before.workItems.nodes.filter((item) => item.issueType?.name === "Conversation"));
  expect(after.agentExecutions.nodes[0]).toMatchObject({ state: "succeeded", cancelRequested: false, error: null });
  const published = await suggestions(request, id);
  expect(published).toHaveLength(4);
  expect(published.every((item) => item.status === "waiting")).toBe(true);
  expect(published.find((item) => item.proposedName === "Publication proposal")?.proposedEpicId).toBe(fixture.epic.id);
  expect(published.find((item) => item.issue?.name === "Publication ungrouped")?.issue?.parentId).toBeNull();
  expect((await plannedStories(request, fixture.projectId)).filter((item) => item.sprintId === id)).toEqual([]);
  await card.getByRole("button", { name: "Review in Plan →", exact: true }).press("Enter");
  await expect(page.getByTestId("plan-sprint").getByRole("heading", { name: "Publication release", exact: true, level: 1 })).toBeVisible();
  await addEpic(page, fixture.epic.name, 3);
  await expect(page.getByRole("button", { name: "✦ Publication proposal", exact: true })).toBeVisible();
  await addEpic(page, "No epic", 1);
  await expect(page.getByRole("button", { name: "✦ Publication ungrouped", exact: true })).toBeVisible();
  await reopenSprints(page);
  await expect(card.getByText(/4 suggestions ready/)).toBeVisible();
});

test("empty discovery output persists a successful zero-result publication", { tag: "@case-discovery-empty-publication" }, async ({ page, request }) => {
  const fixture = await planningFixture(request, { prefix: "Empty" });
  const { id, card } = await sprintThroughUi(page, fixture, "Empty discovery release");
  await addGoal(card, "No matching stories");
  await providerMode("success", false, { prefix: fixture.prefix, empty: true });
  const execution = await launchFromCard(page, card, request, id, "Find stories for these goals");
  await releaseProvider(execution.id);
  await expect(card.getByText(/0 suggestions ready/)).toBeVisible();
  await executionCleaned(execution.id);
  expect(await suggestions(request, id)).toEqual([]);
  expect((await executionRecords(request, id)).agentExecutions.nodes[0]).toMatchObject({ state: "succeeded", error: null });
  await reopenSprints(page);
  await expect(card.getByText(/0 suggestions ready/)).toBeVisible();
  await card.getByRole("button", { name: "Review in Plan →", exact: true }).click();
  await selectEpic(page, fixture.epic.name);
  await expect(page.locator("[data-plan-suggestion]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add all", exact: true })).toHaveCount(0);
});

test("launch and cancellation transport failures allow explicit retries without losing the running identity", { tag: "@case-discovery-network-retry" }, async ({ page, request }) => {
  const fixture = await planningFixture(request, { prefix: "Network" });
  const { id, card } = await sprintThroughUi(page, fixture, "Network discovery release");
  await addGoal(card, "Retain discovery identity");
  await providerMode("delayed", false, { prefix: fixture.prefix });
  let rejectLaunch = true;
  let rejectCancel = true;
  await page.route("**/graphql", async (route) => {
    const operation = route.request().postDataJSON()?.operationName;
    if (rejectLaunch && operation === "CreateSprintSuggestionExecution") { rejectLaunch = false; return route.abort("failed"); }
    if (rejectCancel && operation === "CancelSprintSuggestionExecution") { rejectCancel = false; return route.abort("failed"); }
    return route.continue();
  });
  await card.getByRole("button", { name: "Find stories for these goals", exact: true }).click();
  await expect(card.getByRole("alert")).toBeVisible();
  expect((await executionRecords(request, id)).agentExecutions.nodes).toHaveLength(0);
  const execution = await launchFromCard(page, card, request, id, "Retry");
  await card.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
  await expect(card.getByRole("alert")).toBeVisible();
  expect((await executionRecords(request, id)).agentExecutions.nodes[0]).toMatchObject({ id: execution.id, cancelRequested: false });
  await card.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
  await expect(card.getByText("Agent cancelled. Your goals are kept.")).toBeVisible();
  await executionCleaned(execution.id);
  expect((await executionRecords(request, id)).agentExecutions.nodes).toHaveLength(1);
  expect((await goals(request, id)).map((item) => item.text)).toEqual(["Retain discovery identity"]);
  await page.unroute("**/graphql");
  await reopenSprints(page);
  await expect(card.getByText("Agent cancelled. Your goals are kept.")).toBeVisible();
});
});

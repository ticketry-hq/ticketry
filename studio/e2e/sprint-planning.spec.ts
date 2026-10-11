import { expect, test } from "@playwright/test";
import {
  addEpic, addGoal, executionCleaned, executionRecords, goals, launchFromCard,
  plannedStories, planningFixture, providerMode, releaseProvider, reopenSprints,
  sprintState, sprintThroughUi, suggestions,
} from "./sprint-planning-support";
import { captureLegacyProductApiRequests } from "./support";

test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ page }) => {
  // Keep concurrent source edits from restarting the journey through Vite HMR.
  await page.routeWebSocket((url) => url.pathname === "/" && url.searchParams.has("token"), () => {});
});

test("sprint goals, background publication, review decisions, Undo and refreshed suggestions persist", { tag: ["@plan-sprints", "@plan-agent", "@plan-review", "@plan-epics", "@plan-workspace", "@case-agent-review"] }, async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await planningFixture(request);
  const legacy = captureLegacyProductApiRequests(page);
  const { id, card } = await sprintThroughUi(page, fixture, "Planning release");
  await expect(card.getByRole("button", { name: "Find stories for these goals" })).toBeDisabled();
  await expect(card.getByText("Add goals, then an agent can look for stories that fit them.")).toBeVisible();
  await addGoal(card, "Make planning easier");
  await addGoal(card, "Keep review decisions");
  await expect.poll(async () => (await goals(request, id)).map((goal) => goal.text))
    .toEqual(["Make planning easier", "Keep review decisions"]);
  await reopenSprints(page);
  await expect(card.getByText("Make planning easier", { exact: true })).toBeVisible();
  await expect(card.getByText("Keep review decisions", { exact: true })).toBeVisible();
  const before = await executionRecords(request, id);
  await providerMode("success");

  // Delay only delivery of the genuine mutation response to inspect Starting.
  let deliver = () => {};
  const responseGate = new Promise<void>((resolve) => { deliver = resolve; });
  await page.route("**/graphql", async (route) => {
    if (route.request().postDataJSON()?.operationName !== "CreateSprintSuggestionExecution") return route.continue();
    const response = await route.fetch();
    await responseGate;
    await route.fulfill({ response });
  });
  await card.getByRole("button", { name: "Find stories for these goals" }).click();
  await expect(card.getByRole("button", { name: "Starting…" })).toBeDisabled();
  deliver();
  await expect(card.getByRole("status")).toHaveText("An agent is looking for stories…");
  await page.unroute("**/graphql");
  const records = await executionRecords(request, id);
  const execution = records.agentExecutions.nodes[0];
  if (!execution) throw new Error("Missing host execution");
  await expect(card.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  expect(records.agentTerminalSessions.nodes).toEqual(before.agentTerminalSessions.nodes);
  expect(records.workItems.nodes.filter((row) => row.issueType?.name === "Conversation"))
    .toEqual(before.workItems.nodes.filter((row) => row.issueType?.name === "Conversation"));
  expect(execution.outputType).toBe("sprint_suggestions_v1");
  await expect(page.getByTestId("workspace-tab-plan")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("workspace-tab-plan").press("Escape");
  await expect(page.getByTestId("workspace-tab-plan")).toBeFocused();
  await page.getByTestId("workspace-tab-plan").press("Enter");
  // Workspace entry chooses the oldest planned sprint; other suite journeys
  // may have created one earlier. Select this running sprint through its card.
  await expect(page.getByTestId("plan-sprint")).toBeVisible();
  if (!await page.getByTestId("plan-sprint").getByRole("heading", { name: "Planning release", exact: true, level: 1 }).count()) {
    await page.getByRole("button", { name: "Back to sprints" }).click();
    await card.getByRole("button", { name: "Plan", exact: true }).click();
  }
  await expect(page.getByTestId("plan-sprint").getByRole("status").filter({ hasText: "Agent still working…" })).toBeVisible();
  await page.getByRole("button", { name: "Back to sprints" }).click();
  await expect(card.getByRole("status")).toHaveText("An agent is looking for stories…");
  await releaseProvider(execution.id);
  await expect(card.getByText(/4 suggestions ready/)).toBeVisible();
  await executionCleaned(execution.id);
  const published = await suggestions(request, id);
  expect(published).toHaveLength(4);
  expect(published.every((row) => row.status === "waiting")).toBe(true);
  expect((await plannedStories(request, fixture.projectId)).filter((row) => row.sprintId === id)).toEqual([]);
  await card.getByRole("button", { name: "Review in Plan →" }).click();
  await expect(page.getByTestId("plan-sprint").getByRole("heading", { name: "Planning release", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByTestId("plan-sprint").getByText("✦ 4 to review", { exact: true })).toBeVisible();
  await addEpic(page, "Planning epic", 3);
  await page.getByRole("button", { name: "Close Planning epic", exact: true }).click();
  await addEpic(page, "Planning epic", 3);
  await addEpic(page, "No epic", 1);
  await expect(page.getByRole("button", { name: "✦ Planning ungrouped", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close No epic", exact: true }).click();
  await addEpic(page, "No epic", 1);
  await page.getByRole("tab", { name: /^No epic,/ }).press("Alt+BracketLeft");
  await expect(page.getByRole("tab", { name: /^Planning epic,/ })).toHaveAttribute("aria-selected", "true");
  const review = page.getByRole("button", { name: "✦ Planning existing", exact: true });
  await review.focus();
  await review.press("Enter");
  const detail = page.getByRole("complementary", { name: "Selected ticket" });
  await expect(detail.getByText("G1. Make planning easier", { exact: true })).toBeVisible();
  await expect(detail.getByText("Supports Make planning easier: Planning existing", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(review).toBeFocused();

  const existing = published.find((row) => row.issue?.name === "Planning existing");
  const proposal = published.find((row) => row.proposedName === "Planning proposal");
  const ungrouped = published.find((row) => row.issue?.name === "Planning ungrouped");
  const waiting = published.find((row) => row.issue?.name === "Planning waiting");
  if (!existing || !proposal || !ungrouped || !waiting) throw new Error("Incomplete published suggestions");
  await page.getByRole("button", { name: "Accept Planning existing", exact: true }).press("Enter");
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === existing.id)?.status).toBe("accepted");
  await expect(page.locator("[data-plan-suggestion]:focus")).toHaveCount(1);
  await page.getByRole("button", { name: /^Undo(?: |$)/ }).click();
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === existing.id)?.status).toBe("waiting");
  expect((await plannedStories(request, fixture.projectId)).find((row) => row.id === existing.issueId)?.sprintId).toBeNull();
  await page.getByRole("button", { name: "Accept Planning existing", exact: true }).click();
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === existing.id)?.status).toBe("accepted");
  await page.getByRole("button", { name: "✦ Planning proposal", exact: true }).click();
  await detail.getByRole("textbox", { name: "Title", exact: true }).fill("My edited proposal");
  await detail.getByRole("button", { name: "Dismiss", exact: true }).press("Enter");
  await expect(detail).toHaveCount(0);
  await expect(page.getByRole("button", { name: "✦ Planning waiting", exact: true })).toBeFocused();
  await page.getByRole("button", { name: /^Undo(?: |$)/ }).click();
  await page.getByRole("button", { name: "✦ Planning proposal", exact: true }).click();
  await expect(detail.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("My edited proposal");
  await detail.getByRole("textbox", { name: "Title", exact: true }).fill("Planning proposal");
  await detail.getByRole("button", { name: "Create story", exact: true }).press("Enter");
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === proposal.id)?.status).toBe("accepted");
  await expect(detail.getByRole("button", { name: "Close selected ticket" })).toBeFocused();
  const createdId = (await suggestions(request, id)).find((row) => row.id === proposal.id)?.issueId;
  expect(createdId).toBeTruthy();
  await page.getByRole("button", { name: /^Undo(?: |$)/ }).click();
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === proposal.id)?.status).toBe("waiting");
  const restored = (await suggestions(request, id)).find((row) => row.id === proposal.id);
  expect(restored).toMatchObject({ issueId: createdId, proposedName: null });
  expect((await plannedStories(request, fixture.projectId)).find((row) => row.id === createdId)?.sprintId).toBeNull();
  await page.getByRole("button", { name: "Accept Planning proposal", exact: true }).click();
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === proposal.id)?.status).toBe("accepted");
  await page.getByRole("tab", { name: /^No epic,/ }).click();
  await page.getByRole("button", { name: "Dismiss Planning ungrouped", exact: true }).click();
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === ungrouped.id)?.status).toBe("dismissed");
  await page.getByRole("button", { name: /^Undo(?: |$)/ }).click();
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === ungrouped.id)?.status).toBe("waiting");
  await page.getByRole("button", { name: "Dismiss Planning ungrouped", exact: true }).click();
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === ungrouped.id)?.status).toBe("dismissed");
  await reopenSprints(page);
  await expect(card.getByText(/1 suggestions ready/)).toBeVisible();
  expect((await plannedStories(request, fixture.projectId)).filter((row) => row.sprintId === id).map((row) => row.id).sort())
    .toEqual([existing.issueId, createdId].sort());
  await addGoal(card, "Cover refreshed goals");
  await expect(card.getByText("Goals changed since the agent ran")).toBeVisible();
  await card.getByRole("button", { name: "Remove goal: Keep review decisions" }).click();
  await expect(card.getByText("Keep review decisions", { exact: true })).toHaveCount(0);
  await reopenSprints(page);
  await expect(card.getByText("Goals changed since the agent ran")).toBeVisible();
  await providerMode("success", true);
  const rerun = await launchFromCard(page, card, request, id, "Find stories again");
  const during = await suggestions(request, id);
  expect(during.some((row) => row.id === waiting.id)).toBe(false);
  expect(during.map((row) => row.status).sort()).toEqual(["accepted", "accepted", "dismissed"]);
  await releaseProvider(rerun.id);
  await expect(card.getByText(/2 suggestions ready/)).toBeVisible();
  await executionCleaned(rerun.id);
  const refreshed = await suggestions(request, id);
  expect(refreshed.filter((row) => row.status === "waiting")).toHaveLength(2);
  expect(refreshed.filter((row) => row.status !== "waiting").map((row) => row.id).sort())
    .toEqual([existing.id, proposal.id, ungrouped.id].sort());
  expect((await sprintState(request, id)).suggestionRunId).toBe(rerun.agentRunId);
  await reopenSprints(page);
  await expect(card.getByText(/2 suggestions ready/)).toBeVisible();
  await card.getByRole("button", { name: "Review in Plan →" }).click();
  await addEpic(page, "Planning epic", 2);
  await page.getByRole("button", { name: "Add epic", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /^Planning epic,/ }).click();
  await page.screenshot({ path: testInfo.outputPath("plan-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Add epic", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "✦ Planning refreshed proposal", exact: true }).click();
  await expect(detail.getByRole("button", { name: "Create story", exact: true })).toBeInViewport();
  await detail.getByRole("button", { name: "Close selected ticket" }).focus();
  await expect(detail.getByRole("button", { name: "Close selected ticket" })).toBeFocused();
  await expect(detail.getByRole("button", { name: "Close selected ticket" })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("plan-narrow.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(legacy).toEqual([]);
});

test("cancellation, provider failure and Retry status recover without losing goals or launching duplicate runs", { tag: ["@plan-agent", "@plan-sprints", "@case-agent-recovery"] }, async ({ page, request }, testInfo) => {
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

test("Plan suggestion Undo restores existing and dismissed suggestions and retains an accepted proposal Story", { tag: ["@plan-review", "@case-suggestion-undo"] }, async ({ page, request }) => {
  test.setTimeout(120_000);
  const { acknowledgeOnboarding } = await import("./support");
  await acknowledgeOnboarding(request);
  const fixture = await planningFixture(request, { prefix: "Undo" });
  await page.goto("/");
  await page.getByTestId("workspace-tab-plan").click();
  if (await page.getByRole("button", { name: "Back to sprints" }).count()) await page.getByRole("button", { name: "Back to sprints" }).click();
  await page.getByRole("button", { name: "New sprint", exact: true }).click();
  await page.getByRole("textbox", { name: "Sprint name" }).fill("Undo release");
  await page.getByRole("textbox", { name: "Sprint name" }).press("Enter");
  await expect(page.getByTestId("plan-sprint")).toBeVisible();
  await page.getByRole("button", { name: "Back to sprints" }).click();
  const card = page.locator('[data-testid^="sprint-card-"]').filter({ has: page.getByRole("heading", { name: "Undo release", exact: true }) });
  const id = (await card.getAttribute("data-testid"))!.replace("sprint-card-", "");
  await addGoal(card, "Restore suggestion decisions");
  await providerMode("success", false, { prefix: fixture.prefix });
  const execution = await launchFromCard(page, card, request, id, "Find stories for these goals");
  await releaseProvider(execution.id);
  await expect(card.getByText(/4 suggestions ready/)).toBeVisible();
  await executionCleaned(execution.id);
  const published = await suggestions(request, id);
  const existing = published.find((row) => row.issue?.name === "Undo existing")!;
  const proposal = published.find((row) => row.proposedName === "Undo proposal")!;
  const dismissed = published.find((row) => row.issue?.name === "Undo ungrouped")!;
  await card.getByRole("button", { name: "Review in Plan →" }).click();
  await addEpic(page, "Undo epic", 3);
  await page.getByRole("button", { name: "Accept Undo existing", exact: true }).click();
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === existing.id)?.status).toBe("accepted");
  await expect(page.getByTestId("plan-undo")).toHaveAccessibleName("Undo Undo existing suggestion");
  await page.getByTestId("plan-undo").click();
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === existing.id)?.status).toBe("waiting");
  expect((await plannedStories(request, fixture.projectId)).find((row) => row.id === existing.issueId)?.sprintId).toBeNull();
  await expect(page.getByRole("button", { name: "Accept Undo existing", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "✦ Undo proposal", exact: true }).click();
  await page.getByRole("complementary", { name: "Selected ticket" }).getByRole("button", { name: "Create story", exact: true }).click();
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === proposal.id)?.status).toBe("accepted");
  const createdId = (await suggestions(request, id)).find((row) => row.id === proposal.id)?.issueId;
  expect(createdId).toBeTruthy();
  await expect(page.getByTestId("plan-undo")).toHaveAccessibleName("Undo Undo proposal suggestion");
  await page.getByTestId("plan-undo").click();
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === proposal.id)?.status).toBe("waiting");
  expect((await suggestions(request, id)).find((row) => row.id === proposal.id)).toMatchObject({ issueId: createdId, proposedName: null });
  expect((await plannedStories(request, fixture.projectId)).find((row) => row.id === createdId)).toMatchObject({ name: "Undo proposal", sprintId: null });
  await expect(page.getByRole("button", { name: "Accept Undo proposal", exact: true })).toHaveText(/Add/);
  await addEpic(page, "No epic", 1);
  await page.getByRole("button", { name: "Dismiss Undo ungrouped", exact: true }).click();
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === dismissed.id)?.status).toBe("dismissed");
  await expect(page.getByTestId("plan-undo")).toHaveAccessibleName("Undo Undo ungrouped suggestion");
  await page.getByTestId("plan-undo").click();
  await expect.poll(async () => (await suggestions(request, id)).find((row) => row.id === dismissed.id)?.status).toBe("waiting");
  await expect(page.getByRole("button", { name: "Dismiss Undo ungrouped", exact: true })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  expect((await suggestions(request, id)).filter((row) => row.status === "waiting")).toHaveLength(4);
  expect((await plannedStories(request, fixture.projectId)).find((row) => row.id === createdId)).toMatchObject({ name: "Undo proposal", sprintId: null });
});

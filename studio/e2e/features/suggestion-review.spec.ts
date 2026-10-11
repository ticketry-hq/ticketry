import { test, expect } from "../planning-module-test";
import { reviewReady } from "../suggestion-review-support";
import { featureSuite } from "./featureSuite";
import { moduleFixture, selectEpic, storyNamed } from "../planning-module-support";
import {
  addEpic, addGoal, executionCleaned, executionRecords, goals, launchFromCard,
  plannedStories, planningFixture, providerMode, releaseProvider, reopenSprints,
  sprintState, sprintThroughUi, suggestions,
} from "../sprint-planning-support";
import { captureLegacyProductApiRequests } from "../support";

featureSuite("suggestion-review", { test, isolation: "case" }, () => {
test("sprint goals, background publication, review decisions, Undo and refreshed suggestions persist", { tag: ["@case-agent-review"] }, async ({ page, request }, testInfo) => {
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


test("proposal validation, edited titles, decision Retry and Add all preserve goal attribution", { tag: ["@case-bulk-review"] }, async ({ page, request }, info) => {
  const fixture = await moduleFixture(request, "Review");
  const { id, card } = await sprintThroughUi(page, fixture, "Review release");
  await addGoal(card, "Removed goal");
  await addGoal(card, "Ship the reviewed scope");
  await card.getByRole("button", { name: "Remove goal: Removed goal", exact: true }).click();
  await providerMode("success", false, { prefix: fixture.prefix });
  const execution = await launchFromCard(page, card, request, id, "Find stories for these goals");
  await releaseProvider(execution.id);
  await expect(card.getByText(/4 suggestions ready/)).toBeVisible();
  await executionCleaned(execution.id);
  await card.getByRole("button", { name: "Review in Plan →" }).click();
  await selectEpic(page, fixture.epic.name);
  await expect(page.getByTestId("plan-sprint").getByText("1 goal", { exact: true })).toHaveAttribute("title", "G2. Ship the reviewed scope");
  const detail = page.getByRole("complementary", { name: "Selected ticket" });
  const proposal = page.getByRole("button", { name: "✦ Review proposal", exact: true });
  await proposal.press("Enter");
  await expect(proposal).toHaveAttribute("aria-pressed", "true");
  await expect(detail.getByRole("note")).toContainText("G2. Ship the reviewed scope");
  await expect(detail.getByRole("textbox", { name: "Epic", exact: true })).toHaveAttribute("readonly", "");
  await expect(detail.getByRole("textbox", { name: "Sprint", exact: true })).toHaveValue("Review release");
  const title = detail.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("   ");
  await expect(detail.getByRole("button", { name: "Create story", exact: true })).toBeDisabled();
  await title.fill("x".repeat(513));
  await expect(detail.getByRole("button", { name: "Create story", exact: true })).toBeDisabled();
  await title.fill("  Review custom Story  ");
  await page.keyboard.press("Escape");
  await proposal.press("Enter");
  await expect(title).toHaveValue("  Review custom Story  ");
  let reject = true;
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.postDataJSON()?.operationName === "UpdateSprintSuggestion") writes.push(request.postData()!);
  });
  await page.route("**/graphql", async (route) => {
    if (reject && route.request().postDataJSON()?.operationName === "UpdateSprintSuggestion") { reject = false; return route.abort("failed"); }
    return route.continue();
  });
  await detail.getByRole("button", { name: "Create story", exact: true }).click();
  await expect(page.getByTestId("plan-feedback")).toContainText("Couldn't accept");
  expect(await storyNamed(request, fixture.projectId, "Review custom Story")).toBeUndefined();
  expect((await suggestions(request, id)).every((row) => row.status === "waiting")).toBe(true);
  await page.getByRole("button", { name: /^Retry accepting .+ suggestion$/ }).click();
  await expect(detail.getByTestId("issue-name")).toContainText("Review custom Story");
  await expect(detail.getByRole("note")).toHaveCount(0);
  await expect(detail.getByRole("textbox", { name: "Title", exact: true })).toHaveCount(0);
  expect(await storyNamed(request, fixture.projectId, "Review custom Story")).toMatchObject({ parentId: fixture.epic.id, sprintId: id });
  expect(writes).toHaveLength(2);
  await page.unroute("**/graphql");
  await page.getByTestId("plan-undo").click();
  await expect.poll(async () => (await storyNamed(request, fixture.projectId, "Review custom Story"))?.sprintId).toBeNull();
  await page.getByRole("button", { name: "Close selected ticket", exact: true }).click();
  await expect(page.getByRole("button", { name: "✦ Review custom Story", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add all", exact: true }).click();
  await expect.poll(async () => (await suggestions(request, id)).filter((row) => row.status === "accepted").length).toBe(3);
  await expect(page.getByTestId("plan-sprint").getByText("✦ 1 to review", { exact: true })).toBeVisible();
  await expect(page.getByTestId("plan-sprint-items").getByText("G2", { exact: true })).toHaveCount(3);
  await selectEpic(page, "No epic");
  await page.getByRole("button", { name: "Add all", exact: true }).click();
  await expect.poll(async () => (await suggestions(request, id)).every((row) => row.status === "accepted")).toBe(true);
  await expect(page.getByTestId("plan-undo")).toHaveAccessibleName("Undo Review ungrouped suggestion");
  await page.getByTestId("plan-undo").click();
  await expect.poll(async () => (await suggestions(request, id)).filter((row) => row.status === "waiting").length).toBe(1);
  expect((await suggestions(request, id)).filter((row) => row.status === "accepted")).toHaveLength(3);
  await reopenSprints(page);
  await expect(card.getByText(/1 suggestions ready/)).toBeVisible();
  await card.getByRole("button", { name: "Review in Plan →" }).click();
  await selectEpic(page, "No epic");
  await expect(page.getByRole("button", { name: "✦ Review ungrouped", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("bulk-review.png"), fullPage: true });
});

test("Plan suggestion Undo restores existing and dismissed suggestions and retains an accepted proposal Story", { tag: ["@case-suggestion-undo"] }, async ({ page, request }) => {
  test.setTimeout(120_000);
  const { acknowledgeOnboarding } = await import("../support");
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

test("review detail supports Space, cancel, keyboard decisions and an empty review list", { tag: "@case-review-detail-empty" }, async ({ page, request }) => {
  const { id, fixture } = await reviewReady(page, request, "Detail");
  await expect(page.getByTestId("plan-undo")).toHaveCount(0);
  const row = page.getByRole("button", { name: "✦ Detail existing", exact: true });
  const detail = page.getByRole("complementary", { name: "Selected ticket" });
  await row.focus();
  await row.press("Space");
  await expect(detail.getByRole("button", { name: "Add to sprint", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  expect((await suggestions(request, id)).every((item) => item.status === "waiting")).toBe(true);
  await row.click();
  await detail.getByRole("button", { name: "Add to sprint", exact: true }).press("Enter");
  await expect.poll(async () => (await storyNamed(request, fixture.projectId, "Detail existing"))?.sprintId).toBe(id);
  await page.getByRole("button", { name: "Close selected ticket", exact: true }).click();
  await page.getByRole("button", { name: "✦ Detail proposal", exact: true }).click();
  await detail.getByRole("button", { name: "Dismiss", exact: true }).press("Enter");
  await expect(detail).toHaveCount(0);
  await page.getByRole("button", { name: "Dismiss Detail waiting", exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Add all", exact: true })).toHaveCount(0);
  await expect(page.locator("[data-plan-suggestion]")).toHaveCount(0);
  await selectEpic(page, "No epic");
  await page.getByRole("button", { name: "Dismiss Detail ungrouped", exact: true }).click();
  await expect(page.locator("[data-plan-suggestion]")).toHaveCount(0);
  expect((await suggestions(request, id)).map((item) => item.status).sort()).toEqual(["accepted", "dismissed", "dismissed", "dismissed"]);
  await page.reload();
  expect((await suggestions(request, id)).filter((item) => item.status === "waiting")).toEqual([]);
});

test("saved suggestion decisions recover failed refresh without replaying the write", { tag: "@case-review-refresh-recovery" }, async ({ page, request }) => {
  const { id } = await reviewReady(page, request, "Refresh");
  let readsFail = false;
  let writes = 0;
  await page.route("**/graphql", async (route) => {
    const operation = route.request().postDataJSON()?.operationName;
    if (operation === "UpdateSprintSuggestion") {
      writes++;
      const response = await route.fetch();
      readsFail = true;
      return route.fulfill({ response });
    }
    if (readsFail && ["SprintSuggestions", "PlanningGraph", "SprintSuggestionExecution"].includes(operation)) return route.abort("failed");
    return route.continue();
  });
  await page.getByRole("button", { name: "Accept Refresh existing", exact: true }).click();
  await expect(page.getByTestId("plan-feedback")).toContainText("Suggestion saved, but the view could not refresh.");
  expect((await suggestions(request, id)).find((item) => item.issue?.name === "Refresh existing")?.status).toBe("accepted");
  readsFail = false;
  await page.getByRole("button", { name: "Retry suggestion refresh", exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Retry suggestion refresh", exact: true })).toHaveCount(0);
  expect(writes).toBe(1);
  await page.unroute("**/graphql");
});

test("unconfirmed committed suggestions require read-only inspection before further decisions", { tag: "@case-review-inspect-recovery" }, async ({ page, request }) => {
  const { id, fixture } = await reviewReady(page, request, "Inspect");
  let readsFail = false;
  let writes = 0;
  await page.route("**/graphql", async (route) => {
    const operation = route.request().postDataJSON()?.operationName;
    if (operation === "UpdateSprintSuggestion") {
      writes++;
      await route.fetch(); // Commit the genuine write, then lose its response.
      readsFail = true;
      return route.abort("failed");
    }
    if (readsFail && ["SprintSuggestions", "PlanningGraph", "SprintSuggestionExecution"].includes(operation)) return route.abort("failed");
    return route.continue();
  });
  await page.getByRole("button", { name: "Accept Inspect proposal", exact: true }).click();
  await expect(page.getByTestId("plan-feedback")).toContainText("Could not confirm the suggestion decision. Inspect before trying again.");
  await expect(page.getByRole("button", { name: "Accept Inspect existing", exact: true })).toBeDisabled();
  expect(await storyNamed(request, fixture.projectId, "Inspect proposal")).toMatchObject({ sprintId: id });
  readsFail = false;
  await page.getByRole("button", { name: "Retry suggestion refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry suggestion refresh", exact: true })).toHaveCount(0);
  expect(writes).toBe(1);
  expect((await suggestions(request, id)).find((item) => item.issue?.name === "Inspect proposal")?.status).toBe("accepted");
  await page.unroute("**/graphql");
});

test("dismiss and Undo failures retry with authoritative membership and status", { tag: "@case-review-dismiss-undo-retry" }, async ({ page, request }) => {
  const { id, fixture } = await reviewReady(page, request, "Decision");
  let reject = true;
  await page.route("**/graphql", async (route) => {
    if (reject && route.request().postDataJSON()?.operationName === "UpdateSprintSuggestion") {
      reject = false;
      return route.abort("failed");
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "Dismiss Decision waiting", exact: true }).click();
  await expect(page.getByTestId("plan-feedback")).toContainText("Couldn't dismiss");
  expect((await suggestions(request, id)).find((item) => item.issue?.name === "Decision waiting")?.status).toBe("waiting");
  await page.getByRole("button", { name: "Retry dismissing Decision waiting suggestion", exact: true }).click();
  await expect.poll(async () => (await suggestions(request, id)).find((item) => item.issue?.name === "Decision waiting")?.status).toBe("dismissed");
  await page.getByRole("button", { name: "Accept Decision existing", exact: true }).click();
  await expect.poll(async () => (await storyNamed(request, fixture.projectId, "Decision existing"))?.sprintId).toBe(id);
  await expect(page.getByTestId("plan-undo")).toHaveAccessibleName("Undo Decision existing suggestion");
  await expect(page.getByTestId("plan-undo")).toBeEnabled();
  reject = true;
  await page.getByTestId("plan-undo").press("Enter");
  await expect(page.getByTestId("plan-feedback")).toContainText("Couldn't undo");
  expect((await storyNamed(request, fixture.projectId, "Decision existing"))?.sprintId).toBe(id);
  await page.getByRole("button", { name: "Retry undoing Decision existing suggestion", exact: true }).click();
  await expect.poll(async () => (await storyNamed(request, fixture.projectId, "Decision existing"))?.sprintId).toBeNull();
  expect((await suggestions(request, id)).find((item) => item.issue?.name === "Decision existing")?.status).toBe("waiting");
  await page.unroute("**/graphql");
});
test("stale review rerun failure and cancellation preserve decisions until a successful replacement", { tag: "@case-review-rerun-recovery" }, async ({ page, request }) => {
  const { id, card, fixture } = await reviewReady(page, request, "Rerun");
  await page.getByRole("button", { name: "Accept Rerun existing", exact: true }).click();
  await expect.poll(async () => (await suggestions(request, id)).find((item) => item.issue?.name === "Rerun existing")?.status).toBe("accepted");
  const accepted = (await suggestions(request, id)).find((item) => item.status === "accepted")!;
  await reopenSprints(page);
  await addGoal(card, "Changed review goal");
  await expect(card.getByText("Goals changed since the agent ran")).toBeVisible();
  await providerMode("delayed", true, { prefix: fixture.prefix });
  const cancelled = await launchFromCard(page, card, request, id, "Find stories again");
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card.getByText("Agent cancelled. Your goals are kept.")).toBeVisible();
  await executionCleaned(cancelled.id);
  expect((await suggestions(request, id)).find((item) => item.id === accepted.id)?.status).toBe("accepted");
  await providerMode("failure", true, { prefix: fixture.prefix });
  const failed = await launchFromCard(page, card, request, id, "Retry");
  await releaseProvider(failed.id);
  await expect(card.getByRole("alert")).toContainText("Check the provider configuration and retry.");
  await executionCleaned(failed.id);
  expect((await storyNamed(request, fixture.projectId, "Rerun existing"))?.sprintId).toBe(id);
  await providerMode("success", true, { prefix: fixture.prefix });
  const replaced = await launchFromCard(page, card, request, id, "Retry");
  await releaseProvider(replaced.id);
  await expect(card.getByText(/2 suggestions ready/)).toBeVisible();
  await executionCleaned(replaced.id);
  expect((await suggestions(request, id)).find((item) => item.id === accepted.id)?.status).toBe("accepted");
  expect((await suggestions(request, id)).filter((item) => item.status === "waiting")).toHaveLength(2);
  await reopenSprints(page);
  await expect(card.getByText(/2 suggestions ready/)).toBeVisible();
});
test("empty review publication and rerun retain an empty suggestion list", { tag: "@case-review-empty-rerun" }, async ({ page, request }) => {
  const fixture = await planningFixture(request, { prefix: "ZeroReview" });
  const { id, card } = await sprintThroughUi(page, fixture, "Zero review release");
  await addGoal(card, "Empty review goal");
  await providerMode("success", false, { prefix: fixture.prefix, empty: true });
  const first = await launchFromCard(page, card, request, id, "Find stories for these goals");
  await releaseProvider(first.id);
  await expect(card.getByText(/0 suggestions ready/)).toBeVisible();
  await executionCleaned(first.id);
  await card.getByRole("button", { name: "Review in Plan →", exact: true }).click();
  await selectEpic(page, fixture.epic.name);
  await expect(page.locator("[data-plan-suggestion]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add all", exact: true })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Selected ticket" })).toHaveCount(0);
  await expect(page.getByTestId("plan-undo")).toHaveCount(0);
  await reopenSprints(page);
  await addGoal(card, "Changed empty review goal");
  await expect(card.getByText("Goals changed since the agent ran")).toBeVisible();
  const rerun = await launchFromCard(page, card, request, id, "Find stories again");
  await releaseProvider(rerun.id);
  await expect(card.getByText(/0 suggestions ready/)).toBeVisible();
  await executionCleaned(rerun.id);
  expect(await suggestions(request, id)).toEqual([]);
  await reopenSprints(page);
  await expect(card.getByText(/0 suggestions ready/)).toBeVisible();
});
});

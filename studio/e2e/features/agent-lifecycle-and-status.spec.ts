import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { refuseNext } from "../module-manager-support";
import { featureSuite } from "./featureSuite";
import { configureCodexDefault, getWorkItem, getWorkflowCatalog, graphql, openWorkItem } from "../support";
import { cleanupWorkItemsFixture, fixture, names, openFeatureModule, seedProject, selectState } from "../work-items-migration-support";
import { prepareAgentProvider, agentStatus, waitForAgent, waitForAgentExit, terminateAgent } from "../agent-lifecycle-support";
import { observeConversationLaunch, releaseConversation } from "../conversation-support";
import type { RetryAutomationAttemptMutation } from "../../src/features/agents/status/generated/attempts.documents";
import { WorkItemEndedRunsDocument } from "../../src/features/agents/terminal/generated/workItemRunRestoration.documents";
import { UpdateWorkTrackerWorkItemDetailsDocument } from "../../src/features/work-items/generated/workItems.documents";
import { CreateWorkTrackerTransitionDocument, SetWorkTrackerAutoStartDocument, UpdateWorkTrackerTransitionDocument } from "../../src/features/workflows/generated/workflows.documents";

async function configureReviewDelivery(request: import("@playwright/test").APIRequestContext, handoff: boolean, autoStart: boolean) {
  let catalog = await getWorkflowCatalog(request, fixture.project.id);
  let story = catalog.issue_types.nodes.find(type => type.id === fixture.storyType.id)!;
  const destination = catalog.states.nodes.find(state => state.name === "Review")!;
  const edge = story.transitions.nodes.find(edge => edge.from_state === fixture.parent.state_id && edge.to_state === destination.id);
  const variables = { issueTypeId: story.id, fromStateId: fixture.parent.state_id!, toStateId: destination.id, agentAllowed: true, handoff, workflowRevision: story.workflow_revision };
  if (edge) await graphql(request, UpdateWorkTrackerTransitionDocument, variables);
  else await graphql(request, CreateWorkTrackerTransitionDocument, variables);
  catalog = await getWorkflowCatalog(request, fixture.project.id);
  story = catalog.issue_types.nodes.find(type => type.id === fixture.storyType.id)!;
  await graphql(request, SetWorkTrackerAutoStartDocument, { issueTypeId: story.id, stateId: destination.id, workflowRevision: story.workflow_revision, autoStart });
  return destination;
}

featureSuite("agent-lifecycle-and-status", { isolation: "case" }, () => {
  test.beforeAll(async ({ request }) => { await seedProject(request); await configureCodexDefault(request); });
  test.afterAll(cleanupWorkItemsFixture);

  test("keeps empty lifecycle and automation holdings silent after reload", { tag: "@case-lifecycle-empty" }, async ({ page, request }) => {
    await openFeatureModule(page, names.module);
    const row = page.getByRole("treeitem", { name: new RegExp(fixture.blocker.key) });
    await expect(row.getByTestId("agent-state-badge")).toHaveCount(0);
    await expect(row.getByTestId("automation-delivery-chicklet")).toHaveCount(0);
    await expect(row.getByTestId("automation-failure-chicklet")).toHaveCount(0);
    await expect(row.getByRole("button", { name: /Claude.*waiting|Claude startup needs attention/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: names.module, exact: true }).last().locator('[title="Agent is actively working"]')).toHaveCount(0);
    expect((await agentStatus(request, fixture.project.id)).agent_run_holdings).toEqual([]);
    await page.reload();
    await expect(row.getByTestId("agent-state-badge")).toHaveCount(0);
    expect((await agentStatus(request, fixture.project.id)).automation_attempts).toEqual([]);
  });

  test("projects a real provider lifecycle into task and module badges across reload", { tag: "@case-lifecycle-provider-status" }, async ({ page, request }) => {
    test.setTimeout(60_000);
    await configureReviewDelivery(request, false, false);
    await prepareAgentProvider("success", ["Review"]);
    await openFeatureModule(page, names.module);
    await openWorkItem(page, names.parent);
    const launch = await observeConversationLaunch(page, () => page.getByRole("button", { name: "Run item", exact: true }).click());
    await waitForAgent(request, fixture.project.id, fixture.parent.id);
    const row = page.getByRole("treeitem", { name: new RegExp(fixture.parent.key) });
    await expect(row.getByTestId("agent-state-badge")).toHaveAttribute("data-state", "active").catch(async error => { console.log("LIFECYCLE_CANONICAL", JSON.stringify(await agentStatus(request, fixture.project.id))); throw error; });
    const module = page.getByRole("tab", { name: names.module, exact: true }).last();
    await expect(module.locator('[title="Agent is actively working"]')).toBeVisible();
    await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
    await expect(page.getByRole("region", { name: "Module Manager" }).getByRole("button", { name: `Inspect ${names.module}`, exact: true }).locator('[title="Agent is actively working"]')).toBeVisible();
    await page.getByRole("region", { name: "Module Manager" }).getByRole("button", { name: "Close Module Manager", exact: true }).click();
    await page.reload();
    await expect(row.getByTestId("agent-state-badge")).toHaveAttribute("data-state", "active");
    await releaseConversation(launch.runId);
    await expect.poll(async () => { try { return await readFile(join(process.env.TICKETRY_E2E_PROVIDER_DIR!, `${launch.runId}.mcp.log`), "utf8"); } catch { return ""; } }).toContain('"ok":true');
    await waitForAgentExit(request, fixture.parent.id, launch.runId);
    await expect(module.locator('[title="Agent is actively working"]')).toHaveCount(0);
    expect((await getWorkItem(request, fixture.parent.id)).state_id).toBe(fixture.states.find(state => state.name === "Review")!.id);
    expect(await readFile(join(process.env.TICKETRY_E2E_PROVIDER_DIR!, `${launch.runId}.hooks.log`), "utf8")).toContain("Stop");
    expect(await readFile(join(process.env.TICKETRY_E2E_PROVIDER_DIR!, `${launch.runId}.mcp.log`), "utf8")).toContain('"ok":true');
    await page.reload();
    await expect(module.locator('[title="Agent is actively working"]')).toHaveCount(0);
  });

  test("reconnect replay converges an offline rename and the agent run that settled while offline", { tag: "@case-lifecycle-status-reconnect" }, async ({ page, request, context }) => {
    await openFeatureModule(page, names.module);
    await openWorkItem(page, names.moving);
    test.setTimeout(60_000);
    await prepareAgentProvider();
    const launch = await observeConversationLaunch(page, () => page.getByRole("button", { name: "Run item", exact: true }).click());
    await waitForAgent(request, fixture.project.id, fixture.moving.id);
    await page.getByRole("tablist", { name: "Workspace tabs" }).getByRole("tab", { name: "Details", exact: true }).click();
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await graphql(request, UpdateWorkTrackerWorkItemDetailsDocument, { id: fixture.moving.id, name: "Lifecycle replayed" });
    await releaseConversation(launch.runId);
    await waitForAgentExit(request, fixture.moving.id, launch.runId);
    const accepted = page.waitForEvent("console", { predicate: message => message.text().includes("subscription-accepted") });
    await context.setOffline(false);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
    await accepted;
    await expect(page.getByRole("treeitem", { name: /Lifecycle replayed/ })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: new RegExp(names.moving) })).toHaveCount(0);
    const replayed = page.getByRole("treeitem", { name: /Lifecycle replayed/ });
    await expect(replayed.getByTestId("agent-state-badge")).toHaveCount(0);
    expect((await agentStatus(request, fixture.project.id)).agent_run_holdings.filter(run => run.agent_run_id === launch.runId)).toEqual([]);
    await page.reload();
    await expect(replayed).toBeVisible();
    await expect(replayed.getByTestId("agent-state-badge")).toHaveCount(0);
  });

  test("says whether an automated transition continued a session or started a fresh one", { tag: "@case-lifecycle-automation-delivery" }, async ({ page, request }) => {
    await prepareAgentProvider();
    test.setTimeout(90_000);
    const destination = await configureReviewDelivery(request, true, true);
    await openFeatureModule(page, names.module);
    await openWorkItem(page, names.parent);
    const launch = await observeConversationLaunch(page, () => page.getByRole("button", { name: "Run item", exact: true }).click());
    await waitForAgent(request, fixture.project.id, fixture.parent.id);
    await openWorkItem(page, names.parent);
    await page.getByRole("tablist", { name: "Workspace tabs" }).getByRole("tab", { name: "Details", exact: true }).click();
    await selectState(page, destination.name);
    const continued = page.getByRole("treeitem", { name: new RegExp(fixture.parent.key) }).getByTestId("automation-delivery-chicklet");
    await expect(continued).toHaveAttribute("data-delivery-mode", "continued");
    await expect(continued).toContainText("Continued");
    await expect(continued).toContainText("This transition continued the Story's existing agent session.");
    await openWorkItem(page, names.moving);
    await selectState(page, destination.name);
    const fresh = page.getByRole("treeitem", { name: new RegExp(fixture.moving.key) }).getByTestId("automation-delivery-chicklet");
    await expect(fresh).toHaveAttribute("data-delivery-mode", "started_fresh");
    await expect(fresh).toContainText("Fresh");
    await expect(fresh).toContainText("This transition started a fresh agent session.");
    await expect(page.getByRole("treeitem", { name: new RegExp(fixture.blocker.key) }).getByTestId("automation-delivery-chicklet")).toHaveCount(0);
    await page.reload();
    // Reload rebuilds holdings from the canonical status snapshot alone, so
    // both settled deliveries must come back from durable attempts.
    await expect(continued).toHaveAttribute("data-delivery-mode", "continued");
    await expect(continued).toContainText("Continued");
    await expect(continued).toContainText("This transition continued the Story's existing agent session.");
    await expect(fresh).toHaveAttribute("data-delivery-mode", "started_fresh");
    await expect(fresh).toContainText("Fresh");
    await expect(fresh).toContainText("This transition started a fresh agent session.");
    await expect(page.getByRole("treeitem", { name: new RegExp(fixture.blocker.key) }).getByTestId("automation-delivery-chicklet")).toHaveCount(0);
    await releaseConversation(launch.runId);
    for (const run of (await agentStatus(request, fixture.project.id)).agent_run_holdings.filter(run => run.task_id === fixture.moving.id)) await releaseConversation(run.agent_run_id);
  });
  test("recovers a failed provider handoff through the rendered Retry control", { tag: "@case-lifecycle-automation-retry" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    const destination = await configureReviewDelivery(request, true, true);
    await prepareAgentProvider("failure", [], true);
    await openFeatureModule(page, names.module);
    await openWorkItem(page, names.parent);
    const launch = await observeConversationLaunch(page, () => page.getByRole("button", { name: "Run item", exact: true }).click());
    await waitForAgent(request, fixture.project.id, fixture.parent.id);
    await page.getByRole("tablist", { name: "Workspace tabs" }).getByRole("tab", { name: "Details", exact: true }).click();
    await selectState(page, destination.name);
    await expect.poll(async () => (await agentStatus(request, fixture.project.id)).automation_attempts.find(attempt => attempt.work_item_id === fixture.parent.id)?.status).toBe("pending");
    await releaseConversation(launch.runId);
    await expect.poll(async () => (await agentStatus(request, fixture.project.id)).automation_attempts.find(attempt => attempt.work_item_id === fixture.parent.id)?.status, { timeout: 25_000 }).toBe("failed");
    const failedAttempt = (await agentStatus(request, fixture.project.id)).automation_attempts.find(attempt => attempt.work_item_id === fixture.parent.id)!;
    expect(failedAttempt.attempt_id).toBeTruthy();
    const row = page.getByRole("treeitem", { name: new RegExp(fixture.parent.key) });
    const failure = row.getByTestId("automation-failure-chicklet");
    await expect(failure).toBeVisible();
    await waitForAgentExit(request, fixture.parent.id, launch.runId);
    const historical = await graphql(request, WorkItemEndedRunsDocument, { issueId: fixture.parent.id, issueType: "task", scopes: ["task"], limit: 50 });
    const ended = historical.work_item.nodes[0]?.ended_runs.nodes.find(run => run.agent_run_id === launch.runId);
    expect(ended?.status).toBe("exited");
    expect(ended?.exit_code).toBe(23);
    expect(ended?.ended_at).toBeTruthy();
    expect((await agentStatus(request, fixture.project.id)).agent_run_holdings.filter(run => run.agent_run_id === launch.runId)).toEqual([]);
    await expect(row.getByTestId("agent-state-badge")).toHaveCount(0);
    const module = page.getByRole("tab", { name: names.module, exact: true }).last();
    const liveChips = '[title="Agent is actively working"], [title="Agent is waiting for your input"], [title="A permission decision is pending"], [title="Agent session reported an error"]';
    await expect(module.locator(liveChips)).toHaveCount(0);
    await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
    await expect(page.getByRole("region", { name: "Module Manager" }).getByRole("button", { name: `Inspect ${names.module}`, exact: true }).locator(liveChips)).toHaveCount(0);
    await page.getByRole("region", { name: "Module Manager" }).getByRole("button", { name: "Close Module Manager", exact: true }).click();
    const retry = failure.getByRole("button", { name: "Retry failed automated launch" });
    await expect(retry).toBeEnabled();
    const restore = await refuseNext(page, "RetryAutomationAttempt");
    await retry.click();
    await expect(retry).toHaveText("Retry failed");
    await restore();
    await prepareAgentProvider();
    const response = page.waitForResponse(response => response.url().endsWith("/graphql") && response.request().postDataJSON()?.operationName === "RetryAutomationAttempt" && response.request().postDataJSON()?.variables?.attemptId === failedAttempt.attempt_id);
    await retry.click();
    const accepted = await response;
    const envelope = await accepted.json() as { data?: RetryAutomationAttemptMutation; errors?: unknown[] };
    expect(envelope.errors, JSON.stringify(envelope)).toBeUndefined();
    const successor = envelope.data!.retry_automation_attempt;
    expect(successor.attempt_id).not.toBe(failedAttempt.attempt_id);
    expect(successor.retry_of_attempt_id).toBe(failedAttempt.attempt_id);
    expect(successor.root_attempt_id).toBe(failedAttempt.root_attempt_id);
    expect(successor.work_item_id).toBe(fixture.parent.id);
    expect(successor.status).toBe("pending");
    // The public query keeps a settled success only as durable delivery
    // evidence. Pair the lineage's resolution with a different real working
    // run to establish recovery.
    await expect.poll(async () => (await agentStatus(request, fixture.project.id)).automation_attempts.filter(attempt => attempt.work_item_id === fixture.parent.id).map(attempt => [attempt.attempt_id, attempt.status, attempt.delivery_mode]), { timeout: 25_000 }).toEqual([[successor.attempt_id, "succeeded", "started_fresh"]]);
    await expect(failure).toHaveCount(0);
    const recoveredRun = await waitForAgent(request, fixture.project.id, fixture.parent.id);
    expect(recoveredRun.agent_run_id).not.toBe(launch.runId);
    await expect(row.getByTestId("agent-state-badge")).toHaveAttribute("data-state", "active");
    await expect(module.locator('[title="Agent is actively working"]')).toBeVisible();
    expect((await getWorkItem(request, fixture.parent.id)).state_id).toBe(destination.id);
    await page.reload();
    await expect(failure).toHaveCount(0);
    expect((await agentStatus(request, fixture.project.id)).automation_attempts.filter(attempt => attempt.work_item_id === fixture.parent.id && attempt.status !== "succeeded")).toEqual([]);
    for (const run of (await agentStatus(request, fixture.project.id)).agent_run_holdings.filter(run => run.task_id === fixture.parent.id)) { await releaseConversation(run.agent_run_id); await terminateAgent(request, run.agent_run_id); }
  });

});

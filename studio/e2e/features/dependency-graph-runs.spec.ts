import { expect, test } from "@playwright/test";
import { featureSuite } from "./featureSuite";
import { ExecutionGraphRunHoldingDocument, UpdateExecutionGraphRunDocument } from "../../src/features/execution/generated/graphRuns.documents";
import { PlanningGraphDocument } from "../../src/features/planning-graph/generated/planningGraph.documents";
import { SetWorkTrackerSubtreeRunDocument } from "../../src/features/workflows/generated/workflows.documents";
import { TransitionWorkTrackerWorkItemDocument, SetWorkTrackerBlockersDocument } from "../../src/features/work-items/generated/workItems.documents";
import { callMcpTool, cleanupWorkItemsFixture, fixture, names, openFeatureModule, seedProject } from "../work-items-migration-support";
import { createProject, createWorkItem, configureCodexDefault, getWorkflowCatalog, graphql, openWorkItem } from "../support";
import { prepareAgentProvider, agentStatus, waitForAgent, waitForAgentExit, terminateAgent } from "../agent-lifecycle-support";
import { releaseConversation } from "../conversation-support";
import { emptyVisit, reloadPlan, selectEpic, storyRow } from "../planning-module-support";
import { UpdateWorkTrackerWorkItemDetailsDocument } from "../../src/features/work-items/generated/workItems.documents";
import { documentSource } from "../../src/graphql-foundation/typedDocument";
import { refuseNext } from "../module-manager-support";

featureSuite("dependency-graph-runs", { isolation: "case" }, () => {
  test.beforeAll(async ({ request }) => { await seedProject(request); await configureCodexDefault(request); });
  test.afterAll(cleanupWorkItemsFixture);

  test("reads the persisted subtree and planning projection without launching work", { tag: "@case-graph-factual-planning" }, async ({ page, request }) => {
    await openFeatureModule(page, names.module);
    await openWorkItem(page, names.hierarchyParent);
    const before = await graphql(request, ExecutionGraphRunHoldingDocument, { rootId: fixture.hierarchyParent.id });
    const graph = await callMcpTool<{ root_id: string; nodes: Array<{ id: string; parent_id: string | null; blocked_by: string[] }> }>("get_dependency_graph", { root_task_id: fixture.hierarchyParent.id });
    expect(graph.root_id).toBe(fixture.hierarchyParent.id);
    expect(graph.nodes.map(node => node.id)).toContain(fixture.hierarchyChild.id);
    expect(graph.nodes.find(node => node.id === fixture.hierarchyChild.id)?.parent_id).toBe(fixture.hierarchyParent.id);
    const planning = await graphql(request, PlanningGraphDocument, { projectId: fixture.project.id });
    expect(planning.workItems.nodes.map(node => node.id)).toContain(fixture.hierarchyParent.id);
    expect(planning.modules.nodes.map(node => node.id)).toContain(fixture.module.id);
    expect(await graphql(request, ExecutionGraphRunHoldingDocument, { rootId: fixture.hierarchyParent.id })).toEqual(before);
    await page.reload();
    expect((await callMcpTool<{ nodes: Array<{ id: string }> }>("get_dependency_graph", { root_task_id: fixture.hierarchyParent.id })).nodes.map(node => node.id)).toContain(fixture.hierarchyChild.id);
    expect(await graphql(request, ExecutionGraphRunHoldingDocument, { rootId: fixture.hierarchyParent.id })).toEqual(before);
  });

  test("reports a childless factual graph and keeps disabled campaign controls harmless", { tag: "@case-graph-empty-disabled" }, async ({ page, request }) => {
    await openFeatureModule(page, names.module);
    await openWorkItem(page, names.hierarchyParent);
    const graph = await callMcpTool<{ error: string }>("get_dependency_graph", { root_task_id: fixture.blocker.id });
    expect(graph.error).toBe("graph_empty");
    const details = page.getByRole("region", { name: "Details" });
    const run = details.getByRole("button", { name: "Run subtree", exact: true });
    await expect(run).toBeDisabled();
    await expect(run).toHaveAttribute("title", "Subtree execution is not available in this item's current state.");
    expect((await graphql(request, ExecutionGraphRunHoldingDocument, { rootId: fixture.hierarchyParent.id })).graph_run_holding.nodes).toEqual([]);
  });

  test("recovers a refused campaign press and persists serial and parallel empty frontiers", { tag: "@case-graph-empty-recovery" }, async ({ page, request }) => {
    const catalog = await getWorkflowCatalog(request, fixture.project.id);
    const root = await createWorkItem(request, fixture.project.id, { name: "Empty graph campaign", parent_id: fixture.module.id, issue_type_id: fixture.storyType.id });
    expect(root.state_id, "the campaign root state").toBeTruthy();
    const story = catalog.issue_types.nodes.find(type => type.id === fixture.storyType.id)!;
    await graphql(request, SetWorkTrackerSubtreeRunDocument, { issueTypeId: story.id, stateId: root.state_id!, workflowRevision: story.workflow_revision, enabled: true });
    const done = catalog.states.nodes.find(state => state.group === "completed")!;
    const child = await createWorkItem(request, fixture.project.id, { name: "Finished graph child", parent_id: root.id, issue_type_id: fixture.implementationType.id });
    await graphql(request, TransitionWorkTrackerWorkItemDocument, { id: child.id, targetStateId: catalog.states.nodes.find(state => state.name === "Review")!.id });
    await graphql(request, TransitionWorkTrackerWorkItemDocument, { id: child.id, targetStateId: done.id });
    const requestedModes: Array<string | null> = [];
    page.on("request", incoming => {
      if (!incoming.url().endsWith("/graphql")) return;
      const body = incoming.postDataJSON();
      if (["CreateExecutionGraphRun", "UpdateExecutionGraphRun"].includes(body?.operationName)) requestedModes.push(body.variables?.executionMode ?? null);
    });
    await openFeatureModule(page, names.module);
    await openWorkItem(page, root.name);
    const details = page.getByRole("region", { name: "Details" });
    const serial = details.getByRole("button", { name: "Run subtree serially", exact: true });
    const parallel = details.getByRole("button", { name: "Run subtree", exact: true });
    await expect(serial).toBeVisible();
    await expect(parallel).toBeVisible();
    const restore = await refuseNext(page, "CreateExecutionGraphRun");
    await serial.click();
    await expect(page.getByRole("alert").filter({ hasText: "Serial subtree execution could not be started" })).toBeVisible();
    await restore();
    await serial.click();
    await expect.poll(async () => (await graphql(request, ExecutionGraphRunHoldingDocument, { rootId: root.id })).graph_run_holding.nodes[0]?.execution_mode).toBe("serial");
    await expect(page.getByRole("alert").filter({ hasText: "every remaining work item is finished, blocked, or already running." })).toBeVisible();
    await parallel.click();
    await expect.poll(async () => (await graphql(request, ExecutionGraphRunHoldingDocument, { rootId: root.id })).graph_run_holding.nodes[0]?.execution_mode).toBe("parallel");
    expect(requestedModes).toEqual(["serial", "serial", null]);
    await page.reload();
    await openWorkItem(page, root.name);
    await expect(page.getByRole("region", { name: "Details" }).getByRole("button", { name: "Run subtree serially", exact: true })).toBeVisible();
    expect((await graphql(request, ExecutionGraphRunHoldingDocument, { rootId: root.id })).graph_run_holding.nodes[0]?.execution_mode).toBe("parallel");
  });
  test("sends serial and parallel subtree launches through the visible controls", { tag: "@case-graph-serial-parallel" }, async ({ page, request }) => {
    test.setTimeout(60_000);
    await prepareAgentProvider();
    const catalog = await getWorkflowCatalog(request, fixture.project.id);
    const root = await createWorkItem(request, fixture.project.id, { name: "Live graph campaign", parent_id: fixture.module.id, issue_type_id: fixture.storyType.id });
    const child = await createWorkItem(request, fixture.project.id, { name: "Live graph child", parent_id: root.id, issue_type_id: fixture.implementationType.id });
    const story = catalog.issue_types.nodes.find(type => type.id === fixture.storyType.id)!;
    await graphql(request, SetWorkTrackerSubtreeRunDocument, { issueTypeId: story.id, stateId: root.state_id!, workflowRevision: story.workflow_revision, enabled: true });
    const requestedModes: Array<string | null> = [];
    page.on("request", incoming => {
      if (!incoming.url().endsWith("/graphql")) return;
      const body = incoming.postDataJSON();
      if (["CreateExecutionGraphRun", "UpdateExecutionGraphRun"].includes(body?.operationName)) requestedModes.push(body.variables?.executionMode ?? null);
    });
    await openFeatureModule(page, names.module);
    await openWorkItem(page, root.name);
    const details = page.getByRole("region", { name: "Details" });
    const serial = details.getByRole("button", { name: "Run subtree serially", exact: true });
    const parallel = details.getByRole("button", { name: "Run subtree", exact: true });
    await expect(serial).toBeVisible();
    await expect(parallel).toBeVisible();
    await serial.click();
    await expect(page.getByRole("status").filter({ hasText: "Serial subtree run started." })).toBeVisible();
    const first = await waitForAgent(request, fixture.project.id, child.id);
    await expect(details.getByRole("button", { name: "Open subtree run" })).toBeVisible();
    await page.reload();
    await openWorkItem(page, root.name);
    await expect(details.getByRole("button", { name: "Open subtree run" })).toBeVisible();
    await details.getByRole("button", { name: "Open subtree run" }).click();
    await expect(page.getByTestId("terminal-host-wrapper")).toBeVisible();
    await expect(page.getByTestId("issue-name")).toContainText(child.name);
    await openWorkItem(page, root.name);
    await page.getByRole("tablist", { name: "Workspace tabs" }).getByRole("tab", { name: "Details", exact: true }).click();
    await releaseConversation(first.agent_run_id);
    
    await waitForAgentExit(request, child.id, first.agent_run_id);
    const parallelRequested = page.waitForResponse(response => response.url().endsWith("/graphql") && ["CreateExecutionGraphRun", "UpdateExecutionGraphRun"].includes(response.request().postDataJSON()?.operationName) && response.request().postDataJSON()?.variables?.executionMode == null);
    await parallel.click();
    await parallelRequested;
    expect(requestedModes).toEqual(["serial", null]);
    const status = await agentStatus(request, fixture.project.id);
    for (const run of status.agent_run_holdings.filter(run => run.task_id === child.id && run.effective_state !== "exited")) await releaseConversation(run.agent_run_id);
    expect((await graphql(request, ExecutionGraphRunHoldingDocument, { rootId: root.id })).graph_run_holding.nodes[0]?.execution_mode).toBe("parallel");
  });

  test("schedules direct children, holds the serial frontier and respects external blockers until Review", { tag: "@case-graph-frontier-blockers" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    await prepareAgentProvider();
    const catalog = await getWorkflowCatalog(request, fixture.project.id);
    const root = await createWorkItem(request, fixture.project.id, { name: "Frontier campaign", parent_id: fixture.module.id, issue_type_id: fixture.storyType.id });
    const first = await createWorkItem(request, fixture.project.id, { name: "Frontier first", parent_id: root.id, issue_type_id: fixture.implementationType.id });
    const next = await createWorkItem(request, fixture.project.id, { name: "Frontier next", parent_id: root.id, issue_type_id: fixture.implementationType.id });
    const blocked = await createWorkItem(request, fixture.project.id, { name: "Frontier blocked", parent_id: root.id, issue_type_id: fixture.implementationType.id });
    const external = await createWorkItem(request, fixture.project.id, { name: "External graph blocker", parent_id: fixture.module.id, issue_type_id: fixture.implementationType.id });
    const grandchild = await createWorkItem(request, fixture.project.id, { name: "Frontier grandchild", parent_id: first.id, issue_type_id: fixture.implementationType.id });
    await graphql(request, SetWorkTrackerBlockersDocument, { id: blocked.id, blockedByIds: [external.id] });
    const story = catalog.issue_types.nodes.find(type => type.id === fixture.storyType.id)!;
    await graphql(request, SetWorkTrackerSubtreeRunDocument, { issueTypeId: story.id, stateId: root.state_id!, workflowRevision: story.workflow_revision, enabled: true });
    await openFeatureModule(page, names.module);
    await openWorkItem(page, root.name);
    await page.getByRole("region", { name: "Details" }).getByRole("button", { name: "Run subtree serially", exact: true }).click();
    const firstRun = await waitForAgent(request, fixture.project.id, first.id);
    const before = await agentStatus(request, fixture.project.id);
    expect(before.agent_run_holdings.filter(run => [next.id, blocked.id, grandchild.id].includes(run.task_id ?? ""))).toEqual([]);
    const held = await graphql(request, UpdateExecutionGraphRunDocument, { rootId: root.id, executionMode: "serial" });
    expect(held.graph_run_result.launched).toEqual([]);
    const review = catalog.states.nodes.find(state => state.name === "Review")!;
    await graphql(request, TransitionWorkTrackerWorkItemDocument, { id: first.id, targetStateId: review.id });
    await releaseConversation(firstRun.agent_run_id);
    await terminateAgent(request, firstRun.agent_run_id);
    const advanced = await graphql(request, UpdateExecutionGraphRunDocument, { rootId: root.id, executionMode: "serial" });
    expect([...advanced.graph_run_result.launched, ...(await agentStatus(request, fixture.project.id)).agent_run_holdings.map(run => run.task_id)]).toContain(next.id);
    const nextRun = await waitForAgent(request, fixture.project.id, next.id);
    expect((await agentStatus(request, fixture.project.id)).agent_run_holdings.filter(run => [blocked.id, grandchild.id].includes(run.task_id ?? ""))).toEqual([]);
    await graphql(request, TransitionWorkTrackerWorkItemDocument, { id: external.id, targetStateId: review.id });
    await graphql(request, TransitionWorkTrackerWorkItemDocument, { id: next.id, targetStateId: review.id });
    await releaseConversation(nextRun.agent_run_id);
    await terminateAgent(request, nextRun.agent_run_id);
    const released = await graphql(request, UpdateExecutionGraphRunDocument, { rootId: root.id, executionMode: "serial" });
    expect([...released.graph_run_result.launched, ...(await agentStatus(request, fixture.project.id)).agent_run_holdings.map(run => run.task_id)]).toContain(blocked.id);
    const blockedRun = await waitForAgent(request, fixture.project.id, blocked.id);
    expect((await agentStatus(request, fixture.project.id)).agent_run_holdings.filter(run => run.task_id === grandchild.id)).toEqual([]);
    const graph = await callMcpTool<{ nodes: Array<{ id: string }> }>("get_dependency_graph", { root_task_id: root.id });
    expect(graph.nodes.map(node => node.id)).toContain(grandchild.id);
    await releaseConversation(blockedRun.agent_run_id);
    await terminateAgent(request, blockedRun.agent_run_id);
    const parallelRoot = await createWorkItem(request, fixture.project.id, { name: "Parallel frontier campaign", parent_id: fixture.module.id, issue_type_id: fixture.storyType.id });
    const parallelFirst = await createWorkItem(request, fixture.project.id, { name: "Parallel first", parent_id: parallelRoot.id, issue_type_id: fixture.implementationType.id });
    const parallelSecond = await createWorkItem(request, fixture.project.id, { name: "Parallel second", parent_id: parallelRoot.id, issue_type_id: fixture.implementationType.id });
    await openFeatureModule(page, names.module);
    await openWorkItem(page, parallelRoot.name);
    await expect(page.getByRole("region", { name: "Details" }).getByRole("button", { name: "Run subtree", exact: true })).toBeEnabled();
    const keyboard = page.waitForResponse(response => response.url().endsWith("/graphql") && response.request().postDataJSON()?.operationName === "CreateExecutionGraphRun");
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("Meta+Enter");
    const parallelResponse = await keyboard;
    const parallelEnvelope = await parallelResponse.json();
    expect(parallelEnvelope.errors, JSON.stringify(parallelEnvelope)).toBeUndefined();
    expect(parallelEnvelope.data.graph_run_result.launched).toEqual(expect.arrayContaining([parallelFirst.id, parallelSecond.id]));
    const parallelRuns = await Promise.all([waitForAgent(request, fixture.project.id, parallelFirst.id), waitForAgent(request, fixture.project.id, parallelSecond.id)]);
    expect(new Set(parallelRuns.map(run => run.agent_run_id)).size).toBe(2);
    for (const run of parallelRuns) { await releaseConversation(run.agent_run_id); await terminateAgent(request, run.agent_run_id); }
    await page.reload();
    expect((await graphql(request, ExecutionGraphRunHoldingDocument, { rootId: root.id })).graph_run_holding.nodes[0]?.execution_mode).toBe("serial");
  });

  test("reports the browser adapter's MCP execution and reset refusal without changing a campaign", { tag: "@case-graph-mcp-reset" }, async ({ page, request }) => {
    await openFeatureModule(page, names.module);
    const before = await graphql(request, ExecutionGraphRunHoldingDocument, { rootId: fixture.hierarchyParent.id });
    const first = await callMcpTool<{ error: string }>("execute_dependency_graph", { root_task_id: fixture.hierarchyParent.id });
    expect(first.error).toBe("execution_reconciliation_unavailable");
    const reset = await callMcpTool<{ error: string }>("execute_dependency_graph", { root_task_id: fixture.hierarchyParent.id, reset: true });
    expect(reset.error).toBe("execution_reconciliation_unavailable");
    await page.reload();
    expect(await graphql(request, ExecutionGraphRunHoldingDocument, { rootId: fixture.hierarchyParent.id })).toEqual(before);
  });

  test("recovers a refused planning read and represents an empty project without arming execution", { tag: "@case-graph-projection-empty-recovery" }, async ({ page, request }) => {
    const project = await createProject(request, { name: "Empty graph projection", slug: "EGP", description: "" });
    await openFeatureModule(page, names.module);
    const restore = await refuseNext(page, "PlanningGraph");
    const read = () => page.evaluate(async ({ query, projectId }) => {
      const response = await fetch("/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, operationName: "PlanningGraph", variables: { projectId } }) });
      return response.json();
    }, { query: documentSource(PlanningGraphDocument), projectId: project.id });
    expect((await read()).errors[0].message).toBe("Injected PlanningGraph refusal");
    await restore();
    const recovered = await read();
    expect(recovered.errors).toBeUndefined();
    expect(recovered.data.workItems.nodes).toEqual([]);
    expect(recovered.data.modules.nodes).toEqual([]);
    await page.reload();
    expect((await graphql(request, PlanningGraphDocument, { projectId: project.id })).workItems.nodes).toEqual([]);
    expect((await graphql(request, ExecutionGraphRunHoldingDocument, { rootId: fixture.hierarchyParent.id })).graph_run_holding.nodes).toEqual([]);
  });

  test("shares authoritative planning records with the production Plan projection", { tag: "@case-graph-apollo-projection" }, async ({ page, request }) => {
    const planning = { projectId: fixture.project.id, epic: fixture.module, stories: [fixture.parent, fixture.moving, fixture.blocker], prefix: "Graph projection" };
    await emptyVisit(page, planning, "Graph projection sprint");
    await selectEpic(page, planning.epic.name);
    const story = planning.stories[0]!;
    await expect(storyRow(page.getByTestId("plan-backlog"), story.name)).toBeVisible();
    await graphql(request, UpdateWorkTrackerWorkItemDetailsDocument, { id: story.id, name: "Graph projection renamed" });
    await page.reload();
    await reloadPlan(page, "Graph projection sprint", planning.epic.name);
    await expect(storyRow(page.getByTestId("plan-backlog"), "Graph projection renamed")).toBeVisible();
    const graph = await graphql(request, PlanningGraphDocument, { projectId: planning.projectId });
    expect(graph.workItems.nodes.find(row => row.id === story.id)?.name).toBe("Graph projection renamed");
    expect((await graphql(request, ExecutionGraphRunHoldingDocument, { rootId: story.id })).graph_run_holding.nodes).toEqual([]);
  });

});

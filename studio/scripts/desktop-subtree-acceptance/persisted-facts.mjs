import { callSocketMcpTool } from "../mcp-socket-client.mjs";

/**
 * Persisted Ticketry facts for the subtree journey, read only through reads
 * the product already ships: the graph-run holding, the live run holdings,
 * each work item's ended runs (the WorkItem model's `agentRuns` relation),
 * and `get_dependency_graph` on the global MCP socket. Writes are limited to
 * fixture setup through existing work-item operations. Nothing here replaces
 * a product response.
 */

/** Executes one operation over the app's native `graphql_execute` transport. */
export async function nativeGraphql(browser, query, variables = {}) {
  const response = await browser.executeAsync((request, done) => {
    window.__TAURI_INTERNALS__.invoke("TauRPC__graphql_execute", { request_json: JSON.stringify(request) })
      .then((raw) => done(JSON.parse(raw)))
      .catch((error) => done({ transportError: String(error) }));
  }, { query, variables });
  if (response.transportError) throw new Error(`native GraphQL transport failed: ${response.transportError}`);
  if (response.errors) throw new Error(`native GraphQL refused the operation: ${JSON.stringify(response.errors)}`);
  return response.data;
}

const WORKFLOW_CATALOG = `query SubtreeFixtureCatalog($projectId: String!) {
  states: worktrackerState(filters: { projectId: { eq: $projectId } }) { nodes { id name group } }
  issue_types: worktrackerIssuetype(filters: { projectId: { eq: $projectId } }) {
    nodes { id name level start_state_id: startStateId }
  }
}`;

const CREATE_WORK_ITEM = `mutation SubtreeFixtureCreateWorkItem(
  $projectId: String!, $name: String!, $issueTypeId: String!, $stateId: String, $parentId: String
) {
  work_item: create_work_item(
    project_id: $projectId, name: $name, issue_type_id: $issueTypeId, state_id: $stateId, parent_id: $parentId
  ) { id name sequence_id: sequenceId state_id: stateId parent_id: parentId }
}`;

const TRANSITION_WORK_ITEM = `mutation SubtreeFixtureTransition($id: String!, $targetStateId: String!) {
  work_item: update_work_item(id: $id, state_id: $targetStateId) { id state_id: stateId }
}`;

const GRAPH_RUN_HOLDING = `query SubtreeGraphRunHolding($rootId: String!) {
  graph_run_holding: graphRuns(filters: { rootId: { eq: $rootId } }, pagination: { offset: { limit: 1, offset: 0 } }) {
    nodes { root_id: rootId execution_mode: executionMode updated_at: updatedAt }
  }
}`;

const LIVE_RUN_HOLDINGS = `query SubtreeLiveRunHoldings($projectId: String!) {
  agent_run_holdings(project_id: $projectId) { agent_run_id task_id effective_state started_at }
}`;

const WORK_ITEM_ENDED_RUNS = `query SubtreeWorkItemEndedRuns($issueId: String!) {
  work_item: worktrackerIssue(filters: { id: { eq: $issueId } }) {
    nodes { id ended_runs: agentRuns(filters: { endedAt: { is_null: false } }) { nodes { agent_run_id: id ended_at: endedAt } } }
  }
}`;

export async function workflowCatalog(browser, projectId) {
  return await nativeGraphql(browser, WORKFLOW_CATALOG, { projectId });
}

export async function createWorkItem(browser, variables) {
  return (await nativeGraphql(browser, CREATE_WORK_ITEM, variables)).work_item;
}

export async function transitionWorkItem(browser, id, targetStateId) {
  return (await nativeGraphql(browser, TRANSITION_WORK_ITEM, { id, targetStateId })).work_item;
}

export async function graphRunHolding(browser, rootId) {
  return (await nativeGraphql(browser, GRAPH_RUN_HOLDING, { rootId })).graph_run_holding.nodes[0] ?? null;
}

/**
 * Every agent run of the given work items as `{ workItemId, agentRunId,
 * unfinished }`: unfinished runs from the live holdings (which carry exactly
 * the runs with no `ended_at`), ended runs from each work item.
 */
export async function workItemRuns(browser, projectId, workItemIds) {
  const wanted = new Set(workItemIds);
  const live = (await nativeGraphql(browser, LIVE_RUN_HOLDINGS, { projectId })).agent_run_holdings
    .filter((run) => wanted.has(run.task_id))
    .map((run) => ({ workItemId: run.task_id, agentRunId: run.agent_run_id, unfinished: true }));
  const ended = [];
  for (const issueId of workItemIds) {
    const node = (await nativeGraphql(browser, WORK_ITEM_ENDED_RUNS, { issueId })).work_item.nodes[0];
    for (const run of node?.ended_runs.nodes ?? []) {
      ended.push({ workItemId: issueId, agentRunId: run.agent_run_id, unfinished: false });
    }
  }
  return [...live, ...ended.filter((run) => !live.some((candidate) => candidate.agentRunId === run.agentRunId))];
}

async function globalMcp(dataDirectory, tool, args) {
  const result = await callSocketMcpTool(dataDirectory, tool, args, 10_000);
  if (result.isError) throw new Error(`global MCP ${tool} failed: ${JSON.stringify(result.content ?? result)}`);
  return result.structuredContent?.result ?? result.structuredContent;
}

/** Persisted workflow state name per node id, from `get_dependency_graph`. */
export async function dependencyGraphStates(dataDirectory, rootId) {
  const graph = await globalMcp(dataDirectory, "get_dependency_graph", { root_task_id: rootId });
  if (graph.error) throw new Error(`get_dependency_graph for ${rootId} returned ${graph.error}`);
  return Object.fromEntries(graph.nodes.map((node) => [node.id, node.state]));
}

export async function onlyProject(dataDirectory) {
  const projects = await globalMcp(dataDirectory, "list_projects", {});
  if (projects.length !== 1) throw new Error(`expected one project in the fresh installation, found ${projects.length}`);
  return projects[0];
}

export async function moduleNamed(dataDirectory, projectId, name) {
  const modules = await globalMcp(dataDirectory, "list_modules", { project_id: projectId });
  const module = modules.find((candidate) => candidate.name === name);
  if (!module) throw new Error(`module ${name} is not listed for project ${projectId}`);
  return module;
}

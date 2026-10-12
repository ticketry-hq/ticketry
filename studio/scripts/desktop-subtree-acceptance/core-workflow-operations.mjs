import { CORE_WORKFLOW, nextCoreWorkflowStep } from "./core-workflow.mjs";
import { nativeGraphql } from "./persisted-facts.mjs";

/**
 * Builds the core fixture's workflow through Ticketry's existing generated
 * workflow GraphQL operations (the ones `features/workflows/operations/
 * workflows.graphql` issues), over the native `graphql_execute` transport.
 * Adds no mutation of its own: each pass reads the catalog, plans one step
 * with `nextCoreWorkflowStep` and runs that step's operation.
 */
const CATALOG = `query SubtreeCoreWorkflowCatalog($projectId: String!) {
  states: worktrackerState(filters: { projectId: { eq: $projectId } }) { nodes { id name group } }
  issue_types: worktrackerIssuetype(filters: { projectId: { eq: $projectId } }) {
    nodes {
      id name level start_state_id: startStateId workflow_revision: workflowRevision
      transitions: issueTypeTransition { nodes { from_state_id: fromStateId to_state_id: toStateId agent_allowed: agentAllowed handoff } }
      launch_bindings: launchBinding { nodes { state_id: stateId prompt subtree_run_enabled: subtreeRunEnabled } }
    }
  }
}`;

const OPERATIONS = Object.freeze({
  createState: `mutation CreateWorkTrackerState($projectId: String!, $name: String!, $group: String!, $color: String) {
    create_state(project_id: $projectId, name: $name, group: $group, color: $color) { id }
  }`,
  createIssueType: `mutation CreateWorkTrackerIssueType($projectId: String!, $name: String!, $level: String!, $color: String) {
    create_issue_type: worktrackerIssuetypeCreateOne(data: { projectId: $projectId, name: $name, level: $level, color: $color }) { id }
  }`,
  setStartState: `mutation SetWorkTrackerStartState($issueTypeId: String!, $startStateId: String!, $workflowRevision: Int!) {
    update_issue_type(id: $issueTypeId, start_state_id: $startStateId, workflow_revision: $workflowRevision) { id }
  }`,
  createTransition: `mutation CreateWorkTrackerTransition($issueTypeId: String!, $fromStateId: String!, $toStateId: String!, $agentAllowed: Boolean!, $handoff: Boolean!, $workflowRevision: Int!) {
    create_issue_type_transition(issue_type_id: $issueTypeId, from_state_id: $fromStateId, to_state_id: $toStateId, agent_allowed: $agentAllowed, handoff: $handoff, workflow_revision: $workflowRevision) { id }
  }`,
  updateTransition: `mutation UpdateWorkTrackerTransition($issueTypeId: String!, $fromStateId: String!, $toStateId: String!, $agentAllowed: Boolean!, $handoff: Boolean!, $workflowRevision: Int!) {
    update_issue_type_transition(issue_type_id: $issueTypeId, from_state_id: $fromStateId, to_state_id: $toStateId, agent_allowed: $agentAllowed, handoff: $handoff, workflow_revision: $workflowRevision) { id }
  }`,
  upsertLaunchBinding: upsertLaunchBindingOperation,
});

// The upsert patches: an argument bound to an unsent variable arrives as null,
// which it refuses for `prompt` and `subtree_run_enabled`, so name only the
// fields this step changes.
function upsertLaunchBindingOperation(variables) {
  const optional = [["prompt", "String!"], ["subtreeRunEnabled", "Boolean!"]]
    .filter(([name]) => variables[name] !== undefined);
  const declared = optional.map(([name, type]) => `, $${name}: ${type}`).join("");
  const argument = (name) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const passed = optional.map(([name]) => `, ${argument(name)}: $${name}`).join("");
  return `mutation UpsertWorkTrackerLaunchBinding($issueTypeId: String!, $stateId: String!, $workflowRevision: Int!${declared}) {
    upsert_issue_type_launch_binding(issue_type_id: $issueTypeId, state_id: $stateId, workflow_revision: $workflowRevision${passed}) { id }
  }`;
}

/** The project's workflow catalog in the planner's shape. */
export async function readCoreWorkflowCatalog(browser, projectId) {
  const data = await nativeGraphql(browser, CATALOG, { projectId });
  return {
    states: data.states.nodes,
    issueTypes: data.issue_types.nodes.map((type) => ({
      id: type.id,
      name: type.name,
      level: type.level,
      startStateId: type.start_state_id,
      workflowRevision: type.workflow_revision,
      transitions: type.transitions.nodes.map((edge) => ({
        fromStateId: edge.from_state_id,
        toStateId: edge.to_state_id,
        agentAllowed: edge.agent_allowed,
        handoff: edge.handoff,
      })),
      launchBindings: type.launch_bindings.nodes.map((binding) => ({
        stateId: binding.state_id,
        prompt: binding.prompt,
        subtreeRunEnabled: binding.subtree_run_enabled,
      })),
    })),
  };
}

/**
 * Converges the project onto `workflow` and returns the final catalog plus
 * the steps run (`[]` when the project already had everything).
 */
export async function buildCoreWorkflow(browser, projectId, workflow = CORE_WORKFLOW) {
  const steps = [];
  for (;;) {
    const catalog = await readCoreWorkflowCatalog(browser, projectId);
    const step = nextCoreWorkflowStep(catalog, workflow);
    if (!step) return { catalog, steps };
    if (steps.length >= 20) throw new Error(`the core workflow did not converge after ${steps.length} steps`);
    const { kind, ...variables } = step;
    const operation = OPERATIONS[kind];
    await nativeGraphql(browser, typeof operation === "function" ? operation(variables) : operation, { projectId, ...variables });
    steps.push(step);
  }
}

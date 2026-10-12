/**
 * The minimal workflow the core subtree fixture needs, because the core
 * edition seeds none: `Implement`, `Review` and `Done` states, `Story` and
 * `Implementation` task types starting in `Implement`, an agent-allowed
 * `Implementation` `Implement → Review` edge, a prompted `Implementation`
 * launch binding at `Implement`, and **Run subtree** enabled on the `Story`
 * binding at `Implement`.
 *
 * `nextCoreWorkflowStep` is pure: given the project's catalog it returns the
 * next generated workflow operation to run, or `undefined` once the workflow
 * is complete. A state or type that already exists by name is adopted rather
 * than duplicated, so the plan also converges on a project that already has
 * part of it. Each step carries the type's current `workflow_revision`.
 */
const IMPLEMENT = "Implement";
const PROMPT = "Complete this work item's current stage, then move it to its next workflow state.";

export const CORE_WORKFLOW = Object.freeze({
  startState: IMPLEMENT,
  states: Object.freeze([
    { name: IMPLEMENT, group: "started", color: "#F59E0B" },
    { name: "Review", group: "started", color: "#08BDBA" },
    { name: "Done", group: "completed", color: "#46A758" },
  ]),
  issueTypes: Object.freeze([
    {
      name: "Implementation",
      color: "#33B1FF",
      transitions: [{ from: IMPLEMENT, to: "Review" }],
      launchBindings: [{ state: IMPLEMENT, prompt: PROMPT, subtreeRunEnabled: false }],
    },
    {
      name: "Story",
      color: "#8E4EC6",
      transitions: [],
      launchBindings: [{ state: IMPLEMENT, prompt: PROMPT, subtreeRunEnabled: true }],
    },
  ]),
});

const sameId = (left, right) => left != null && right != null
  && left.replaceAll("-", "").toLowerCase() === right.replaceAll("-", "").toLowerCase();

function stateId(catalog, name) {
  return catalog.states.find((state) => state.name === name)?.id;
}

function reaches(type, fromId, targetId) {
  const seen = [];
  const frontier = [fromId];
  while (frontier.length > 0) {
    const current = frontier.shift();
    if (sameId(current, targetId)) return true;
    if (seen.some((id) => sameId(id, current))) continue;
    seen.push(current);
    for (const edge of type.transitions) if (sameId(edge.fromStateId, current)) frontier.push(edge.toStateId);
  }
  return false;
}

function nextStepForType(catalog, workflow, spec) {
  const type = catalog.issueTypes.find((candidate) => candidate.name === spec.name);
  if (!type) return { kind: "createIssueType", name: spec.name, level: "task", color: spec.color };
  const implement = stateId(catalog, workflow.startState);
  const revision = { issueTypeId: type.id, workflowRevision: type.workflowRevision };

  // Set first: changing a start state prunes unreachable transitions and bindings.
  if (!type.startStateId) return { kind: "setStartState", ...revision, startStateId: implement };

  for (const { from, to } of spec.transitions) {
    const fromStateId = stateId(catalog, from);
    const toStateId = stateId(catalog, to);
    const edge = type.transitions.find((candidate) => sameId(candidate.fromStateId, fromStateId)
      && sameId(candidate.toStateId, toStateId));
    if (!edge) return { kind: "createTransition", ...revision, fromStateId, toStateId, agentAllowed: true, handoff: false };
    if (!edge.agentAllowed) {
      return { kind: "updateTransition", ...revision, fromStateId, toStateId, agentAllowed: true, handoff: edge.handoff };
    }
  }

  for (const wanted of spec.launchBindings) {
    const bindingStateId = stateId(catalog, wanted.state);
    const binding = type.launchBindings.find((candidate) => sameId(candidate.stateId, bindingStateId));
    const prompted = Boolean(binding?.prompt?.trim());
    const subtreeMissing = wanted.subtreeRunEnabled && !binding?.subtreeRunEnabled;
    if (!prompted || subtreeMissing) {
      return {
        kind: "upsertLaunchBinding",
        ...revision,
        stateId: bindingStateId,
        ...(prompted ? {} : { prompt: wanted.prompt }),
        ...(subtreeMissing ? { subtreeRunEnabled: true } : {}),
      };
    }
  }
  return undefined;
}

// An adopted state or type must already fit the workflow; refuse it before any write.
function refuseUnfitAdoptions(catalog, workflow) {
  for (const spec of workflow.states) {
    const state = catalog.states.find((candidate) => candidate.name === spec.name);
    if (state && state.group !== spec.group) {
      throw new Error(`state ${spec.name} is in group ${state.group}, expected ${spec.group}`);
    }
  }
  const implement = stateId(catalog, workflow.startState);
  for (const spec of workflow.issueTypes) {
    const type = catalog.issueTypes.find((candidate) => candidate.name === spec.name);
    if (!type) continue;
    if (type.level !== "task") throw new Error(`issue type ${spec.name} has level ${type.level}, expected task`);
    if (type.startStateId && !reaches(type, type.startStateId, implement)) {
      throw new Error(`issue type ${spec.name} starts in ${type.startStateId} and its workflow cannot reach ${workflow.startState}`);
    }
  }
}

export function nextCoreWorkflowStep(catalog, workflow = CORE_WORKFLOW) {
  refuseUnfitAdoptions(catalog, workflow);
  for (const spec of workflow.states) {
    if (!stateId(catalog, spec.name)) return { kind: "createState", name: spec.name, group: spec.group, color: spec.color };
  }
  for (const spec of workflow.issueTypes) {
    const step = nextStepForType(catalog, workflow, spec);
    if (step) return step;
  }
  return undefined;
}

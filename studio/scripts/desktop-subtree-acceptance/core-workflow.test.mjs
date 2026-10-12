import assert from "node:assert/strict";
import test from "node:test";

import { CORE_WORKFLOW, nextCoreWorkflowStep } from "./core-workflow.mjs";

const emptyCatalog = () => ({
  states: [],
  issueTypes: [{ id: "type-module", name: "Module", level: "module", startStateId: null, workflowRevision: 0, transitions: [], launchBindings: [] }],
});

// Applies a planned step the way the generated operation would.
function apply(catalog, step) {
  const type = (id) => catalog.issueTypes.find((candidate) => candidate.id === id);
  const bump = (id) => { type(id).workflowRevision += 1; };
  switch (step.kind) {
    case "createState":
      catalog.states.push({ id: `state-${step.name}`, name: step.name, group: step.group });
      break;
    case "createIssueType":
      catalog.issueTypes.push({ id: `type-${step.name}`, name: step.name, level: step.level, startStateId: null, workflowRevision: 0, transitions: [], launchBindings: [] });
      break;
    case "setStartState":
      assert.equal(step.workflowRevision, type(step.issueTypeId).workflowRevision);
      type(step.issueTypeId).startStateId = step.startStateId;
      bump(step.issueTypeId);
      break;
    case "createTransition":
      assert.equal(step.workflowRevision, type(step.issueTypeId).workflowRevision);
      type(step.issueTypeId).transitions.push({ fromStateId: step.fromStateId, toStateId: step.toStateId, agentAllowed: step.agentAllowed, handoff: step.handoff });
      bump(step.issueTypeId);
      break;
    case "updateTransition": {
      const edge = type(step.issueTypeId).transitions.find((candidate) => candidate.fromStateId === step.fromStateId && candidate.toStateId === step.toStateId);
      edge.agentAllowed = step.agentAllowed;
      bump(step.issueTypeId);
      break;
    }
    case "upsertLaunchBinding": {
      assert.equal(step.workflowRevision, type(step.issueTypeId).workflowRevision);
      const bindings = type(step.issueTypeId).launchBindings;
      let binding = bindings.find((candidate) => candidate.stateId === step.stateId);
      if (!binding) {
        assert.ok(step.prompt?.trim(), "a new launch binding needs a nonblank prompt");
        binding = { stateId: step.stateId, prompt: "", subtreeRunEnabled: false };
        bindings.push(binding);
      }
      if (step.prompt !== undefined) binding.prompt = step.prompt;
      if (step.subtreeRunEnabled !== undefined) binding.subtreeRunEnabled = step.subtreeRunEnabled;
      bump(step.issueTypeId);
      break;
    }
    default:
      throw new Error(`unknown step ${step.kind}`);
  }
}

function converge(catalog) {
  const steps = [];
  for (let step = nextCoreWorkflowStep(catalog); step; step = nextCoreWorkflowStep(catalog)) {
    if (steps.length > 30) throw new Error("the workflow plan does not converge");
    steps.push(step);
    apply(catalog, step);
  }
  return steps;
}

const named = (catalog, name) => catalog.issueTypes.find((type) => type.name === name);
const stateNamed = (catalog, name) => catalog.states.find((state) => state.name === name);

test("an empty core project is given the minimal subtree workflow", () => {
  const catalog = emptyCatalog();
  const steps = converge(catalog);

  assert.deepEqual(
    catalog.states.map(({ name, group }) => ({ name, group })),
    [{ name: "Implement", group: "started" }, { name: "Review", group: "started" }, { name: "Done", group: "completed" }],
  );
  const implement = stateNamed(catalog, "Implement").id;
  const review = stateNamed(catalog, "Review").id;
  for (const name of ["Story", "Implementation"]) {
    assert.equal(named(catalog, name).level, "task");
    assert.equal(named(catalog, name).startStateId, implement, `${name} starts in Implement`);
  }
  assert.deepEqual(named(catalog, "Implementation").transitions, [
    { fromStateId: implement, toStateId: review, agentAllowed: true, handoff: false },
  ]);
  const implementationBinding = named(catalog, "Implementation").launchBindings.find((binding) => binding.stateId === implement);
  assert.ok(implementationBinding.prompt.trim().length > 0);
  const storyBinding = named(catalog, "Story").launchBindings.find((binding) => binding.stateId === implement);
  assert.ok(storyBinding.prompt.trim().length > 0);
  assert.equal(storyBinding.subtreeRunEnabled, true);
  // Start states are set before any transition or binding, which they would prune.
  for (const name of ["Story", "Implementation"]) {
    const forType = steps.filter((step) => step.issueTypeId === `type-${name}`);
    assert.equal(forType[0].kind, "setStartState", `${name}'s first workflow write sets its start state`);
  }
  assert.equal(nextCoreWorkflowStep(catalog), undefined);
});

test("an existing workflow with the named states and types is adopted, not duplicated", () => {
  const catalog = {
    states: [
      { id: "ideas", name: "Ideas", group: "backlog" },
      { id: "implement", name: "Implement", group: "started" },
      { id: "review", name: "Review", group: "started" },
      { id: "done", name: "Done", group: "completed" },
    ],
    issueTypes: [
      {
        id: "story", name: "Story", level: "task", startStateId: "ideas", workflowRevision: 4,
        transitions: [{ fromStateId: "ideas", toStateId: "implement", agentAllowed: true, handoff: false }],
        launchBindings: [{ stateId: "implement", prompt: "Story prompt", subtreeRunEnabled: false }],
      },
      {
        id: "implementation", name: "Implementation", level: "task", startStateId: "implement", workflowRevision: 2,
        transitions: [{ fromStateId: "implement", toStateId: "review", agentAllowed: false, handoff: false }],
        launchBindings: [{ stateId: "implement", prompt: "Implementation prompt", subtreeRunEnabled: false }],
      },
    ],
  };
  const steps = converge(catalog);
  assert.deepEqual(steps.map((step) => step.kind).sort(), ["updateTransition", "upsertLaunchBinding"]);
  assert.equal(catalog.states.length, 4);
  assert.equal(named(catalog, "Story").launchBindings[0].prompt, "Story prompt");
  assert.equal(named(catalog, "Story").launchBindings[0].subtreeRunEnabled, true);
  assert.equal(named(catalog, "Implementation").transitions[0].agentAllowed, true);
});

test("an adopted type whose workflow cannot reach Implement is refused", () => {
  const catalog = {
    states: [
      { id: "ideas", name: "Ideas", group: "backlog" },
      { id: "implement", name: "Implement", group: "started" },
      { id: "review", name: "Review", group: "started" },
      { id: "done", name: "Done", group: "completed" },
    ],
    issueTypes: [{ id: "story", name: "Story", level: "task", startStateId: "ideas", workflowRevision: 1, transitions: [], launchBindings: [] }],
  };
  assert.throws(() => nextCoreWorkflowStep(catalog), /Story .*cannot reach Implement/);
});

test("a state of the right name in the wrong group is refused", () => {
  const catalog = { states: [{ id: "review", name: "Review", group: "completed" }], issueTypes: [] };
  assert.throws(() => nextCoreWorkflowStep(catalog), /Review .*completed.*expected started/);
});

test("identifiers compare without regard to hyphenation or case", () => {
  const catalog = emptyCatalog();
  converge(catalog);
  const implementation = named(catalog, "Implementation");
  implementation.startStateId = implementation.startStateId.toUpperCase();
  assert.equal(nextCoreWorkflowStep(catalog), undefined);
  assert.equal(CORE_WORKFLOW.states.length, 3);
});

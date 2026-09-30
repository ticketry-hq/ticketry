import type {
  ScopedWorkflowImpact,
  ScopedWorkflowImpactOperation,
  ScopedWorkflowSettings,
} from "../../../shared/api/types";

function reachableStateIds(
  startStateId: string | null,
  transitions: ScopedWorkflowSettings["transitions"],
): Set<string> {
  if (!startStateId) return new Set();
  const outgoing = new Map<string, string[]>();
  for (const transition of transitions) {
    outgoing.set(transition.from_state_id, [
      ...(outgoing.get(transition.from_state_id) ?? []),
      transition.to_state_id,
    ]);
  }
  const reachable = new Set([startStateId]);
  const queue = [startStateId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const target of outgoing.get(current) ?? []) {
      if (reachable.has(target)) continue;
      reachable.add(target);
      queue.push(target);
    }
  }
  return reachable;
}

export function deriveWorkflowImpact(
  workflow: ScopedWorkflowSettings,
  operation: ScopedWorkflowImpactOperation,
): ScopedWorkflowImpact {
  let nextStartStateId = workflow.start_state_id;
  const directlyRemoved = new Set<string>();
  if (operation.operation === "remove_state") {
    if (operation.state_id === workflow.start_state_id) {
      throw new Error(
        "The workflow start state cannot be removed; change the start state instead.",
      );
    }
    for (const transition of workflow.transitions) {
      if (
        transition.from_state_id === operation.state_id
        || transition.to_state_id === operation.state_id
      ) {
        directlyRemoved.add(`${transition.from_state_id}:${transition.to_state_id}`);
      }
    }
  } else if (operation.operation === "remove_transition") {
    directlyRemoved.add(`${operation.from_state_id}:${operation.to_state_id}`);
  } else {
    nextStartStateId = operation.state_id;
  }

  const remaining = workflow.transitions.filter(
    (transition) => !directlyRemoved.has(
      `${transition.from_state_id}:${transition.to_state_id}`,
    ),
  );
  const reachable = reachableStateIds(nextStartStateId, remaining);
  const deletedTransitions = workflow.transitions.filter((transition) =>
    directlyRemoved.has(`${transition.from_state_id}:${transition.to_state_id}`)
    || !reachable.has(transition.from_state_id)
    || !reachable.has(transition.to_state_id));
  const deletedLaunchBindings = workflow.launch_bindings.filter(
    (binding) => !reachable.has(binding.state_id),
  );
  return {
    workflow_revision: workflow.workflow_revision,
    deleted_transitions: deletedTransitions,
    deleted_launch_bindings: deletedLaunchBindings,
    disabled_auto_start_state_ids: deletedLaunchBindings
      .filter((binding) => binding.auto_start)
      .map((binding) => binding.state_id),
  };
}

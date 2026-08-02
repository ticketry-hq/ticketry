import type { ScopedWorkflowSettings } from "../../shared/api/types";

/**
 * The workflow editor treats the start state and every state reachable through
 * configured transitions as members of a type's workflow.
 */
export function workflowMemberStateIds(
  workflow: ScopedWorkflowSettings,
): Set<string> {
  if (!workflow.start_state_id) return new Set();

  const outgoing = new Map<string, string[]>();
  for (const edge of workflow.transitions) {
    const targets = outgoing.get(edge.from_state_id) ?? [];
    targets.push(edge.to_state_id);
    outgoing.set(edge.from_state_id, targets);
  }

  const members = new Set([workflow.start_state_id]);
  const queue = [workflow.start_state_id];
  for (let index = 0; index < queue.length; index += 1) {
    for (const target of outgoing.get(queue[index]) ?? []) {
      if (members.has(target)) continue;
      members.add(target);
      queue.push(target);
    }
  }
  return members;
}

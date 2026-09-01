import type { IssueType, ScopedWorkflowSettings, State } from "../../../shared/api/types";
import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";

interface CatalogProvider { id: string; slug: string; activated?: boolean }
interface CatalogModel { id: string; provider: string; name: string }
interface CatalogReasoning { id: string; name: string }
interface Transition { from_state: string; to_state: string; agent_allowed?: boolean }
interface Binding {
  issue_type: string;
  state: string;
  prompt?: string;
  required_skills?: unknown;
  model?: string | null;
  reasoning?: string | null;
  auto_start?: boolean;
  subtree_run_enabled?: boolean;
}

function reachable(start: string | null, transitions: ScopedWorkflowSettings["transitions"]): Set<string> {
  if (!start) return new Set();
  const outgoing = new Map<string, string[]>();
  for (const transition of transitions) {
    outgoing.set(transition.from_state_id, [...(outgoing.get(transition.from_state_id) ?? []), transition.to_state_id]);
  }
  const result = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift()!;
    for (const target of outgoing.get(current) ?? []) {
      if (!result.has(target)) { result.add(target); queue.push(target); }
    }
  }
  return result;
}

export function assembleScopedWorkflowSettings(
  issueType: IssueType,
  states: State[],
  transitions: Transition[],
  bindings: Binding[],
  providers: CatalogProvider[],
  models: CatalogModel[],
  reasoningLevels: CatalogReasoning[],
  hasGlobalDefault: boolean,
): ScopedWorkflowSettings {
  // Catalog rows arrive with the server's compact UUIDs while binding rows are
  // normalized to the hyphenated public form. Key both sides compactly so a
  // stored model/reasoning id still resolves to its catalog row; keying on the
  // raw strings silently dropped every saved model and reasoning selection.
  const providerById = new Map(
    providers.map((provider) => [compactWorktrackerId(provider.id), provider]),
  );
  const modelById = new Map(
    models.map((model) => [compactWorktrackerId(model.id), model]),
  );
  const reasoningById = new Map(
    reasoningLevels.map((level) => [compactWorktrackerId(level.id), level]),
  );
  const scopedTransitions = transitions.map((transition) => ({
    from_state_id: transition.from_state,
    to_state_id: transition.to_state,
    agent_allowed: transition.agent_allowed ?? true,
  }));
  const scopedBindings = bindings.filter((binding) => binding.issue_type === issueType.id).map((binding) => {
    const model = binding.model
      ? modelById.get(compactWorktrackerId(binding.model))
      : undefined;
    const provider = model
      ? providerById.get(compactWorktrackerId(model.provider))
        ?? providers.find((item) => item.slug === model.provider)
      : undefined;
    return {
      state_id: binding.state,
      prompt: binding.prompt ?? "",
      required_skills: Array.isArray(binding.required_skills)
        ? binding.required_skills.filter((skill): skill is string => typeof skill === "string")
        : [],
      agent: provider?.slug ?? null,
      model: model?.name ?? null,
      reasoning: binding.reasoning
        ? reasoningById.get(compactWorktrackerId(binding.reasoning))?.name ?? null
        : null,
      auto_start: binding.auto_start ?? false,
      subtree_run_enabled: binding.subtree_run_enabled ?? false,
    };
  });
  const startStateId = issueType.start_state ?? null;
  const stateById = new Map(states.flatMap((state) => state.id ? [[state.id, state] as const] : []));
  const warnings: ScopedWorkflowSettings["warnings"] = [];
  if (!startStateId || !stateById.has(startStateId)) {
    warnings.push({ code: "start_state_not_configured", state_id: null, message: "No start state is configured for this work-item type." });
  } else {
    const members = reachable(startStateId, scopedTransitions);
    const completed = [...members].filter((id) => stateById.get(id)?.group === "completed");
    const reverse = scopedTransitions.map((edge) => ({ ...edge, from_state_id: edge.to_state_id, to_state_id: edge.from_state_id }));
    const canComplete = new Set<string>();
    for (const stateId of completed) for (const id of reachable(stateId, reverse)) canComplete.add(id);
    for (const stateId of members) if (!canComplete.has(stateId)) warnings.push({
      code: "no_path_to_completed",
      state_id: stateId,
      message: `${stateById.get(stateId)?.name ?? stateId} has no path to a completed state.`,
    });
  }
  const active = new Set(providers.filter((provider) => provider.activated).map((provider) => provider.slug));
  for (const binding of scopedBindings) {
    if (!binding.prompt.trim() && !binding.model) continue;
    const stateName = stateById.get(binding.state_id)?.name ?? "This state";
    if (binding.agent && !active.has(binding.agent)) warnings.push({ code: "provider_not_activated", state_id: binding.state_id, message: `${stateName} launches with ${binding.agent}, which is deactivated in Settings -> Model configuration; those launches are blocked.` });
    else if (binding.auto_start && !binding.agent && !hasGlobalDefault) warnings.push({ code: "auto_start_without_default", state_id: binding.state_id, message: `${stateName} auto-starts through the global launch default, and none is configured.` });
  }
  return {
    issue_type_id: issueType.id,
    start_state_id: startStateId,
    workflow_revision: issueType.workflow_revision ?? 0,
    transitions: scopedTransitions,
    launch_bindings: scopedBindings,
    warnings,
  };
}

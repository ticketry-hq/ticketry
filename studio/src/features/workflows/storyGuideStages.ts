import type { ScopedWorkflowSettings, State } from "../../shared/api/types";

const commonMeanings: Record<string, string> = {
  ideas: "captures a desired change",
  grill: "settles unclear requirements through questions",
  spec: "describes the agreed behavior and implementation requirements",
  tickets: "breaks the specification into scoped implementation work",
  implement: "carries out the work",
  review: "inspects the result",
  done: "records completion",
  cancelled: "stops pursuing the work",
};

const savedNotesExamples: Record<string, string> = {
  ideas: "Capture: Add a search box so people can find saved notes.",
  grill: "Clarify which notes should match and how search results should appear.",
  spec: "Describe the agreed search behavior and completion criteria.",
  tickets: "Break the saved-notes search into scoped work items.",
  implement: "Build the search behavior described by this Story.",
  review: "Check the result against the Story and inspect any available changes.",
};

export interface StoryGuideStage {
  id: string;
  name: string;
  current: boolean;
  outsideConfiguration: boolean;
  meaning: string | null;
  example: string | null;
  destinations: Array<{ id: string; name: string }>;
  binding: ScopedWorkflowSettings["launch_bindings"][number] | null;
}

export function storyGuideStages(
  workflow: ScopedWorkflowSettings,
  states: State[],
  currentStateId: string | null,
): StoryGuideStage[] {
  const configured = new Set<string>();
  if (workflow.start_state_id) configured.add(workflow.start_state_id);
  for (const edge of workflow.transitions) {
    configured.add(edge.from_state_id);
    configured.add(edge.to_state_id);
  }
  for (const binding of workflow.launch_bindings) configured.add(binding.state_id);

  const included = new Set(configured);
  if (currentStateId) included.add(currentStateId);
  const stateById = new Map(states.flatMap((state) => state.id ? [[state.id, state] as const] : []));
  const nameFor = (id: string) => stateById.get(id)?.name ?? `Unknown state (${id})`;

  return [...included].sort((left, right) =>
    (stateById.get(left)?.sort_order ?? Number.MAX_SAFE_INTEGER)
      - (stateById.get(right)?.sort_order ?? Number.MAX_SAFE_INTEGER)
  ).map((id) => {
    const name = nameFor(id);
    const familiar = name.trim().toLowerCase();
    return {
      id,
      name,
      current: id === currentStateId,
      outsideConfiguration: id === currentStateId && !configured.has(id),
      meaning: commonMeanings[familiar] ?? null,
      example: savedNotesExamples[familiar] ?? null,
      destinations: workflow.transitions
        .filter((edge) => edge.from_state_id === id)
        .map((edge) => ({ id: edge.to_state_id, name: nameFor(edge.to_state_id) })),
      binding: workflow.launch_bindings.find((binding) => binding.state_id === id) ?? null,
    };
  });
}

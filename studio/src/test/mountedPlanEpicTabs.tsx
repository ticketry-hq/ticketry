import type { PlanningGraph } from "../features/planning-graph";
import { sprint } from "../features/planning-graph/testGraph";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { EpicTabStrip } from "../features/sprints/planning/EpicTabStrip";
import type { EpicSuggestion } from "../features/sprints/planning/epicMembership";
import { usePlanVisitCoordinator } from "../features/sprints/planning/usePlanVisitCoordinator";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";

interface MountedPlanEpicTabsProps {
  graph: PlanningGraph;
  suggestions: EpicSuggestion[];
  sprintId: string;
  ready?: boolean;
}

/** Real mounted controls sharing the screen's coordinator, with ready fixture reads. */
export function MountedPlanEpicTabs(props: MountedPlanEpicTabsProps) {
  const generation = usePlanWorkspace((state) => state.generation);
  return <StudioApolloProvider><PlanEpicTabsControls key={`${props.graph.project?.id}:${props.sprintId}:${generation}`} {...props} /></StudioApolloProvider>;
}

function PlanEpicTabsControls({ graph: suppliedGraph, suggestions, sprintId, ready = true }: MountedPlanEpicTabsProps) {
  const graph = suppliedGraph.sprints.some((item) => item.id === sprintId) ? suppliedGraph
    : { ...suppliedGraph, sprints: [...suppliedGraph.sprints, sprint({ id: sprintId })] };
  const coordinator = usePlanVisitCoordinator(graph.project?.id ?? "", sprintId, {
    graph, loading: false, error: null,
    suggestions, suggestionsLoading: !ready, suggestionsError: null,
  });
  return <EpicTabStrip graph={graph} coordinator={coordinator} />;
}

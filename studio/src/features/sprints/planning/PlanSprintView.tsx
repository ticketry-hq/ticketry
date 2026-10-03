import type { ReactNode } from "react";
import { backlogCandidates, backlogCandidateIn, backlogStateIds, isTopLevelIn, usePlanningGraph } from "../../planning-graph";
import { toast } from "../../../state/clientStore";
import { closePlanSprint, openPlanItem, setPlanVisit, usePlanWorkspace } from "../planWorkspaceState";
import { useUpdateSprintSuggestion } from "../mutations";
import { useSprintSuggestions } from "../useSprintSuggestions";
import type { SprintSuggestionRecordFragment } from "../generated/sprints.documents";
import { useSprintSuggestionExecution } from "../suggestions/useSprintSuggestionExecution";
import { SuggestionStatusRecovery } from "../suggestions/SuggestionStatusRecovery";
import { EpicTabStrip } from "./EpicTabStrip";
import { closeEpicTab, reconcileEpicTabs, seedEpicTabs } from "./epicTabs";
import { PlanHeader } from "./PlanHeader";
import { PlanStoryPanes } from "./PlanStoryPanes";
import { PlanDetailPane } from "./PlanDetailPane";
import { SuggestionRows } from "./SuggestionRows";
import { groupByEpic } from "./planGroups";
import { availablePlanEpics, epicOf, suggestionEpicOf } from "./epicMembership";
import { usePlanMoves } from "./usePlanMoves";
import { PlanFeedback } from "./PlanFeedback";
import type { Move, MoveEligibility } from "./moveFeedback";

export type PlanSprintViewProps = { projectId: string; sprintId: string; renderWorkItemDetail: (id: string) => ReactNode };

export default function PlanSprintView(props: PlanSprintViewProps) {
  return <SprintPlan key={`${props.projectId}:${props.sprintId}`} {...props} />;
}

function SprintPlan({ projectId, sprintId, renderWorkItemDetail }: PlanSprintViewProps) {
  const { graph, loading, error } = usePlanningGraph(projectId);
  const workspace = usePlanWorkspace();
  const suggestionQuery = useSprintSuggestions(sprintId);
  const agent = useSprintSuggestionExecution(sprintId);
  const { update, busy } = useUpdateSprintSuggestion({ projectId, sprintId });
  const suggestions = suggestionQuery.suggestions;
  const waiting = suggestions.filter((suggestion) => suggestion.status === "waiting");
  const sprint = graph?.sprints.find((candidate) => candidate.id === sprintId);
  const epicTabsReady = !suggestionQuery.loading && !suggestionQuery.error;
  const epics = graph ? availablePlanEpics(graph, suggestions, sprintId) : [];
  const savedVisit = workspace.visits[sprintId];
  const visit = savedVisit ? (epicTabsReady ? reconcileEpicTabs(savedVisit, epics) : savedVisit)
    : graph && epicTabsReady ? seedEpicTabs(graph, suggestions, sprintId) : null;
  const activeEpicId = visit?.activeEpicId ?? null;
  const chosen = new Set(activeEpicId ? [activeEpicId] : []);
  const backlog = groupByEpic(epics, graph ? backlogCandidates(graph) : [], chosen);
  const sprintPane = groupByEpic(epics, graph?.workItems.filter((item) => item.sprintId === sprintId) ?? [])
    .sort((left, right) => Number(right.epic.id === activeEpicId) - Number(left.epic.id === activeEpicId));
  const itemsById = new Map(graph?.workItems.map((item) => [item.id, item]));
  const eligibility = (move: Move): MoveEligibility => {
    const item = itemsById.get(move.itemId);
    if (!graph || !sprint || !item || loading || error) return { kind: "unavailable" };
    if (move.to !== sprintId) return item.sprintId === sprintId ? { kind: "eligible" } : { kind: "unavailable" };
    if (!isTopLevelIn(graph)(item)) return { kind: "hierarchy" };
    if (item.stateId === null || !backlogStateIds(graph.states).has(item.stateId)) {
      return { kind: "workflow", stateName: graph.states.find((state) => state.id === item.stateId)?.name ?? "an unavailable workflow state" };
    }
    if (!backlogCandidateIn(graph)(item)) return { kind: "unavailable" };
    if (epicOf(item, epics) !== activeEpicId) return { kind: "focus", epicName: epics.find((epic) => epic.id === epicOf(item, epics))?.name ?? "No epic" };
    return { kind: "eligible" };
  };
  const moves = usePlanMoves((id) => itemsById.get(id)?.sprintId, eligibility);
  const openSuggestion = (suggestion: SprintSuggestionRecordFragment) => {
    if (suggestion.issueId) void openPlanItem(suggestion.issueId, suggestion.id);
    else usePlanWorkspace.setState({ openItem: `suggestion:${suggestion.id}`, pendingOpenItem: null });
  };
  const changeSuggestion = (suggestion: SprintSuggestionRecordFragment, status: "accepted" | "dismissed") => {
    if (busy) return;
    const generation = usePlanWorkspace.getState().generation;
    void update({ id: suggestion.id, status }).then((result) => {
      const current = usePlanWorkspace.getState();
      if (!current.active || current.generation !== generation || current.projectId !== projectId || current.sprintId !== sprintId) return;
      if (status === "accepted" && result?.issue?.id) void openPlanItem(result.issue.id);
      else if (usePlanWorkspace.getState().openItem === `suggestion:${suggestion.id}`) usePlanWorkspace.setState({ openItem: null });
    }).catch((failure: unknown) => toast.error(failure instanceof Error ? failure.message : "Could not update this suggestion."));
  };
  if (!graph || !sprint) return <p role={error ? "alert" : "status"} className="p-4 text-text-muted">{error ?? (loading ? "Loading Plan…" : "Sprint not found.")}</p>;
  const goals = agent.sprint?.goals?.nodes ?? [];
  const activeSuggestions = waiting.filter((suggestion) => suggestionEpicOf(suggestion, epics) === activeEpicId);
  return <div className="flex h-full min-w-0 flex-col" data-testid="plan-sprint">
    <PlanHeader sprintName={sprint.name} storyCount={sprintPane.reduce((total, group) => total + group.items.length, 0)}
      goals={goals} waitingCount={waiting.length} agentRunning={agent.running} onBack={closePlanSprint} onDone={closePlanSprint} />
    {suggestionQuery.error && <p role="alert" className="px-4 py-2 text-xs text-text-muted">{suggestionQuery.error.message}</p>}
    <SuggestionStatusRecovery error={agent.error} refreshing={agent.refreshing} onRetry={agent.retryStatus} />
    <EpicTabStrip graph={graph} suggestions={suggestions} sprintId={sprintId} ready={epicTabsReady} />
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PlanStoryPanes sprintName={sprint.name} activeEpicId={activeEpicId} backlog={backlog} sprintPane={sprintPane}
          backlogFooter={activeEpicId && visit && <button type="button" className="px-3 py-2 text-xs text-text-secondary" onClick={() => {
            setPlanVisit(sprintId, closeEpicTab(visit, activeEpicId));
            if (activeSuggestions.length) toast.info(`${activeSuggestions.length} suggestions are still waiting. Find this epic in Add epic.`);
          }}>Done with {epics.find((epic) => epic.id === activeEpicId)?.name ?? "this epic"}{visit.epicTabs.length > 1 ? " → next" : ""}</button>}
          isPending={moves.isPending} openStory={(id) => { void openPlanItem(id); }} openStoryId={workspace.openItem}
          request={(id, into) => { const item = itemsById.get(id); if (item) void moves.move({ itemId: id, key: item.key, from: item.sprintId, to: into ? sprintId : null }); }}
          suggestions={<SuggestionRows suggestions={activeSuggestions} goals={goals} openItem={workspace.openItem} busy={busy}
            onOpen={openSuggestion} onAccept={(suggestion) => changeSuggestion(suggestion, "accepted")} onDismiss={(suggestion) => changeSuggestion(suggestion, "dismissed")} />} />
        <div className="relative flex-none">
          <PlanFeedback feedback={moves.feedback} place={(id) => id ? graph.sprints.find((candidate) => candidate.id === id)?.name ?? "a sprint" : "the Backlog"}
            eligibility={moves.eligibility} undoEligibility={moves.undoEligibility} onRetry={moves.retry} onDismiss={moves.dismiss} onUndo={moves.undo} onHoldUndo={moves.holdUndo} />
        </div>
      </div>
      <PlanDetailPane openItem={workspace.openItem} suggestions={suggestions} busy={busy} renderWorkItemDetail={renderWorkItemDetail}
        onAccept={(suggestion) => changeSuggestion(suggestion, "accepted")} onDismiss={(suggestion) => changeSuggestion(suggestion, "dismissed")}
        onClose={() => usePlanWorkspace.setState({ openItem: null, pendingOpenItem: null })} />
    </div>
  </div>;
}

import InlineStoryCreation from "./InlineStoryCreation";
import { useStoryCreationEntries } from "./storyCreationEntries";
import type { ReactNode } from "react";
import { usePlanningGraph } from "../../planning-graph";
import { closePlanSprint, openPlanItem, usePlanWorkspace } from "../planWorkspaceState";
import { usePlanSuggestionDecisions } from "./usePlanSuggestionDecisions";
import { useSprintSuggestions } from "../useSprintSuggestions";
import type { SprintSuggestionRecordFragment } from "../generated/sprints.documents";
import { useSprintSuggestionExecution } from "../suggestions/useSprintSuggestionExecution";
import { SuggestionStatusRecovery } from "../suggestions/SuggestionStatusRecovery";
import { EpicTabStrip } from "./EpicTabStrip";
import { usePlanVisitCoordinator } from "./usePlanVisitCoordinator";
import { PlanHeader } from "./PlanHeader";
import { PlanStoryPanes } from "./PlanStoryPanes";
import { PlanDetailPane } from "./PlanDetailPane";
import { SuggestionRows } from "./SuggestionRows";
import { AcceptedSuggestionGoals } from "./AcceptedSuggestionGoals";
import { NO_EPIC } from "./epicMembership";
import { PlanFeedback } from "./PlanFeedback";
import { ROADMAP_ENABLED } from "../../../shared/config/roadmapAvailability";

export type PlanSprintViewProps = { projectId: string; sprintId: string; renderWorkItemDetail: (id: string) => ReactNode };

export default function PlanSprintView(props: PlanSprintViewProps) {
  return ROADMAP_ENABLED ? <AvailablePlanSprintView {...props} /> : null;
}

function AvailablePlanSprintView(props: PlanSprintViewProps) {
  const generation = usePlanWorkspace((state) => state.generation);
  return <SprintPlan key={`${props.projectId}:${props.sprintId}:${generation}`} {...props} />;
}

function SprintPlan({ projectId, sprintId, renderWorkItemDetail }: PlanSprintViewProps) {
  const { graph, loading, error } = usePlanningGraph(projectId);
  const workspace = usePlanWorkspace();
  const creationEntry = useStoryCreationEntries(workspace.generation);
  const suggestionQuery = useSprintSuggestions(sprintId);
  const agent = useSprintSuggestionExecution(sprintId);
  const suggestions = suggestionQuery.suggestions;
  const sprint = graph?.sprints.find((candidate) => candidate.id === sprintId);
  const coordinator = usePlanVisitCoordinator(projectId, sprintId, {
    graph, loading, error, suggestions,
    suggestionsLoading: suggestionQuery.loading, suggestionsError: suggestionQuery.error,
  });
  const { visit, epics, activeEpicId, backlog, sprintPane, activeSuggestions, waitingCount } = coordinator;
  const { moves, canMove } = coordinator;
  const openSuggestion = (suggestion: SprintSuggestionRecordFragment) => {
    if (suggestion.issueId) void openPlanItem(suggestion.issueId, suggestion.id);
    else usePlanWorkspace.setState({ openItem: `suggestion:${suggestion.id}`, pendingOpenItem: null });
  };
  const decisions = usePlanSuggestionDecisions(projectId, sprintId, moves.reset, {
    isCurrent: coordinator.isCurrent,
    canChange: (id, status, confirmedBatch) => coordinator.canDecideSuggestion(status, id, confirmedBatch),
  });
  const { busy } = decisions;
  const changeSuggestion = (suggestion: SprintSuggestionRecordFragment, status: "accepted" | "dismissed", proposedName?: string) => {
    if (!coordinator.canDecideSuggestion(status, suggestion.id)) return;
    void decisions.change(suggestion, status, proposedName);
  };
  if (!graph || !sprint) return <p role={error ? "alert" : "status"} className="p-4 text-text-muted">{error ?? (loading ? "Loading Plan…" : "Sprint not found.")}</p>;
  const goals = agent.sprint?.goals?.nodes ?? [];
  return <div className="flex h-full min-w-0 flex-col" data-testid="plan-sprint">
    <PlanHeader sprintName={sprint.name} storyCount={sprintPane.reduce((total, group) => total + group.items.length, 0)}
      goals={goals} waitingCount={waitingCount} agentRunning={agent.running} onBack={closePlanSprint} onDone={closePlanSprint} />
    {suggestionQuery.error && <p role="alert" className="px-4 py-2 text-xs text-text-muted">{suggestionQuery.error.message}</p>}
    <SuggestionStatusRecovery error={agent.error} refreshing={agent.refreshing} onRetry={agent.retryStatus} />
    <EpicTabStrip graph={graph} coordinator={coordinator} />
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PlanStoryPanes sprintName={sprint.name} activeEpicId={activeEpicId} backlog={backlog} sprintPane={sprintPane}
          renderStoryGoals={(id) => <AcceptedSuggestionGoals itemId={id} suggestions={suggestions} goals={goals} />}
          activeEpic={epics.find((epic) => epic.id === activeEpicId)}
          renderNewStory={(epic, into) => epic.id === activeEpicId && <InlineStoryCreation
            projectId={projectId} epicId={epic.id === NO_EPIC ? null : epic.id}
            sprintId={into ? sprintId : null} storyType={graph.storyType}
            disabled={loading || Boolean(error) || sprint.status === "completed"}
            slot={creationEntry(epic.id, into ? sprintId : null)} />}
          backlogFooter={activeEpicId && visit && <button type="button" className="px-3 py-2 text-xs text-text-secondary" onClick={(event) => {
            const plan = event.currentTarget.closest('[data-testid="plan-sprint"]');
            if (!coordinator.close(activeEpicId, "done")) return;
            requestAnimationFrame(() => {
              if (plan?.isConnected && coordinator.isCurrent()) {
                const target = plan.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
                  ?? plan.querySelector<HTMLElement>('button[aria-label="Add epic"]');
                target?.focus();
              }
            });
          }}>Done with {epics.find((epic) => epic.id === activeEpicId)?.name ?? "this epic"}{visit.epicTabs.length > 1 ? " → next" : ""}</button>}
          isPending={moves.isPending} openStory={(id) => { void openPlanItem(id); }} openStoryId={workspace.openItem}
          canMove={canMove} incomingMoveHint={sprint.status === "completed" ? "This sprint is completed and closed to new work." : undefined}
          request={(id, into) => { decisions.clear(); coordinator.requestMove(id, into); }}
          suggestions={<SuggestionRows suggestions={activeSuggestions} goals={goals} openItem={workspace.openItem} busy={busy || decisions.blocked}
            acceptDisabled={!coordinator.canDecideSuggestion("accepted")} dismissDisabled={!coordinator.canDecideSuggestion("dismissed")}
            onAcceptAll={() => { if (coordinator.canDecideSuggestion("accepted")) void decisions.acceptAll(activeSuggestions); }}
            onOpen={openSuggestion} onAccept={(suggestion) => changeSuggestion(suggestion, "accepted")} onDismiss={(suggestion) => changeSuggestion(suggestion, "dismissed")} />} />
        <div className="relative flex-none">
          <PlanFeedback decision={decisions.decision} decisionBusy={busy} onUndoDecision={decisions.undo}
            decisionUndoDisabled={decisions.blocked || Boolean(decisions.decision && !coordinator.canDecideSuggestion("waiting", decisions.decision.id))}
            decisionFailure={decisions.failure} onRetryDecision={decisions.retry}
            decisionRecovery={decisions.recovery} onRetryDecisionRefresh={decisions.retryRefresh}
            decisionRetryDisabled={Boolean(decisions.failure && !coordinator.canDecideSuggestion(decisions.failure.status, decisions.failure.suggestion.id))}
            feedback={moves.feedback} place={(id) => id ? graph.sprints.find((candidate) => candidate.id === id)?.name ?? "a sprint" : "the Backlog"}
            eligibility={moves.eligibility} undoEligibility={moves.undoEligibility} onRetry={moves.retry} onDismiss={moves.dismiss} onUndo={moves.undo} onHoldUndo={moves.holdUndo} />
        </div>
      </div>
      <PlanDetailPane openItem={workspace.openItem} suggestions={suggestions} goals={goals} epics={graph.modules} sprintName={sprint.name} busy={busy || decisions.blocked} renderWorkItemDetail={renderWorkItemDetail}
        acceptDisabled={!coordinator.canDecideSuggestion("accepted")} dismissDisabled={!coordinator.canDecideSuggestion("dismissed")}
        onAccept={(suggestion, proposedName) => changeSuggestion(suggestion, "accepted", proposedName)} onDismiss={(suggestion) => changeSuggestion(suggestion, "dismissed")}
        onClose={() => usePlanWorkspace.setState({ openItem: null, pendingOpenItem: null })} />
    </div>
  </div>;
}

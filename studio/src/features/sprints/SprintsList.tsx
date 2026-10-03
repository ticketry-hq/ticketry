import { useState, type ReactNode } from "react";
import type { PlanningGraph, PlanningSprint } from "../planning-graph";
import SprintCard from "./SprintCard";
import SprintItemRow from "./SprintItemRow";
import NewSprintButton from "./NewSprintButton";
import StartSprintDialog from "./StartSprintDialog";
import CompleteSprintDialog from "./CompleteSprintDialog";
import { groupSprintItemsByEpic, sprintProgress } from "./selectors/sprintSelectors";
import { inheritLastPlanVisit } from "./planWorkspaceState";

export type LifecycleUpdate = { id: string; status: "active" | "completed"; carryoverSprintId?: string };

export type SprintsListProps = {
  graph: PlanningGraph;
  openStoryId: string | null;
  onOpenStory: (id: string) => void;
  onOpenSprint: (id: string) => void;
  onCreateSprint: (name: string) => Promise<string | null>;
  onUpdateSprint: (update: LifecycleUpdate) => Promise<boolean>;
  renderSprintGoals: (sprint: PlanningSprint) => ReactNode;
  renderSuggestionAgentBox: (sprint: PlanningSprint) => ReactNode;
};

export default function SprintsList({ graph, openStoryId, onOpenStory, onOpenSprint, onCreateSprint,
  onUpdateSprint, renderSprintGoals, renderSuggestionAgentBox }: SprintsListProps) {
  const active = graph.sprints.find((sprint) => sprint.status === "active");
  const planned = graph.sprints.filter((sprint) => sprint.status === "planned");
  const completed = graph.sprints.filter((sprint) => sprint.status === "completed");
  const [dialog, setDialog] = useState<{ kind: "start" | "complete"; sprintId: string } | null>(null);
  const selected = graph.sprints.find((sprint) => sprint.id === dialog?.sprintId);
  const closeDialog = (kind: "start" | "complete", sprintId: string) => {
    setDialog((current) => current?.kind === kind && current.sprintId === sprintId ? null : current);
  };
  const card = (sprint: PlanningSprint) => <SprintCard key={sprint.id} sprint={sprint}
    {...sprintProgress(graph, sprint.id)} goals={renderSprintGoals(sprint)} suggestions={renderSuggestionAgentBox(sprint)}
    action={sprint.status !== "completed" && <>
      <button type="button" onClick={() => onOpenSprint(sprint.id)} className="h-7 border border-pane-border px-2 text-sm text-text-secondary">Plan</button>
      {sprint.status === "planned" && <button type="button" disabled={Boolean(active)} title={active ? "Complete the active sprint first" : undefined}
        onClick={() => setDialog({ kind: "start", sprintId: sprint.id })}
        className="h-7 border border-pane-border px-2 text-sm text-text-secondary disabled:opacity-40">Start</button>}
      {sprint.status === "active" && <button type="button" onClick={() => setDialog({ kind: "complete", sprintId: sprint.id })}
        className="h-7 border border-pane-border px-2 text-sm text-text-secondary">Complete</button>}
    </>}>
    {groupSprintItemsByEpic(graph, sprint).map((group) => <div key={group.epic?.id ?? "no-epic"}>
      <h3 className="px-3 pt-1.5 text-xs font-semibold text-text-muted">{group.epic?.name ?? "No epic"}</h3>
      {group.items.map((item) => <SprintItemRow key={item.id} item={item} selected={item.id === openStoryId}
        state={item.stateId ? graph.stateById.get(item.stateId) : undefined} onOpen={onOpenStory} />)}
    </div>)}
  </SprintCard>;
  return <div className="flex h-full flex-col">
    <header className="flex flex-wrap items-center gap-3 border-b border-pane-border bg-pane-panel px-4 py-2">
      <h1 className="text-base font-semibold text-text-primary">Sprints</h1>
      <span className="text-sm text-text-muted">{graph.sprints.length}</span>
      <div className="ml-auto"><NewSprintButton sprints={graph.sprints} onCreate={onCreateSprint} onCreated={(id) => {
        if (graph.project) inheritLastPlanVisit(graph.project.id, id);
        onOpenSprint(id);
      }} /></div>
    </header>
    <div className="flex-1 overflow-auto p-4" data-testid="sprints-list"><div className="mx-auto max-w-3xl space-y-3">
      {active && card(active)}
      {planned.map(card)}
      {completed.length > 0 && <details className="border border-pane-border bg-pane-panel">
        <summary className="cursor-pointer px-3 py-2 text-sm text-text-secondary">{completed.length} completed sprint{completed.length === 1 ? "" : "s"}</summary>
        <div className="space-y-2 p-2">{completed.map(card)}</div>
      </details>}
      {graph.sprints.length === 0 && <p className="p-4 text-center text-sm text-text-muted">Create a sprint to begin planning.</p>}
    </div></div>
    {dialog?.kind === "start" && selected?.status === "planned" && <StartSprintDialog key={selected.id}
      sprint={selected} activeSprintName={active?.name ?? null} onClose={() => closeDialog("start", selected.id)}
      onStart={() => onUpdateSprint({ id: selected.id, status: "active" })} />}
    {dialog?.kind === "complete" && selected?.status === "active" && <CompleteSprintDialog key={selected.id}
      sprint={selected} {...sprintProgress(graph, selected.id)} plannedSprints={planned} onClose={() => closeDialog("complete", selected.id)}
      onComplete={(target) => onUpdateSprint({ id: selected.id, status: "completed", ...(target ? { carryoverSprintId: target } : {}) })} />}
  </div>;
}

import NewEpicChip from "./NewEpicChip";
import { useEffect } from "react";
import { backlogCandidates, type PlanningGraph } from "../../planning-graph";
import Popover, { PopoverOption } from "../../../shared/ui/Popover";
import { TabStrip } from "../../../shared/ui/TabStrip";
import { toast } from "../../../state/clientStore";
import { setPlanVisit, usePlanWorkspace } from "../planWorkspaceState";
import { closeEpicTab, reconcileEpicTabs, seedEpicTabs, stepEpicTab } from "./epicTabs";
import { availablePlanEpics, epicOf, waitingForEpic, type EpicSuggestion } from "./epicMembership";

interface EpicTabStripProps { graph: PlanningGraph; suggestions: EpicSuggestion[]; sprintId: string; ready?: boolean }

export function EpicTabStrip({ graph, suggestions, sprintId, ready = true }: EpicTabStripProps) {
  const saved = usePlanWorkspace((state) => state.visits[sprintId]);
  const epics = availablePlanEpics(graph, suggestions, sprintId);
  const visit = saved ? (ready ? reconcileEpicTabs(saved, epics) : saved)
    : ready ? seedEpicTabs(graph, suggestions, sprintId) : { epicTabs: [], activeEpicId: null };
  useEffect(() => {
    if (!ready) return;
    const current = usePlanWorkspace.getState().visits[sprintId];
    if (!current || current.activeEpicId !== visit.activeEpicId || current.epicTabs.length !== visit.epicTabs.length ||
      current.epicTabs.some((id, index) => id !== visit.epicTabs[index])) setPlanVisit(sprintId, visit);
  }, [sprintId, ready, visit]);
  const backlog = backlogCandidates(graph);
  const label = (epicId: string) => {
    const epic = epics.find((module) => module.id === epicId);
    const count = backlog.filter((item) => epicOf(item, epics) === epicId).length;
    const waiting = waitingForEpic(suggestions, sprintId, epicId, epics);
    return { name: epic?.name ?? "Deleted epic", count, waiting, accessible: `${epic?.name ?? "Deleted epic"}, ${count} backlog stories${waiting ? `, ${waiting} waiting suggestions` : ""}` };
  };
  const select = (epicId: string) => {
    const current = usePlanWorkspace.getState().visits[sprintId] ?? visit;
    setPlanVisit(sprintId, { epicTabs: current.epicTabs.includes(epicId) ? current.epicTabs : [...current.epicTabs, epicId], activeEpicId: epicId });
  };
  return <div className="flex shrink-0 items-center border-b border-pane-border bg-pane-title">
    <TabStrip label="Plan epic tabs" activeId={visit.activeEpicId} onSelect={select} onClose={(epicId) => {
      setPlanVisit(sprintId, closeEpicTab(visit, epicId));
      const waiting = waitingForEpic(suggestions, sprintId, epicId, epics);
      if (waiting) toast.info(`${waiting} suggestions still waiting for ${label(epicId).name}. Find them in Add epic.`);
    }} tabs={visit.epicTabs.map((id) => {
      const text = label(id);
      return { id, label: <>{text.name} <span className="text-text-muted">{text.count}{text.waiting ? ` ✦ ${text.waiting}` : ""}</span></>, accessibleLabel: text.accessible, closeLabel: `Close ${text.name}` };
    })} />
    <Popover trigger={({ open, onClick }) => <button type="button" aria-label="Add epic" aria-expanded={open} onClick={onClick} className="whitespace-nowrap px-3 py-1 text-text-secondary">+ Add epic</button>}>
      {(close) => <>{epics.filter((epic) => !visit.epicTabs.includes(epic.id)).map((epic) => {
        const text = label(epic.id);
        return <PopoverOption key={epic.id} onClick={() => { select(epic.id); close(); }}><span aria-label={text.accessible}>{text.name}, {text.count} backlog stories{text.waiting ? `, ${text.waiting} waiting suggestions` : ""}</span></PopoverOption>;
      })}{graph.project && <NewEpicChip projectId={graph.project.id} epicType={graph.epicType} onCreated={(id) => { select(id); close(); }} />}</>}
    </Popover>
    <button type="button" aria-label="Next epic" disabled={visit.epicTabs.length < 2} onClick={() => setPlanVisit(sprintId, stepEpicTab(visit, 1))} className="ml-auto whitespace-nowrap px-3 py-1 text-text-secondary disabled:opacity-40">Next epic →</button>
  </div>;
}
